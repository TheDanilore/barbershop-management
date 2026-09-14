import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Appointment } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BookingModal } from '../../components/booking-modal/booking-modal';

@Component({
  selector: 'app-customer-appointments',
  standalone: true,
  imports: [CommonModule, BookingModal],
  templateUrl: './customer-appointments.page.html',
  styleUrl: './customer-appointments.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerAppointmentsPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);

  readonly filterTab = signal<'active' | 'past'>('active');
  readonly isBookingModalOpen = signal(false);

  // Citas del cliente
  readonly allAppointments = computed(() => this.barberService.clientAppointments());

  readonly activeAppointments = computed(() => {
    return this.allAppointments().filter(
      (a) => a.status === 'confirmed' || a.status === 'pending' || a.status === 'in-progress'
    );
  });

  readonly pastAppointments = computed(() => {
    return this.allAppointments().filter(
      (a) => a.status === 'completed' || a.status === 'cancelled'
    );
  });

  setFilterTab(tab: 'active' | 'past'): void {
    this.haptics.selection();
    this.filterTab.set(tab);
  }

  openBookingModal(): void {
    this.haptics.lightTap();
    this.isBookingModalOpen.set(true);
  }

  closeBookingModal(): void {
    this.isBookingModalOpen.set(false);
  }

  cancelAppointment(apt: Appointment): void {
    this.haptics.warning();
    this.barberService.updateAppointmentStatus(apt.id, 'cancelled');
  }

  formatDate(dateStr: string): string {
    try {
      const [year, month, day] = dateStr.split('-');
      const d = new Date(Number(year), Number(month) - 1, Number(day));
      return d.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
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

  addToGoogleCalendar(apt: Appointment): void {
    this.haptics.lightTap();
    const title = encodeURIComponent(`Corte en BarberTrack: ${apt.serviceName}`);
    const details = encodeURIComponent(`Cita con el barbero ${apt.barberName}. Precio: ${this.barberService.currencySymbol()}${apt.price}`);
    const location = encodeURIComponent('BarberTrack Studio');
    
    // YYYYMMDDTHHmmssZ
    const dateClean = apt.date.replace(/-/g, '');
    const timeClean = apt.time.replace(':', '') + '00';
    const startIso = `${dateClean}T${timeClean}`;
    const endIso = `${dateClean}T${timeClean}`; // aprox
    
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startIso}/${endIso}&details=${details}&location=${location}`;
    window.open(url, '_blank');
  }
}
