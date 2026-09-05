import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

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

  readonly availableTimeSlots = [
    '09:00', '09:45', '10:30', '11:15', '12:00',
    '14:00', '14:45', '15:30', '16:15', '17:00',
    '17:45', '18:30', '19:15',
  ];

  readonly bookingForm: FormGroup = this.fb.group({
    serviceId: ['srv-1', [Validators.required]],
    barberId: ['barber-1', [Validators.required]],
    date: [new Date().toISOString().slice(0, 10), [Validators.required]],
    time: ['10:00', [Validators.required]],
    notes: [''],
  });

  selectTime(time: string): void {
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
