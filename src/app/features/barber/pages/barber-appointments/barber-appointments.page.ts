import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BarberSchedule } from '../../components/barber-schedule/barber-schedule';

@Component({
  selector: 'app-barber-appointments',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BarberSchedule],
  templateUrl: './barber-appointments.page.html',
  styleUrl: './barber-appointments.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberAppointmentsPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  readonly isBookAppointmentModalOpen = signal(false);
  readonly isSubmitting = signal(false);

  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly availableTimeSlots = [
    '09:00', '09:45', '10:30', '11:15', '12:00',
    '14:00', '14:45', '15:30', '16:15', '17:00',
    '17:45', '18:30', '19:15',
  ];

  readonly bookingForm: FormGroup = this.fb.group({
    clientId: ['', [Validators.required]],
    serviceId: ['', [Validators.required]],
    barberId: ['', [Validators.required]],
    date: [new Date().toISOString().slice(0, 10), [Validators.required]],
    time: ['10:00', [Validators.required]],
    notes: [''],
  });

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toastMessage.set(null), 3500);
  }

  openBookAppointmentModal(): void {
    this.haptics.lightTap();
    const firstClient = this.barberService.clients()[0];
    const firstService = this.barberService.services()[0];
    const firstBarber = this.barberService.barbers()[0];

    this.bookingForm.reset({
      clientId: firstClient?.id || '',
      serviceId: firstService?.id || '',
      barberId: firstBarber?.id || '',
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

  async submitBookAppointment(): Promise<void> {
    if (this.bookingForm.invalid || this.isSubmitting()) {
      this.bookingForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Completa los campos requeridos');
      return;
    }

    const { clientId, serviceId, barberId, date, time, notes } = this.bookingForm.value;
    this.isSubmitting.set(true);
    try {
      await this.barberService.bookAppointment({
        clientId: clientId || this.barberService.clients()[0]?.id || '',
        serviceId,
        barberId,
        date,
        time,
        notes,
      });

      this.haptics.success();
      this.showToast('Cita agendada con éxito');
      this.closeBookAppointmentModal();
    } catch {
      this.haptics.warning();
      this.showToast('Error al agendar la cita');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
