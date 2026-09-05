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
   * Marcar cita como completada
   */
  markCompleted(appointment: Appointment): void {
    this.haptics.success();
    this.barberService.updateAppointmentStatus(appointment.id, 'completed');
    this.actionFeedback.emit(`Cita de ${appointment.clientName} completada`);
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
