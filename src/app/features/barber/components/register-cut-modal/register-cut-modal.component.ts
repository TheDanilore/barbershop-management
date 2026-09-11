import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { PaymentMethod, ServiceItem } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-register-cut-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './register-cut-modal.component.html',
  styleUrl: './register-cut-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterCutModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  readonly supabaseService = inject(SupabaseService);
  private readonly haptics = inject(HapticsService);
  private readonly logger = inject(LoggerService);
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Input() initialData: {
    clientId?: string;
    barberId?: string;
    serviceIds?: string[];
    customPrice?: number | null;
    notes?: string;
    appointmentId?: string;
  } | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() cutSuccess = new EventEmitter<{ message: string }>();
  @Output() openNewClient = new EventEmitter<void>();
  @Output() goToCash = new EventEmitter<void>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // Formulario reactivo de cobro
  readonly cutForm: FormGroup = this.fb.group({
    clientId: ['', [Validators.required]],
    serviceId: ['', [Validators.required]],
    customPrice: [null],
    paymentMethod: ['cash' as PaymentMethod, [Validators.required]],
    isCredit: [false],
    notes: [''],
  });

  // Multi-selección reactiva de servicios realizados
  readonly selectedCutServiceIds = signal<string[]>([]);

  readonly selectedCutServices = computed(() => {
    const ids = this.selectedCutServiceIds();
    const allServices = this.barberService.services();
    return ids
      .map((id) => allServices.find((s) => s.id === id))
      .filter((s): s is ServiceItem => !!s);
  });

  readonly cutCalculatedSubtotal = computed(() => {
    return this.selectedCutServices().reduce((sum, s) => sum + s.price, 0);
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.populateForm();
    }
    if (changes['initialData'] && this.isOpen) {
      this.populateForm();
    }
  }

  private populateForm(): void {
    this.errorMessage.set(null);
    const clients = this.barberService.clients();
    const services = this.barberService.services();

    const clientId =
      this.initialData?.clientId ||
      this.cutForm.get('clientId')?.value ||
      (clients.length > 0 ? clients[0].id : '');

    const firstService = services[0];
    const initialServices =
      this.initialData?.serviceIds && this.initialData.serviceIds.length > 0
        ? this.initialData.serviceIds
        : firstService
        ? [firstService.id]
        : [];

    this.selectedCutServiceIds.set(initialServices);

    this.cutForm.reset({
      clientId,
      serviceId: initialServices[0] || (firstService ? firstService.id : ''),
      customPrice: this.initialData?.customPrice ?? null,
      paymentMethod: 'cash',
      isCredit: false,
      notes: this.initialData?.notes || '',
    });
  }

  @HostListener('window:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key === 'Enter' && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      this.submit();
      return;
    }

    if (event.altKey) {
      const key = event.key.toLowerCase();
      if (key === '1') {
        event.preventDefault();
        this.selectPaymentMethod('cash');
      } else if (key === '2') {
        event.preventDefault();
        this.selectPaymentMethod('card');
      } else if (key === '3') {
        event.preventDefault();
        this.selectPaymentMethod('transfer');
      } else if (key === 'f') {
        event.preventDefault();
        this.toggleIsCredit(!this.cutForm.get('isCredit')?.value);
      }
    }
  }

  toggleCutService(serviceId: string): void {
    this.haptics.selection();
    const current = this.selectedCutServiceIds();
    let updated: string[];

    if (current.includes(serviceId)) {
      if (current.length > 1) {
        updated = current.filter((id) => id !== serviceId);
      } else {
        this.haptics.warning();
        return;
      }
    } else {
      updated = [...current, serviceId];
    }

    this.selectedCutServiceIds.set(updated);
    this.cutForm.patchValue({ serviceId: updated[0] || '' });
  }

  selectPaymentMethod(method: PaymentMethod): void {
    this.haptics.selection();
    this.cutForm.patchValue({ paymentMethod: method });
  }

  toggleIsCredit(isCredit: boolean): void {
    this.haptics.selection();
    this.cutForm.patchValue({ isCredit });
  }

  close(): void {
    this.haptics.lightTap();
    this.closed.emit();
  }

  triggerOpenNewClient(): void {
    this.haptics.lightTap();
    this.openNewClient.emit();
  }

  triggerGoToCash(): void {
    this.haptics.lightTap();
    this.close();
    this.goToCash.emit();
  }

  async submit(): Promise<void> {
    if (this.cutForm.invalid || this.isSubmitting()) {
      this.cutForm.markAllAsTouched();
      this.haptics.warning();
      this.errorMessage.set('Completa todos los campos requeridos');
      return;
    }

    const pm = this.cutForm.get('paymentMethod')?.value;
    const creditMode = this.cutForm.get('isCredit')?.value;
    if (pm === 'cash' && !creditMode && !this.barberService.activeCashShift()) {
      this.haptics.warning();
      this.errorMessage.set('⚠️ La caja está cerrada. Abre un turno antes de registrar efectivo.');
      return;
    }

    const selectedServices = this.selectedCutServices();
    if (selectedServices.length === 0) {
      this.haptics.warning();
      this.errorMessage.set('Selecciona al menos un servicio realizado');
      return;
    }

    const { clientId, customPrice, paymentMethod, isCredit, notes } = this.cutForm.value;

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    try {
      const activeBarber = this.supabaseService.userProfile();
      const fallbackBarber = this.barberService.barbers()[0];
      const realBarberId = activeBarber?.id || fallbackBarber?.id || '';

      await this.barberService.registerCut({
        clientId,
        barberId: realBarberId,
        serviceId: selectedServices[0].id,
        services: selectedServices.map((s) => ({
          serviceId: s.id,
          name: s.name,
          price: s.price,
          quantity: 1,
        })),
        customPrice: customPrice ? Number(customPrice) : undefined,
        paymentMethod,
        isCredit: Boolean(isCredit),
        notes,
      });

      // Si el cobro proviene de una cita agendada, marcar como completada
      if (this.initialData?.appointmentId) {
        try {
          await this.barberService.updateAppointmentStatus(this.initialData.appointmentId, 'completed');
        } catch (e) {
          this.logger.error('RegisterCutModalComponent', 'Error completando cita asociada', e);
        }
      }

      this.haptics.success();
      const count = selectedServices.length;
      const countLabel = count > 1 ? ` (${count} servicios)` : '';
      const successMsg = isCredit
        ? `✅ Orden al Crédito registrada${countLabel}`
        : `✅ Cobro registrado con éxito${countLabel}`;

      this.cutSuccess.emit({ message: successMsg });
      this.close();
    } catch (err: any) {
      this.haptics.warning();
      this.errorMessage.set(err?.message || 'Error al registrar el cobro del servicio');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
