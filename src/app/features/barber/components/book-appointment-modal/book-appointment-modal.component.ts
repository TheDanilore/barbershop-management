import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Appointment } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { getLocalDateString } from '../../../../core/utils/date.utils';

@Component({
  selector: 'app-book-appointment-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './book-appointment-modal.component.html',
  styleUrl: './book-appointment-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookAppointmentModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  @Input() isOpen = false;
  @Input() initialDate?: string;
  @Input() initialTime?: string;

  @Output() closed = new EventEmitter<void>();
  @Output() appointmentBooked = new EventEmitter<Appointment>();

  readonly isSubmitting = signal(false);

  // Franjas horarias disponibles del negocio
  readonly availableTimeSlots = [
    '08:30', '09:15', '10:00', '10:45', '11:30', '12:15',
    '14:00', '14:45', '15:30', '16:15', '17:00', '17:45',
    '18:30', '19:15', '20:00',
  ];

  // Señales reactivas para cálculo del resumen en vivo
  readonly currentServiceId = signal<string>('');
  readonly currentBarberId = signal<string>('');
  readonly currentDate = signal<string>(getLocalDateString());
  readonly currentTime = signal<string>('10:00');

  // Formulario reactivo
  readonly bookingForm: FormGroup = this.fb.group({
    clientId: ['', [Validators.required]],
    serviceId: ['', [Validators.required]],
    barberId: ['', [Validators.required]],
    date: [getLocalDateString(), [Validators.required]],
    time: ['10:00', [Validators.required]],
    notes: [''],
  });

  // Servicio seleccionado reactivo
  readonly selectedService = computed(() => {
    const sId = this.currentServiceId();
    const services = this.barberService.services();
    return services.find((s) => s.id === sId) || services[0] || null;
  });

  // Barbero seleccionado reactivo
  readonly selectedBarber = computed(() => {
    const bId = this.currentBarberId();
    const barbers = this.barberService.barbers();
    return barbers.find((b) => b.id === bId) || barbers[0] || null;
  });

  // Horarios ocupados en la fecha seleccionada
  readonly occupiedSlotsOnSelectedDate = computed<Map<string, string>>(() => {
    const targetDate = this.currentDate();
    const map = new Map<string, string>();
    for (const apt of this.barberService.appointments()) {
      if (apt.date === targetDate && apt.status !== 'cancelled') {
        map.set(apt.time, apt.clientName);
      }
    }
    return map;
  });

  constructor() {
    // Sincronizar cambios en los campos con las señales computadas
    this.bookingForm.get('serviceId')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => this.currentServiceId.set(val || ''));

    this.bookingForm.get('barberId')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => this.currentBarberId.set(val || ''));

    this.bookingForm.get('date')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => this.currentDate.set(val || getLocalDateString()));

    this.bookingForm.get('time')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => this.currentTime.set(val || '10:00'));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.resetAndInitForm();
    }
  }

  private resetAndInitForm(): void {
    const firstClient = this.barberService.clients()[0];
    const firstService = this.barberService.services()[0];
    const firstBarber = this.barberService.barbers()[0];

    const targetDate = this.initialDate || getLocalDateString();
    const targetTime = this.initialTime || '10:00';
    const serviceId = firstService?.id || '';
    const barberId = firstBarber?.id || '';

    this.bookingForm.reset({
      clientId: firstClient?.id || '',
      serviceId,
      barberId,
      date: targetDate,
      time: targetTime,
      notes: '',
    });

    this.currentServiceId.set(serviceId);
    this.currentBarberId.set(barberId);
    this.currentDate.set(targetDate);
    this.currentTime.set(targetTime);
  }

  selectTimeChip(slot: string): void {
    this.haptics.selection();
    this.bookingForm.patchValue({ time: slot });
  }

  closeModal(): void {
    this.haptics.lightTap();
    this.closed.emit();
  }

  async submitBookAppointment(): Promise<void> {
    if (this.bookingForm.invalid || this.isSubmitting()) {
      this.bookingForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    const { clientId, serviceId, barberId, date, time, notes } = this.bookingForm.value;
    this.isSubmitting.set(true);

    try {
      const newApt = await this.barberService.bookAppointment({
        clientId: clientId || this.barberService.clients()[0]?.id || '',
        serviceId,
        barberId,
        date,
        time,
        notes: notes?.trim() || undefined,
      });

      this.haptics.success();
      this.appointmentBooked.emit(newApt);
      this.closeModal();
    } catch {
      this.haptics.warning();
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
