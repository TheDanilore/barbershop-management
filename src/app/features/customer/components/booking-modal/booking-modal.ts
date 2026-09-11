import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { getLocalDateString, getLocalTimeString, isPastDateTime } from '../../../../core/utils/date.utils';

@Component({
  selector: 'app-booking-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './booking-modal.html',
  styleUrl: './booking-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookingModal {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @Output() booked = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly todayDateStr = computed(() => getLocalDateString());

  readonly availableTimeSlots = [
    '09:00', '09:45', '10:30', '11:15', '12:00',
    '14:00', '14:45', '15:30', '16:15', '17:00',
    '17:45', '18:30', '19:15',
  ];

  readonly bookingForm: FormGroup;

  constructor() {
    const today = getLocalDateString();
    const nowTime = getLocalTimeString();
    const initialSlot = this.availableTimeSlots.find((s) => !isPastDateTime(today, s)) || this.availableTimeSlots[0];

    this.bookingForm = this.fb.group({
      serviceId: ['srv-1', [Validators.required]],
      barberId: ['barber-1', [Validators.required]],
      date: [today, [Validators.required]],
      time: [initialSlot, [Validators.required]],
      notes: [''],
    });

    this.bookingForm.get('date')?.valueChanges.subscribe((d) => {
      if (!d) return;
      const curTime = this.bookingForm.get('time')?.value;
      if (this.isSlotDisabled(curTime)) {
        const next = this.availableTimeSlots.find((s) => !isPastDateTime(d, s)) || this.availableTimeSlots[0];
        this.bookingForm.patchValue({ time: next });
      }
    });
  }

  isSlotDisabled(time: string): boolean {
    const d = this.bookingForm.get('date')?.value || getLocalDateString();
    return isPastDateTime(d, time);
  }

  selectTime(time: string): void {
    if (this.isSlotDisabled(time)) return;
    this.haptics.selection();
    this.bookingForm.patchValue({ time });
  }

  onClose(): void {
    this.haptics.lightTap();
    this.close.emit();
  }

  async submitBooking(): Promise<void> {
    if (this.bookingForm.invalid || this.isSubmitting()) {
      this.bookingForm.markAllAsTouched();
      this.haptics.warning();
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
      this.booked.emit(`¡Cita agendada para el ${apt.date} a las ${apt.time}!`);
      this.close.emit();
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
