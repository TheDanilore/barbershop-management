import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { SupabaseService } from './core/services/supabase.service';
import { Appointment, Client, PaymentMethod } from './models/barber.models';
import { BarberService } from './services/barber.service';
import { HapticsService } from './services/haptics.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  readonly barberService = inject(BarberService);
  readonly supabaseService = inject(SupabaseService);
  readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  // Pestañas activas gobernadas por Signals
  readonly barberTab = signal<'inicio' | 'agenda' | 'clientes' | 'stats'>('inicio');
  readonly clientTab = signal<'inicio' | 'fidelidad' | 'historial' | 'perfil'>('inicio');

  // Estado de modales
  readonly isRegisterCutModalOpen = signal(false);
  readonly isBookAppointmentModalOpen = signal(false);
  readonly isNewClientModalOpen = signal(false);
  readonly isReviewModalOpen = signal(false);
  readonly isDailyCashModalOpen = signal(false);

  // Prevención de envíos múltiples (Double-click protection)
  readonly isSubmitting = signal(false);

  // Filtro de búsqueda en clientes
  readonly clientSearchQuery = signal('');

  // Toast / Mensajes de feedback
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Horarios disponibles para citas
  readonly availableTimeSlots = [
    '09:00',
    '09:45',
    '10:30',
    '11:15',
    '12:00',
    '14:00',
    '14:45',
    '15:30',
    '16:15',
    '17:00',
    '17:45',
    '18:30',
    '19:15',
  ];

  // ---------------------------------------------------------------------------
  // REACTIVE FORMS BLINDADOS (Validación Estricta UX/Seguridad)
  // ---------------------------------------------------------------------------
  readonly cutForm: FormGroup = this.fb.group({
    clientId: ['', [Validators.required]],
    serviceId: ['srv-1', [Validators.required]],
    customPrice: [null, [Validators.min(0.01), Validators.max(9999)]],
    paymentMethod: ['cash', [Validators.required]],
    notes: [''],
  });

  readonly newClientForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    phone: ['', [Validators.required, Validators.pattern(/^[+0-9\s-]{7,20}$/)]],
    notes: [''],
  });

  readonly bookingForm: FormGroup = this.fb.group({
    serviceId: ['srv-1', [Validators.required]],
    barberId: ['barber-1', [Validators.required]],
    date: [new Date().toISOString().slice(0, 10), [Validators.required]],
    time: ['10:00', [Validators.required]],
    notes: [''],
  });

  readonly reviewForm: FormGroup = this.fb.group({
    rating: [5, [Validators.required, Validators.min(1), Validators.max(5)]],
    comment: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
  });

  // Clientes filtrados reactivamente por búsqueda
  readonly filteredClients = computed(() => {
    const q = this.clientSearchQuery().toLowerCase().trim();
    if (!q) return this.barberService.clients();
    return this.barberService
      .clients()
      .filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  });

  // Clientes destacados por fidelidad
  readonly topLoyaltyClients = computed(() => {
    return [...this.barberService.clients()]
      .sort((a, b) => b.loyaltyStamps - a.loyaltyStamps)
      .slice(0, 4);
  });

  constructor() {
    // Inicializar cliente por defecto en el formulario
    const firstCli = this.barberService.clients()[0];
    if (firstCli) {
      this.cutForm.patchValue({ clientId: firstCli.id });
    }

    // Limpieza de timers al destruir
    this.destroyRef.onDestroy(() => {
      if (this.toastTimeout) clearTimeout(this.toastTimeout);
    });
  }

  // Navegación de roles
  selectRole(role: 'barber' | 'client'): void {
    this.haptics.lightTap();
    this.barberService.setRole(role);
  }

  goToLanding(): void {
    this.haptics.lightTap();
    this.barberService.setRole('landing');
  }

  switchRole(): void {
    this.haptics.lightTap();
    const current = this.barberService.currentRole();
    if (current === 'barber') {
      this.barberService.setRole('client');
      this.showToast('Cambiado a Vista Cliente');
    } else {
      this.barberService.setRole('barber');
      this.showToast('Cambiado a Vista Barbero');
    }
  }

  setBarberTab(tab: 'inicio' | 'agenda' | 'clientes' | 'stats'): void {
    this.haptics.lightTap();
    this.barberTab.set(tab);
  }

  setClientTab(tab: 'inicio' | 'fidelidad' | 'historial' | 'perfil'): void {
    this.haptics.lightTap();
    this.clientTab.set(tab);
  }

  // ---------------------------------------------------------------------------
  // GESTIÓN DEL MODAL: REGISTRAR CORTE
  // ---------------------------------------------------------------------------
  openRegisterCutModal(preselectedClientId?: string): void {
    this.haptics.lightTap();
    const clientId = preselectedClientId || this.cutForm.get('clientId')?.value || this.barberService.clients()[0]?.id || '';
    this.cutForm.reset({
      clientId,
      serviceId: this.barberService.services()[0]?.id || 'srv-1',
      customPrice: null,
      paymentMethod: 'cash',
      notes: '',
    });
    this.isRegisterCutModalOpen.set(true);
  }

  closeRegisterCutModal(): void {
    this.haptics.lightTap();
    this.isRegisterCutModalOpen.set(false);
  }

  selectService(serviceId: string): void {
    this.haptics.selection();
    this.cutForm.patchValue({ serviceId });
  }

  selectPaymentMethod(method: PaymentMethod): void {
    this.haptics.selection();
    this.cutForm.patchValue({ paymentMethod: method });
  }

  async submitRegisterCut(): Promise<void> {
    if (this.cutForm.invalid || this.isSubmitting()) {
      this.cutForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Por favor completa todos los campos requeridos');
      return;
    }

    const { clientId, serviceId, customPrice, paymentMethod, notes } = this.cutForm.value;

    this.isSubmitting.set(true);
    try {
      const cut = await this.barberService.registerCut({
        clientId,
        barberId: 'barber-1',
        serviceId,
        customPrice: customPrice ? Number(customPrice) : undefined,
        paymentMethod,
        notes: notes ? notes.trim() : undefined,
      });

      this.haptics.success();
      this.isRegisterCutModalOpen.set(false);
      this.showToast(`¡Corte registrado con éxito! ($${cut.price.toFixed(2)})`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // GESTIÓN DEL MODAL: NUEVO CLIENTE
  // ---------------------------------------------------------------------------
  openNewClientModal(): void {
    this.haptics.lightTap();
    this.newClientForm.reset({
      fullName: '',
      phone: '',
      notes: '',
    });
    this.isNewClientModalOpen.set(true);
  }

  closeNewClientModal(): void {
    this.haptics.lightTap();
    this.isNewClientModalOpen.set(false);
  }

  async submitNewClient(): Promise<void> {
    if (this.newClientForm.invalid || this.isSubmitting()) {
      this.newClientForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Verifica el nombre y teléfono del cliente');
      return;
    }

    const { fullName, phone, notes } = this.newClientForm.value;
    const cleanName = fullName.trim();
    const cleanPhone = phone.trim();

    this.isSubmitting.set(true);
    try {
      const newClient = await this.barberService.createClient(cleanName, cleanPhone, undefined, notes?.trim());
      this.cutForm.patchValue({ clientId: newClient.id });
      this.haptics.success();
      this.isNewClientModalOpen.set(false);
      this.showToast(`Cliente ${cleanName} creado correctamente`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // GESTIÓN DEL MODAL: AGENDAR CITA
  // ---------------------------------------------------------------------------
  openBookAppointmentModal(preselectedBarberId?: string): void {
    this.haptics.lightTap();
    this.bookingForm.reset({
      serviceId: this.barberService.services()[0]?.id || 'srv-1',
      barberId: preselectedBarberId || 'barber-1',
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

  selectBookingTime(time: string): void {
    this.haptics.selection();
    this.bookingForm.patchValue({ time });
  }

  async submitBooking(): Promise<void> {
    if (this.bookingForm.invalid || this.isSubmitting()) {
      this.bookingForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Completa los datos de la reserva');
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
        notes: notes ? notes.trim() : undefined,
      });

      this.haptics.success();
      this.isBookAppointmentModalOpen.set(false);
      this.showToast(`¡Cita agendada para el ${apt.date} a las ${apt.time}!`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // ACCIONES DE AGENDA
  // ---------------------------------------------------------------------------
  markAppointmentCompleted(apt: Appointment): void {
    this.haptics.success();
    this.barberService.updateAppointmentStatus(apt.id, 'completed');
    this.showToast(`Cita de ${apt.clientName} completada`);
  }

  cancelAppointment(apt: Appointment): void {
    this.haptics.warning();
    this.barberService.updateAppointmentStatus(apt.id, 'cancelled');
    this.showToast(`Cita de las ${apt.time} cancelada`);
  }

  // ---------------------------------------------------------------------------
  // VALORACIONES
  // ---------------------------------------------------------------------------
  openReviewModal(): void {
    this.haptics.lightTap();
    this.reviewForm.reset({ rating: 5, comment: '' });
    this.isReviewModalOpen.set(true);
  }

  closeReviewModal(): void {
    this.haptics.lightTap();
    this.isReviewModalOpen.set(false);
  }

  setRating(stars: number): void {
    this.haptics.selection();
    this.reviewForm.patchValue({ rating: stars });
  }

  submitReview(): void {
    if (this.reviewForm.invalid) {
      this.reviewForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Escribe un comentario válido para enviar tu opinión');
      return;
    }

    const { rating, comment } = this.reviewForm.value;
    this.barberService.addReview(rating, comment.trim());
    this.haptics.success();
    this.isReviewModalOpen.set(false);
    this.showToast('¡Gracias por tu valoración!');
  }

  openDailyCashModal(): void {
    this.haptics.lightTap();
    this.isDailyCashModalOpen.set(true);
  }

  closeDailyCashModal(): void {
    this.haptics.lightTap();
    this.isDailyCashModalOpen.set(false);
  }

  // Feedback Toast seguro
  showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage.set(null);
    }, 3500);
  }

  // Helpers de visualización
  formatDate(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      return date.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoDate;
    }
  }

  getPaymentLabel(method: string): string {
    switch (method) {
      case 'cash':
        return 'Efectivo';
      case 'card':
        return 'Tarjeta';
      case 'transfer':
        return 'Yape / Transf.';
      default:
        return method;
    }
  }

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
