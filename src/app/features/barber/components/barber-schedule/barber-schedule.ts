import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  inject,
} from '@angular/core';
import { Appointment } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

/**
 * Componente de agenda y cronograma diario de citas para el barbero
 */
@Component({
  selector: 'app-barber-schedule',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './barber-schedule.html',
  styleUrl: './barber-schedule.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberSchedule {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);

  // Emisor de eventos para retroalimentación en la vista principal
  @Output() actionFeedback = new EventEmitter<string>();

  /**
   * Marcar cita como completada mediante checkout POS validado
   */
  markCompleted(appointment: Appointment): void {
    this.haptics.selection();
    const serviceIds = appointment.services && appointment.services.length > 0
      ? appointment.services.map((s) => s.serviceId)
      : (appointment.serviceId ? [appointment.serviceId] : []);

    this.barberService.openRegisterCutModal({
      clientId: appointment.clientId,
      barberId: appointment.barberId,
      serviceIds,
      customPrice: appointment.price,
      notes: `Cita completada (${appointment.time} - ${appointment.clientName})`,
      appointmentId: appointment.id,
    });
  }

  /**
   * Cancelar cita
   */
  cancel(appointment: Appointment): void {
    this.haptics.warning();
    this.barberService.updateAppointmentStatus(appointment.id, 'cancelled');
    this.actionFeedback.emit(`Cita de las ${appointment.time} cancelada`);
  }

  /**
   * Obtener etiqueta visual legible para el estado de la cita
   */
  getStatusLabel(status: string): string {
    switch (status) {
      case 'confirmed':
        return 'Confirmado';
      case 'in-progress':
        return 'En atención';
      case 'completed':
        return 'Completado';
      case 'cancelled':
        return 'Cancelado';
      default:
        return 'Pendiente';
    }
  }
}
