import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Output, inject } from '@angular/core';
import { Appointment } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

@Component({
  selector: 'app-barber-agenda',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './barber-agenda.html',
  styleUrl: './barber-agenda.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberAgenda {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);

  @Output() actionFeedback = new EventEmitter<string>();

  markCompleted(apt: Appointment): void {
    this.haptics.success();
    this.barberService.updateAppointmentStatus(apt.id, 'completed');
    this.actionFeedback.emit(`Cita de ${apt.clientName} completada`);
  }

  cancel(apt: Appointment): void {
    this.haptics.warning();
    this.barberService.updateAppointmentStatus(apt.id, 'cancelled');
    this.actionFeedback.emit(`Cita de las ${apt.time} cancelada`);
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'confirmed': return 'Confirmado';
      case 'in-progress': return 'En atención';
      case 'completed': return 'Completado';
      case 'cancelled': return 'Cancelado';
      default: return 'Pendiente';
    }
  }
}
