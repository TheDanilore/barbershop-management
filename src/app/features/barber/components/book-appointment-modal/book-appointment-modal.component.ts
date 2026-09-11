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
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Appointment, AppointmentServiceItem, ServiceItem } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { LoggerService } from '../../../../core/services/logger.service';
import {
  getLocalDateString,
  getLocalTimeString,
  isDateInPast,
  isPastDateTime,
} from '../../../../core/utils/date.utils';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-book-appointment-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './book-appointment-modal.component.html',
  styleUrl: './book-appointment-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookAppointmentModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly logger = inject(LoggerService);

  @Input() isOpen = false;
  @Input() initialDate?: string;
  @Input() initialTime?: string;
  @Input() appointmentToEdit: Appointment | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() appointmentBooked = new EventEmitter<Appointment>();
  @Output() appointmentUpdated = new EventEmitter<Appointment>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // Fecha y hora local actual reactiva
  readonly todayDateStr = computed(() => getLocalDateString());
  readonly currentLocalTime = signal<string>(getLocalTimeString());

  // Es modo edición de cita existente?
  readonly isEditMode = computed(() => !!this.appointmentToEdit);

  // Franjas horarias disponibles del negocio
  readonly availableTimeSlots = [
    '08:30', '09:15', '10:00', '10:45', '11:30', '12:15',
    '14:00', '14:45', '15:30', '16:15', '17:00', '17:45',
    '18:30', '19:15', '20:00',
  ];

  // Servicios seleccionados reactivos (soporte multi-servicio / combos)
  readonly selectedServiceIds = signal<string[]>([]);
  readonly isToDefine = signal<boolean>(false);

  // Señales reactivas para cálculo del resumen en vivo
  readonly currentBarberId = signal<string>('');
  readonly currentDate = signal<string>(getLocalDateString());
  readonly currentTime = signal<string>('10:00');

  // Validador de formulario para asegurar que la cita siempre sea en el futuro
  private readonly futureAppointmentValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
    const group = control as FormGroup;
    const date = group.get('date')?.value;
    const time = group.get('time')?.value;
    if (!date || !time) return null;

    // Si es edición y no se modificaron fecha y hora, permitirlo
    if (this.isEditMode() && this.appointmentToEdit?.date === date && this.appointmentToEdit?.time === time) {
      return null;
    }

    if (isPastDateTime(date, time)) {
      return { pastAppointment: true };
    }
    return null;
  };

  // Formulario reactivo
  readonly bookingForm: FormGroup = this.fb.group({
    clientId: ['', [Validators.required]],
    barberId: ['', [Validators.required]],
    date: [getLocalDateString(), [Validators.required]],
    time: ['10:00', [Validators.required]],
    notes: [''],
  }, { validators: [this.futureAppointmentValidator] });

  // Lista detallada de servicios seleccionados
  readonly selectedServicesList = computed<AppointmentServiceItem[]>(() => {
    if (this.isToDefine()) {
      return [
        {
          serviceId: 'to_define',
          name: 'Por definir / Asesoría en sillón',
          price: 0,
          durationMinutes: 30,
        },
      ];
    }
    const ids = this.selectedServiceIds();
    const allServices = this.barberService.services();
    return ids
      .map((id) => allServices.find((s) => s.id === id))
      .filter((s): s is ServiceItem => !!s)
      .map((s) => ({
        serviceId: s.id,
        name: s.name,
        price: s.price,
        durationMinutes: s.durationMinutes,
      }));
  });

  // Total acumulado estimado de la cita
  readonly totalEstimatedPrice = computed(() => {
    return this.selectedServicesList().reduce((sum, s) => sum + s.price, 0);
  });

  // Duración total acumulada estimada
  readonly totalEstimatedDuration = computed(() => {
    return this.selectedServicesList().reduce((sum, s) => sum + s.durationMinutes, 0);
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
    const editingId = this.appointmentToEdit?.id;
    const map = new Map<string, string>();
    for (const apt of this.barberService.appointments()) {
      if (apt.date === targetDate && apt.status !== 'cancelled' && apt.id !== editingId) {
        map.set(apt.time, apt.clientName);
      }
    }
    return map;
  });

  // Determinar si una hora específica está deshabilitada (pasada)
  isSlotDisabled(slot: string): boolean {
    const selectedDate = this.currentDate();
    const today = this.todayDateStr();

    // Fecha en el pasado
    if (selectedDate < today) return true;

    // Fecha de hoy y hora ya transcurrida
    if (selectedDate === today && slot <= this.currentLocalTime()) {
      // Excepción: cita en edición conservando su horario original
      if (this.isEditMode() && this.appointmentToEdit?.date === selectedDate && this.appointmentToEdit?.time === slot) {
        return false;
      }
      return true;
    }

    return false;
  }

  // Buscar el primer slot disponible y futuro para agendar
  getFirstAvailableFutureSlot(dateStr: string): string {
    const today = this.todayDateStr();
    const nowTime = this.currentLocalTime();
    const occupied = this.occupiedSlotsOnSelectedDate();

    // 1. Priorizar slot futuro no ocupado
    for (const slot of this.availableTimeSlots) {
      const isPast = dateStr < today || (dateStr === today && slot <= nowTime);
      if (!isPast && !occupied.has(slot)) {
        return slot;
      }
    }
    // 2. Si todos están ocupados, tomar el primer futuro
    for (const slot of this.availableTimeSlots) {
      const isPast = dateStr < today || (dateStr === today && slot <= nowTime);
      if (!isPast) return slot;
    }
    return this.availableTimeSlots[0];
  }

  constructor() {
    // Sincronizar reloj reactivo cada 30 segundos
    const timer = setInterval(() => {
      this.currentLocalTime.set(getLocalTimeString());
    }, 30000);
    this.destroyRef.onDestroy(() => clearInterval(timer));

    this.bookingForm.get('barberId')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => this.currentBarberId.set(val || ''));

    this.bookingForm.get('date')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => {
        const d = val || getLocalDateString();
        this.currentDate.set(d);
        // Si el horario seleccionado es inválido en la nueva fecha, auto-seleccionar el primer slot futuro
        if (this.isSlotDisabled(this.currentTime())) {
          const nextSlot = this.getFirstAvailableFutureSlot(d);
          this.bookingForm.patchValue({ time: nextSlot });
          this.currentTime.set(nextSlot);
        }
      });

    this.bookingForm.get('time')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => this.currentTime.set(val || '10:00'));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      this.resetAndInitForm();
    }
  }

  private resetAndInitForm(): void {
    this.errorMessage.set(null);
    const apt = this.appointmentToEdit;
    const firstClient = this.barberService.clients()[0];
    const firstBarber = this.barberService.barbers()[0];
    const firstService = this.barberService.services()[0];

    if (apt) {
      // MODO EDICIÓN
      this.bookingForm.reset({
        clientId: apt.clientId || firstClient?.id || '',
        barberId: apt.barberId || firstBarber?.id || '',
        date: apt.date || getLocalDateString(),
        time: apt.time || '10:00',
        notes: apt.notes || '',
      });

      this.currentBarberId.set(apt.barberId || firstBarber?.id || '');
      this.currentDate.set(apt.date || getLocalDateString());
      this.currentTime.set(apt.time || '10:00');

      if (apt.services && apt.services.length > 0) {
        const isDef = apt.services.some((s) => s.serviceId === 'to_define');
        if (isDef) {
          this.isToDefine.set(true);
          this.selectedServiceIds.set([]);
        } else {
          this.isToDefine.set(false);
          this.selectedServiceIds.set(apt.services.map((s) => s.serviceId));
        }
      } else if (apt.serviceId === 'to_define') {
        this.isToDefine.set(true);
        this.selectedServiceIds.set([]);
      } else {
        this.isToDefine.set(false);
        this.selectedServiceIds.set(apt.serviceId ? [apt.serviceId] : (firstService ? [firstService.id] : []));
      }
    } else {
      // MODO CREACIÓN NUEVA
      const today = this.todayDateStr();
      const rawDate = this.initialDate || today;
      const targetDate = rawDate < today ? today : rawDate;

      // Calcular horario seguro en el futuro
      let targetTime = this.initialTime;
      if (!targetTime || (targetDate === today && targetTime <= this.currentLocalTime())) {
        targetTime = this.getFirstAvailableFutureSlot(targetDate);
      }
      const barberId = firstBarber?.id || '';

      this.bookingForm.reset({
        clientId: firstClient?.id || '',
        barberId,
        date: targetDate,
        time: targetTime,
        notes: '',
      });

      this.currentBarberId.set(barberId);
      this.currentDate.set(targetDate);
      this.currentTime.set(targetTime);

      this.isToDefine.set(false);
      this.selectedServiceIds.set(firstService ? [firstService.id] : []);
    }
  }

  toggleService(serviceId: string): void {
    this.haptics.selection();
    this.isToDefine.set(false);
    this.errorMessage.set(null);

    this.selectedServiceIds.update((current) => {
      if (current.includes(serviceId)) {
        const next = current.filter((id) => id !== serviceId);
        // Si no queda ninguno, marcar automáticamente "Por definir"
        if (next.length === 0) {
          this.isToDefine.set(true);
          return [];
        }
        return next;
      } else {
        return [...current, serviceId];
      }
    });
  }

  setToDefineService(): void {
    this.haptics.selection();
    this.errorMessage.set(null);
    this.isToDefine.set(true);
    this.selectedServiceIds.set([]);
  }

  isServiceSelected(serviceId: string): boolean {
    return !this.isToDefine() && this.selectedServiceIds().includes(serviceId);
  }

  selectTimeChip(slot: string): void {
    if (this.isSlotDisabled(slot)) {
      this.haptics.warning();
      this.errorMessage.set(`El horario ${slot} ya ha transcurrido. Por favor selecciona una hora futura.`);
      return;
    }
    this.haptics.selection();
    this.errorMessage.set(null);
    this.bookingForm.patchValue({ time: slot });
  }

  closeModal(): void {
    this.haptics.lightTap();
    this.errorMessage.set(null);
    this.closed.emit();
  }

  async submitBookAppointment(): Promise<void> {
    this.errorMessage.set(null);

    if (this.bookingForm.invalid || this.isSubmitting()) {
      if (this.bookingForm.hasError('pastAppointment')) {
        this.errorMessage.set('No es posible agendar una cita en una fecha u horario que ya ha transcurrido.');
      }
      this.bookingForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    if (!this.isToDefine() && this.selectedServiceIds().length === 0) {
      this.errorMessage.set('Debes seleccionar al menos un servicio o marcar "Por definir / Asesoría".');
      this.haptics.warning();
      return;
    }

    const { clientId, barberId, date, time, notes } = this.bookingForm.value;
    const services = this.selectedServicesList();
    this.isSubmitting.set(true);

    try {
      if (this.isEditMode() && this.appointmentToEdit) {
        const updatedApt = await this.barberService.updateAppointment(this.appointmentToEdit.id, {
          clientId,
          barberId,
          services,
          date,
          time,
          notes: notes?.trim() || undefined,
        });

        this.haptics.success();
        this.appointmentUpdated.emit(updatedApt);
        this.closeModal();
      } else {
        const newApt = await this.barberService.bookAppointment({
          clientId: clientId || this.barberService.clients()[0]?.id || '',
          barberId,
          services,
          date,
          time,
          notes: notes?.trim() || undefined,
        });

        this.haptics.success();
        this.appointmentBooked.emit(newApt);
        this.closeModal();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al procesar la cita';
      this.logger.error('BookAppointmentModalComponent', 'Fallo al procesar cita', err);
      this.errorMessage.set(msg);
      this.haptics.warning();
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
