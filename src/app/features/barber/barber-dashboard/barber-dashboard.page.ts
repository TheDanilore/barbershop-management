import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { Router } from '@angular/router';
import { PaymentMethod } from '../../../core/models/barber.models';
import { BarberService } from '../../../core/services/barber.service';
import { HapticsService } from '../../../core/services/haptics.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { BarberAgenda } from '../components/barber-agenda/barber-agenda';
import { BarberMetrics } from '../components/barber-metrics/barber-metrics';

@Component({
  selector: 'app-barber-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    BarberMetrics,
    BarberAgenda,
  ],
  templateUrl: './barber-dashboard.page.html',
  styleUrl: './barber-dashboard.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberDashboardPage {
  readonly barberService = inject(BarberService);
  readonly supabaseService = inject(SupabaseService);
  readonly haptics = inject(HapticsService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  // Pestaña activa: 'inicio' | 'agenda' | 'clientes' | 'stats'
  readonly barberTab = signal<'inicio' | 'agenda' | 'clientes' | 'stats'>('inicio');

  // Modales
  readonly isRegisterCutModalOpen = signal(false);
  readonly isBookAppointmentModalOpen = signal(false);
  readonly isNewClientModalOpen = signal(false);
  readonly isDailyCashModalOpen = signal(false);

  // Prevención multi-tap
  readonly isSubmitting = signal(false);

  // Filtro de clientes
  readonly clientSearchQuery = signal('');

  // Toast
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Horarios de cita
  readonly availableTimeSlots = [
    '09:00', '09:45', '10:30', '11:15', '12:00',
    '14:00', '14:45', '15:30', '16:15', '17:00',
    '17:45', '18:30', '19:15',
  ];

  // Formularios reactivos
  readonly cutForm: FormGroup = this.fb.group({
    clientId: ['', [Validators.required]],
    serviceId: ['srv-1', [Validators.required]],
    customPrice: [null, [Validators.min(0.01), Validators.max(9999)]],
    paymentMethod: ['cash', [Validators.required]],
    notes: [''],
  });

  readonly newClientForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    phone: ['', [Validators.required, Validators.pattern(/^[+0-9\s-]{7,20}$/)]],
    notes: [''],
  });

  readonly bookingForm: FormGroup = this.fb.group({
    serviceId: ['srv-1', [Validators.required]],
    barberId: ['barber-1', [Validators.required]],
    date: [new Date().toISOString().slice(0, 10), [Validators.required]],
    time: ['10:00', [Validators.required]],
    notes: [''],
  });

  readonly filteredClients = computed(() => {
    const q = this.clientSearchQuery().toLowerCase().trim();
    if (!q) return this.barberService.clients();
    return this.barberService
      .clients()
      .filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  });

  readonly topLoyaltyClients = computed(() => {
    return [...this.barberService.clients()]
      .sort((a, b) => b.loyaltyStamps - a.loyaltyStamps)
      .slice(0, 4);
  });

  constructor() {
    const firstCli = this.barberService.clients()[0];
    if (firstCli) {
      this.cutForm.patchValue({ clientId: firstCli.id });
    }

    this.destroyRef.onDestroy(() => {
      if (this.toastTimeout) clearTimeout(this.toastTimeout);
    });
  }

  setTab(tab: 'inicio' | 'agenda' | 'clientes' | 'stats'): void {
    this.haptics.lightTap();
    this.barberTab.set(tab);
  }

  switchToCustomer(): void {
    this.haptics.lightTap();
    this.barberService.setRole('client');
    this.router.navigate(['/customer']);
  }

  logout(): void {
    this.haptics.lightTap();
    this.supabaseService.signOut();
    this.router.navigate(['/login']);
  }

  openRegisterCutModal(preselectedClientId?: string): void {
    this.haptics.lightTap();
    const clientId = preselectedClientId || this.cutForm.get('clientId')?.value || this.barberService.clients()[0]?.id || '';
    this.cutForm.reset({
      clientId,
      serviceId: this.barberService.services()[0]?.id || 'srv-1',
      customPrice: null,
      paymentMethod: 'cash',
      notes: '',
    });
    this.isRegisterCutModalOpen.set(true);
  }

  closeRegisterCutModal(): void {
    this.haptics.lightTap();
    this.isRegisterCutModalOpen.set(false);
  }

  selectService(serviceId: string): void {
    this.haptics.selection();
    this.cutForm.patchValue({ serviceId });
  }

  selectPaymentMethod(method: PaymentMethod): void {
    this.haptics.selection();
    this.cutForm.patchValue({ paymentMethod: method });
  }

  async submitRegisterCut(): Promise<void> {
    if (this.cutForm.invalid || this.isSubmitting()) {
      this.cutForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Completa todos los campos requeridos');
      return;
    }

    const { clientId, serviceId, customPrice, paymentMethod, notes } = this.cutForm.value;

    this.isSubmitting.set(true);
    try {
      const cut = await this.barberService.registerCut({
        clientId,
        barberId: 'barber-1',
        serviceId,
        customPrice: customPrice ? Number(customPrice) : undefined,
        paymentMethod,
        notes: notes?.trim(),
      });

      this.haptics.success();
      this.isRegisterCutModalOpen.set(false);
      this.showToast(`¡Corte registrado con éxito! ($${cut.price.toFixed(2)})`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openNewClientModal(): void {
    this.haptics.lightTap();
    this.newClientForm.reset({ fullName: '', phone: '', notes: '' });
    this.isNewClientModalOpen.set(true);
  }

  closeNewClientModal(): void {
    this.haptics.lightTap();
    this.isNewClientModalOpen.set(false);
  }

  async submitNewClient(): Promise<void> {
    if (this.newClientForm.invalid || this.isSubmitting()) {
      this.newClientForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Verifica los datos del cliente');
      return;
    }

    const { fullName, phone, notes } = this.newClientForm.value;
    const cleanName = fullName.trim();
    const cleanPhone = phone.trim();

    this.isSubmitting.set(true);
    try {
      const newClient = await this.barberService.createClient(cleanName, cleanPhone, undefined, notes?.trim());
      this.cutForm.patchValue({ clientId: newClient.id });
      this.haptics.success();
      this.isNewClientModalOpen.set(false);
      this.showToast(`Cliente ${cleanName} añadido`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openBookAppointmentModal(preselectedBarberId?: string): void {
    this.haptics.lightTap();
    this.bookingForm.reset({
      serviceId: this.barberService.services()[0]?.id || 'srv-1',
      barberId: preselectedBarberId || 'barber-1',
      date: new Date().toISOString().slice(0, 10),
      time: '10:00',
      notes: '',
    });
    this.isBookAppointmentModalOpen.set(true);
  }

  closeBookAppointmentModal(): void {
    this.haptics.lightTap();
    this.isBookAppointmentModalOpen.set(false);
  }

  selectBookingTime(time: string): void {
    this.haptics.selection();
    this.bookingForm.patchValue({ time });
  }

  async submitBooking(): Promise<void> {
    if (this.bookingForm.invalid || this.isSubmitting()) {
      this.bookingForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Completa los datos de la cita');
      return;
    }

    const { serviceId, barberId, date, time, notes } = this.bookingForm.value;

    this.isSubmitting.set(true);
    try {
      const apt = await this.barberService.bookAppointment({
        clientId: this.barberService.currentClient().id,
        barberId,
        serviceId,
        date,
        time,
        notes: notes?.trim(),
      });

      this.haptics.success();
      this.isBookAppointmentModalOpen.set(false);
      this.showToast(`¡Cita agendada para las ${apt.time}!`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openDailyCashModal(): void {
    this.haptics.lightTap();
    this.isDailyCashModalOpen.set(true);
  }

  closeDailyCashModal(): void {
    this.haptics.lightTap();
    this.isDailyCashModalOpen.set(false);
  }

  showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage.set(null);
    }, 3500);
  }

  formatDate(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      return date.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoDate;
    }
  }

  getPaymentLabel(method: string): string {
    switch (method) {
      case 'cash': return 'Efectivo';
      case 'card': return 'Tarjeta';
      case 'transfer': return 'Yape / Transf.';
      default: return method;
    }
  }
}
