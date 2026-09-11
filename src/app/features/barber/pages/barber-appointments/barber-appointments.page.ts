import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
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
import { Appointment, AppointmentStatus } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import {
  getLocalDateString,
  addDaysToDateStr,
  getDayName,
  getMonthShortName,
  formatDateReadable,
} from '../../../../core/utils/date.utils';

export interface WeekDayItem {
  dateStr: string;
  dayName: string;
  dayNumber: number;
  monthName: string;
  isToday: boolean;
  isSelected: boolean;
  appointmentCount: number;
}

@Component({
  selector: 'app-barber-appointments',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './barber-appointments.page.html',
  styleUrl: './barber-appointments.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberAppointmentsPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  // Estados de navegación y filtros
  readonly selectedDate = signal<string>(getLocalDateString());
  readonly selectedBarberFilter = signal<string>('all');
  readonly selectedStatusFilter = signal<string>('all');
  readonly viewMode = signal<'timeline' | 'list'>('timeline');

  // Estados de Acción
  readonly isSubmitting = signal(false);
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Franjas horarias estándar del negocio
  readonly availableTimeSlots = [
    '08:30', '09:15', '10:00', '10:45', '11:30', '12:15',
    '14:00', '14:45', '15:30', '16:15', '17:00', '17:45',
    '18:30', '19:15', '20:00'
  ];

  // --- COMPUTADAS REACTIVAS ---

  // Fecha actual en string YYYY-MM-DD según la zona horaria local (Perú)
  readonly todayDateStr = computed(() => getLocalDateString());

  // Es el día de hoy?
  readonly isViewingToday = computed(() => this.selectedDate() === this.todayDateStr());

  // Formato legible de la fecha seleccionada (ej. "Jueves, 10 de Septiembre 2026")
  readonly formattedSelectedDate = computed(() => formatDateReadable(this.selectedDate()));

  // Franja semanal de 7 días centrada alrededor de la fecha seleccionada
  readonly weekStrip = computed<WeekDayItem[]>(() => {
    const centerDate = this.selectedDate();
    const today = this.todayDateStr();
    const allAppointments = this.barberService.appointments();

    const strip: WeekDayItem[] = [];
    // Generar desde -3 días hasta +3 días
    for (let offset = -3; offset <= 3; offset++) {
      const dateStr = addDaysToDateStr(centerDate, offset);
      const [y, m, d] = dateStr.split('-').map(Number);
      const count = allAppointments.filter((a) => a.date === dateStr && a.status !== 'cancelled').length;

      strip.push({
        dateStr,
        dayName: getDayName(dateStr),
        dayNumber: d,
        monthName: getMonthShortName(dateStr),
        isToday: dateStr === today,
        isSelected: dateStr === centerDate,
        appointmentCount: count,
      });
    }
    return strip;
  });

  // Todas las citas de la fecha seleccionada (ordenadas cronológicamente)
  readonly dateAppointments = computed<Appointment[]>(() => {
    const targetDate = this.selectedDate();
    return this.barberService
      .appointments()
      .filter((a) => a.date === targetDate)
      .sort((a, b) => a.time.localeCompare(b.time));
  });

  // Citas filtradas por barbero y estado
  readonly filteredAppointments = computed<Appointment[]>(() => {
    const list = this.dateAppointments();
    const barberId = this.selectedBarberFilter();
    const status = this.selectedStatusFilter();

    return list.filter((apt) => {
      if (barberId !== 'all' && apt.barberId !== barberId) return false;
      if (status !== 'all' && apt.status !== status) return false;
      return true;
    });
  });

  // Métricas del día seleccionado (KPIs)
  readonly dateKPIs = computed(() => {
    const list = this.dateAppointments();
    const total = list.length;
    const confirmed = list.filter((a) => a.status === 'confirmed').length;
    const inProgress = list.filter((a) => a.status === 'in-progress').length;
    const completed = list.filter((a) => a.status === 'completed').length;
    const cancelled = list.filter((a) => a.status === 'cancelled').length;

    const projectedRevenue = list
      .filter((a) => a.status !== 'cancelled')
      .reduce((sum, a) => sum + (Number(a.price) || 0), 0);

    const activeSlots = list.filter((a) => a.status !== 'cancelled').length;
    const occupancyRate = Math.min(
      100,
      Math.round((activeSlots / (this.availableTimeSlots.length * Math.max(1, this.barberService.barbers().length))) * 100)
    );

    return {
      total,
      confirmed,
      inProgress,
      completed,
      cancelled,
      projectedRevenue,
      occupancyRate,
    };
  });

  // Horarios ya ocupados en la fecha seleccionada (para feedback visual)
  readonly occupiedSlotsOnSelectedDate = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const apt of this.dateAppointments()) {
      if (apt.status !== 'cancelled') {
        map.set(apt.time, apt.clientName);
      }
    }
    return map;
  });

  // Estructura de Timeline enriquecida para cada slot horario
  readonly timelineSlots = computed(() => {
    const appointments = this.filteredAppointments();
    const slots = this.availableTimeSlots;

    return slots.map((time) => {
      const aptsAtThisTime = appointments.filter((a) => a.time === time);
      return {
        time,
        appointments: aptsAtThisTime,
        isOccupied: aptsAtThisTime.length > 0,
      };
    });
  });



  // --- ATAJOS DE TECLADO POWER USER ---
  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcuts(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const isEditing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

    if (event.key === 'Escape') {
      if (this.barberService.isBookingModalOpen()) {
        this.closeBookAppointmentModal();
      }
      return;
    }

    if (isEditing) return;

    // Alt+A: Agendar Nueva Cita
    if (event.altKey && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      this.openBookAppointmentModal();
      return;
    }

    // Flecha Izquierda: Día anterior
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.goToPreviousDay();
      return;
    }

    // Flecha Derecha: Día siguiente
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.goToNextDay();
      return;
    }

    // Tecla T: Volver a Hoy
    if (event.key === 't' || event.key === 'T') {
      event.preventDefault();
      this.goToToday();
      return;
    }
  }

  // --- NAVEGACIÓN TEMPORAL ---
  goToPreviousDay(): void {
    this.haptics.lightTap();
    this.selectedDate.update((d) => addDaysToDateStr(d, -1));
  }

  goToNextDay(): void {
    this.haptics.lightTap();
    this.selectedDate.update((d) => addDaysToDateStr(d, 1));
  }

  goToToday(): void {
    this.haptics.lightTap();
    this.selectedDate.set(this.todayDateStr());
  }

  selectDate(dateStr: string): void {
    this.haptics.selection();
    this.selectedDate.set(dateStr);
  }

  onDateInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value) {
      this.haptics.selection();
      this.selectedDate.set(input.value);
    }
  }

  // --- FILTROS ---
  setBarberFilter(barberId: string): void {
    this.haptics.lightTap();
    this.selectedBarberFilter.set(barberId);
  }

  setStatusFilter(status: string): void {
    this.haptics.lightTap();
    this.selectedStatusFilter.set(status);
  }

  setViewMode(mode: 'timeline' | 'list'): void {
    this.haptics.lightTap();
    this.viewMode.set(mode);
  }

  // --- NOTIFICACIONES TOAST ---
  showToast(msg: string): void {
    this.toastMessage.set(msg);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toastMessage.set(null), 3500);
  }

  // --- GESTIÓN RÁPIDA DE CITAS ---
  async updateStatus(apt: Appointment, newStatus: AppointmentStatus): Promise<void> {
    if (this.isSubmitting()) return;

    // Si la acción es completar, derivar al checkout POS formal para validar cobro, método de pago y gaveta de caja
    if (newStatus === 'completed') {
      this.completeAppointmentWithCheckout(apt);
      return;
    }

    this.isSubmitting.set(true);
    try {
      this.haptics.selection();
      await this.barberService.updateAppointmentStatus(apt.id, newStatus);
      this.haptics.success();
      const label = this.getStatusLabel(newStatus);
      this.showToast(`Cita de ${apt.clientName} actualizada a: ${label}`);
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(`Error al actualizar estado: ${err.message || 'Error en servidor'}`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  completeAppointmentWithCheckout(apt: Appointment): void {
    this.haptics.selection();
    const serviceIds = apt.services && apt.services.length > 0
      ? apt.services.map((s) => s.serviceId)
      : (apt.serviceId ? [apt.serviceId] : []);

    this.barberService.openRegisterCutModal({
      clientId: apt.clientId,
      barberId: apt.barberId,
      serviceIds,
      customPrice: apt.price,
      notes: `Cita completada (${apt.time} - ${apt.clientName})`,
      appointmentId: apt.id,
    });
  }

  async cancelAppointment(apt: Appointment): Promise<void> {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);
    try {
      this.haptics.warning();
      await this.barberService.updateAppointmentStatus(apt.id, 'cancelled');
      this.showToast(`Cita de las ${apt.time} cancelada`);
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(`Error al cancelar cita: ${err.message || 'Error en servidor'}`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // --- MODAL AGENDAR / EDITAR CITA ---
  openBookAppointmentModal(defaultTime?: string): void {
    this.haptics.lightTap();
    this.barberService.openBookingModal(this.selectedDate(), defaultTime || '10:00');
  }

  openEditAppointmentModal(apt: Appointment): void {
    this.haptics.lightTap();
    this.barberService.openBookingModal(apt.date, apt.time, apt);
  }

  closeBookAppointmentModal(): void {
    this.haptics.lightTap();
    this.barberService.closeBookingModal();
  }

  // Helper visual para etiquetas de estado
  getStatusLabel(status: string): string {
    switch (status) {
      case 'confirmed':
        return 'Confirmada';
      case 'in-progress':
        return 'En atención';
      case 'completed':
        return 'Completada';
      case 'cancelled':
        return 'Cancelada';
      default:
        return 'Pendiente';
    }
  }

  // Generar iniciales de cliente
  getClientInitials(name: string): string {
    if (!name) return 'CL';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
}
