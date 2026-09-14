import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { getLocalDateString, getLocalTimeString, isPastDateTime } from '../../../../core/utils/date.utils';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-booking-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './booking-modal.html',
  styleUrl: './booking-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookingModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);
  private readonly logger = inject(LoggerService);
  private readonly destroyRef = inject(DestroyRef);

  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @Output() booked = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly todayDateStr = computed(() => getLocalDateString());

  readonly availableTimeSlots = [
    '09:00', '09:45', '10:30', '11:15', '12:00',
    '14:00', '14:45', '15:30', '16:15', '17:00',
    '17:45', '18:30', '19:15',
  ];

  readonly bookingForm: FormGroup;

  constructor() {
    const today = getLocalDateString();
    const initialSlot =
      this.availableTimeSlots.find((s) => !isPastDateTime(today, s)) || this.availableTimeSlots[0];

    const initialServiceId = this.barberService.services()[0]?.id || '';
    const initialBarberId = this.barberService.barbers()[0]?.id || '';

    this.bookingForm = this.fb.group({
      serviceId: [initialServiceId, [Validators.required]],
      barberId: [initialBarberId, [Validators.required]],
      date: [today, [Validators.required]],
      time: [initialSlot, [Validators.required]],
      notes: [''],
    });

    // Suscripción reactiva inmune a fugas de memoria con takeUntilDestroyed
    this.bookingForm
      .get('date')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((d) => {
        if (!d) return;
        const curTime = this.bookingForm.get('time')?.value;
        if (this.isSlotDisabled(curTime)) {
          const next =
            this.availableTimeSlots.find((s) => !isPastDateTime(d, s)) || this.availableTimeSlots[0];
          this.bookingForm.patchValue({ time: next });
        }
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      this.syncDynamicDefaults();
    }
  }

  @HostListener('window:keydown.escape')
  handleEscape(): void {
    if (this.isOpen && !this.isSubmitting()) {
      this.onClose();
    }
  }

  private syncDynamicDefaults(): void {
    const currentServiceId = this.bookingForm.get('serviceId')?.value;
    const services = this.barberService.services();
    if ((!currentServiceId || !services.some((s) => s.id === currentServiceId)) && services.length > 0) {
      this.bookingForm.patchValue({ serviceId: services[0].id });
    }

    const currentBarberId = this.bookingForm.get('barberId')?.value;
    const barbers = this.barberService.barbers();
    if ((!currentBarberId || !barbers.some((b) => b.id === currentBarberId)) && barbers.length > 0) {
      this.bookingForm.patchValue({ barberId: barbers[0].id });
    }

    const d = this.bookingForm.get('date')?.value || getLocalDateString();
    const curTime = this.bookingForm.get('time')?.value;
    if (this.isSlotDisabled(curTime)) {
      const next =
        this.availableTimeSlots.find((s) => !isPastDateTime(d, s)) || this.availableTimeSlots[0];
      this.bookingForm.patchValue({ time: next });
    }
  }

  isSlotDisabled(time: string): boolean {
    const d = this.bookingForm.get('date')?.value || getLocalDateString();
    return isPastDateTime(d, time);
  }

  selectTime(time: string): void {
    if (this.isSlotDisabled(time) || this.isSubmitting()) return;
    this.haptics.selection();
    this.bookingForm.patchValue({ time });
  }

  onClose(): void {
    if (this.isSubmitting()) return;
    this.haptics.lightTap();
    this.errorMessage.set(null);
    this.close.emit();
  }

  async submitBooking(): Promise<void> {
    if (this.bookingForm.invalid || this.isSubmitting()) {
      this.bookingForm.markAllAsTouched();
      this.haptics.warning();
      this.errorMessage.set('Por favor completa todos los campos requeridos para tu reserva.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.bookingForm.disable({ emitEvent: false });

    const { serviceId, barberId, date, time, notes } = this.bookingForm.value;

    try {
      const apt = await this.barberService.bookAppointment({
        clientId: this.barberService.currentClient().id,
        barberId,
        serviceId,
        date,
        time,
        notes: notes ? notes.trim() : undefined,
      });

      this.haptics.success();
      this.booked.emit(`¡Cita agendada para el ${apt.date} a las ${apt.time}!`);
      this.close.emit();
    } catch (err: unknown) {
      this.haptics.warning();
      const message =
        err instanceof Error ? err.message : 'No se pudo completar la reserva. Inténtalo nuevamente.';
      this.errorMessage.set(message);
      this.logger.error('BookingModalComponent', `Fallo al agendar cita: ${message}`, err);
    } finally {
      this.bookingForm.enable({ emitEvent: false });
      this.isSubmitting.set(false);
    }
  }
}

// Alias de retrocompatibilidad
export { BookingModalComponent as BookingModal };
