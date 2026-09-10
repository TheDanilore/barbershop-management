import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Client, MovementType, PaymentMethod, ServiceItem, SystemUser, UserRole } from '../../../core/models/barber.models';
import { BarberService } from '../../../core/services/barber.service';
import { HapticsService } from '../../../core/services/haptics.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { BarberMetrics } from '../components/barber-metrics/barber-metrics';
import { BarberSchedule } from '../components/barber-schedule/barber-schedule';

export type BarberTabType = 'overview' | 'appointments' | 'clients' | 'services' | 'cash' | 'stats' | 'users' | 'profile';

@Component({
  selector: 'app-barber-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    BarberMetrics,
    BarberSchedule,
  ],
  templateUrl: './barber-dashboard.page.html',
  styleUrl: './barber-dashboard.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberDashboardPage implements OnInit {
  readonly barberService = inject(BarberService);
  readonly supabaseService = inject(SupabaseService);
  readonly haptics = inject(HapticsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  // Active tab synchronized with URL
  readonly activeTab = signal<BarberTabType>('overview');
  // Backwards compatibility alias
  readonly barberTab = this.activeTab;

  // Modales principales
  readonly isRegisterCutModalOpen = signal(false);
  readonly isBookAppointmentModalOpen = signal(false);
  readonly isNewClientModalOpen = signal(false);
  readonly isDailyCashModalOpen = signal(false);

  // Nuevos Modales Empresariales (Servicios, Caja, Movimientos, Abonos, Usuarios)
  readonly isServiceModalOpen = signal(false);
  readonly editingServiceId = signal<string | null>(null);

  readonly isShiftModalOpen = signal(false);
  readonly shiftMode = signal<'open' | 'close'>('open');

  readonly isMovementModalOpen = signal(false);
  readonly isTransferModalOpen = signal(false);

  readonly isDebtPaymentModalOpen = signal(false);
  readonly debtPaymentClient = signal<Client | null>(null);

  readonly isUserModalOpen = signal(false);
  readonly editingUserId = signal<string | null>(null);

  // Prevención multi-tap
  readonly isSubmitting = signal(false);

  // Filtro de clientes
  readonly clientSearchQuery = signal('');

  // Toast
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Horarios de cita
  readonly availableTimeSlots = [
    '09:00', '09:45', '10:30', '11:15', '12:00',
    '14:00', '14:45', '15:30', '16:15', '17:00',
    '17:45', '18:30', '19:15',
  ];

  // ---------------------------------------------------------------------------
  // FORMULARIOS REACTIVOS
  // ---------------------------------------------------------------------------
  readonly cutForm: FormGroup = this.fb.group({
    clientId: ['', [Validators.required]],
    serviceId: ['srv-1', [Validators.required]],
    customPrice: [null, [Validators.min(0.01), Validators.max(9999)]],
    paymentMethod: ['cash', [Validators.required]],
    isCredit: [false],
    notes: [''],
  });

  // Solo nombre completo es obligatorio para alta ultra-rápida
  readonly newClientForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    phone: ['', [Validators.pattern(/^[+0-9\s-]{7,20}$/)]],
    notes: [''],
  });

  readonly bookingForm: FormGroup = this.fb.group({
    serviceId: ['srv-1', [Validators.required]],
    barberId: ['barber-1', [Validators.required]],
    date: [new Date().toISOString().slice(0, 10), [Validators.required]],
    time: ['10:00', [Validators.required]],
    notes: [''],
  });

  readonly serviceForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    price: [15, [Validators.required, Validators.min(0.5)]],
    durationMinutes: [30, [Validators.required, Validators.min(5)]],
  });

  readonly openShiftForm: FormGroup = this.fb.group({
    initialCash: [30.0, [Validators.required, Validators.min(0)]],
    notes: [''],
  });

  readonly closeShiftForm: FormGroup = this.fb.group({
    actualCash: [null, [Validators.required, Validators.min(0)]],
    notes: [''],
  });

  readonly movementForm: FormGroup = this.fb.group({
    accountId: ['', [Validators.required]],
    movementType: ['income', [Validators.required]],
    amount: [null, [Validators.required, Validators.min(0.5)]],
    description: ['', [Validators.required, Validators.minLength(3)]],
  });

  readonly transferForm: FormGroup = this.fb.group({
    fromAccountId: ['', [Validators.required]],
    toAccountId: ['', [Validators.required]],
    amount: [null, [Validators.required, Validators.min(0.5)]],
    description: ['Transferencia entre cuentas', [Validators.required]],
  });

  readonly debtPaymentForm: FormGroup = this.fb.group({
    amount: [null, [Validators.required, Validators.min(0.5)]],
    accountId: ['', [Validators.required]],
    paymentMethod: ['cash', [Validators.required]],
    notes: [''],
  });

  readonly userForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    phone: ['', [Validators.pattern(/^[+0-9\s-]{7,20}$/)]],
    role: ['barber', [Validators.required]],
    isActive: [true],
  });

  readonly profileForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    phone: ['', [Validators.pattern(/^[+0-9\s-]{7,20}$/)]],
  });

  readonly isEditingProfile = signal(false);

  readonly filteredClients = computed(() => {
    const q = this.clientSearchQuery().toLowerCase().trim();
    if (!q) return this.barberService.clients();
    return this.barberService
      .clients()
      .filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  });

  readonly topLoyaltyClients = computed(() => {
    return [...this.barberService.clients()]
      .sort((a, b) => b.loyaltyStamps - a.loyaltyStamps)
      .slice(0, 4);
  });

  readonly clientsWithDebt = computed(() => {
    return this.barberService.clients().filter((c) => (c.currentDebt || 0) > 0);
  });

  constructor() {
    const firstCli = this.barberService.clients()[0];
    if (firstCli) {
      this.cutForm.patchValue({ clientId: firstCli.id });
    }

    this.destroyRef.onDestroy(() => {
      if (this.toastTimeout) clearTimeout(this.toastTimeout);
    });
  }

  ngOnInit(): void {
    // Sincronizar ruta activa con la pestaña en inglés (con takeUntilDestroyed para prevenir memory leaks)
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const tabParam = params.get('tab') as string;
        if (tabParam && ['overview', 'appointments', 'clients', 'services', 'cash', 'stats', 'users', 'profile'].includes(tabParam)) {
          this.activeTab.set(tabParam as BarberTabType);
        } else if (tabParam === 'inicio') {
          this.setTab('overview');
        } else if (tabParam === 'agenda') {
          this.setTab('appointments');
        } else if (tabParam === 'clientes') {
          this.setTab('clients');
        } else if (tabParam === 'servicios') {
          this.setTab('services');
        } else if (tabParam === 'caja') {
          this.setTab('cash');
        } else if (tabParam === 'usuarios') {
          this.setTab('users');
        } else {
          this.activeTab.set('overview');
        }
      });

    if (this.supabaseService.isConfigured() && this.supabaseService.isAuthenticated) {
      this.barberService.syncFromSupabase();
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closeAllModals();
      event.preventDefault();
      return;
    }

    if (event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        this.openRegisterCutModal();
      } else if (key === 'a') {
        event.preventDefault();
        this.openBookAppointmentModal();
      } else if (key === 'c') {
        event.preventDefault();
        this.openNewClientModal();
      }
    }
  }

  closeAllModals(): void {
    this.isRegisterCutModalOpen.set(false);
    this.isBookAppointmentModalOpen.set(false);
    this.isNewClientModalOpen.set(false);
    this.isDailyCashModalOpen.set(false);
    this.isServiceModalOpen.set(false);
    this.isShiftModalOpen.set(false);
    this.isMovementModalOpen.set(false);
    this.isTransferModalOpen.set(false);
    this.isDebtPaymentModalOpen.set(false);
    this.isUserModalOpen.set(false);
  }

  setTab(tab: BarberTabType): void {
    this.haptics.lightTap();
    this.activeTab.set(tab);
    if (tab === 'overview') {
      this.router.navigate(['/barber']);
    } else {
      this.router.navigate(['/barber', tab]);
    }
  }

  switchToCustomer(): void {
    this.haptics.lightTap();
    this.barberService.setRole('client');
    this.router.navigate(['/customer']);
  }

  logout(): void {
    this.haptics.lightTap();
    this.supabaseService.signOut();
    this.router.navigate(['/login']);
  }

  // ---------------------------------------------------------------------------
  // COBRO DE CORTES (CONTADO O CRÉDITO/FIADO)
  // ---------------------------------------------------------------------------
  openRegisterCutModal(preselectedClientId?: string): void {
    this.haptics.lightTap();
    const clientId = preselectedClientId || this.cutForm.get('clientId')?.value || this.barberService.clients()[0]?.id || '';
    this.cutForm.reset({
      clientId,
      serviceId: this.barberService.services()[0]?.id || 'srv-1',
      customPrice: null,
      paymentMethod: 'cash',
      isCredit: false,
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

  toggleIsCredit(isCredit: boolean): void {
    this.haptics.selection();
    this.cutForm.patchValue({ isCredit });
  }

  async submitRegisterCut(): Promise<void> {
    if (this.cutForm.invalid || this.isSubmitting()) {
      this.cutForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Completa todos los campos requeridos');
      return;
    }

    // Guard: los pagos en efectivo requieren un turno de caja abierto
    const pm = this.cutForm.get('paymentMethod')?.value;
    const creditMode = this.cutForm.get('isCredit')?.value;
    if (pm === 'cash' && !creditMode && !this.barberService.activeCashShift()) {
      this.haptics.warning();
      this.showToast('⚠️ La caja está cerrada. Abre un turno antes de registrar efectivo.');
      return;
    }

    const { clientId, serviceId, customPrice, paymentMethod, isCredit, notes } = this.cutForm.value;

    this.isSubmitting.set(true);
    try {
      const cut = await this.barberService.registerCut({
        clientId,
        barberId: 'barber-1',
        serviceId,
        customPrice: customPrice ? Number(customPrice) : undefined,
        paymentMethod,
        isCredit: Boolean(isCredit),
        notes: notes?.trim(),
      });

      this.haptics.success();
      this.isRegisterCutModalOpen.set(false);
      if (isCredit) {
        this.showToast(`¡Corte fiado al crédito registrado! ($${cut.price.toFixed(2)})`);
      } else {
        this.showToast(`¡Cobro registrado con éxito! ($${cut.price.toFixed(2)})`);
      }
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // ALTA RÁPIDA DE CLIENTES
  // ---------------------------------------------------------------------------
  openNewClientModal(): void {
    this.haptics.lightTap();
    this.newClientForm.reset({ fullName: '', phone: '', notes: '' });
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
      this.showToast('Ingresa el nombre del cliente');
      return;
    }

    const { fullName, phone, notes } = this.newClientForm.value;
    const cleanName = fullName.trim();
    const cleanPhone = phone ? phone.trim() : '';

    this.isSubmitting.set(true);
    try {
      const newClient = await this.barberService.createClient(cleanName, cleanPhone, undefined, notes?.trim());
      this.cutForm.patchValue({ clientId: newClient.id });
      this.haptics.success();
      this.isNewClientModalOpen.set(false);
      this.showToast(`Cliente ${cleanName} añadido con éxito`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // ABONO DE DEUDAS DE CLIENTES
  // ---------------------------------------------------------------------------
  openDebtPaymentModal(client: Client): void {
    this.haptics.lightTap();
    this.debtPaymentClient.set(client);
    const defaultAcc = this.barberService.financialAccounts()[0]?.id || '';
    this.debtPaymentForm.reset({
      amount: client.currentDebt || null,
      accountId: defaultAcc,
      paymentMethod: 'cash',
      notes: '',
    });
    this.isDebtPaymentModalOpen.set(true);
  }

  closeDebtPaymentModal(): void {
    this.isDebtPaymentModalOpen.set(false);
    this.debtPaymentClient.set(null);
  }

  async submitDebtPayment(): Promise<void> {
    const client = this.debtPaymentClient();
    if (!client || this.debtPaymentForm.invalid || this.isSubmitting()) return;

    const { amount, accountId, paymentMethod, notes } = this.debtPaymentForm.value;

    this.isSubmitting.set(true);
    try {
      await this.barberService.registerCreditPayment({
        clientId: client.id,
        amount: Number(amount),
        accountId,
        paymentMethod,
        notes: notes?.trim(),
      });
      this.haptics.success();
      this.closeDebtPaymentModal();
      this.showToast(`Abono de $${amount} registrado a ${client.name}`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // GESTIÓN DE SERVICIOS
  // ---------------------------------------------------------------------------
  openCreateServiceModal(): void {
    this.haptics.lightTap();
    this.editingServiceId.set(null);
    this.serviceForm.reset({ name: '', price: 15, durationMinutes: 30 });
    this.isServiceModalOpen.set(true);
  }

  openEditServiceModal(srv: ServiceItem): void {
    this.haptics.lightTap();
    this.editingServiceId.set(srv.id);
    this.serviceForm.reset({
      name: srv.name,
      price: srv.price,
      durationMinutes: srv.durationMinutes,
    });
    this.isServiceModalOpen.set(true);
  }

  closeServiceModal(): void {
    this.isServiceModalOpen.set(false);
    this.editingServiceId.set(null);
  }

  async submitService(): Promise<void> {
    if (this.serviceForm.invalid || this.isSubmitting()) return;

    const { name, price, durationMinutes } = this.serviceForm.value;
    const editingId = this.editingServiceId();

    this.isSubmitting.set(true);
    try {
      if (editingId) {
        const current = this.barberService.services().find((s) => s.id === editingId);
        await this.barberService.updateService(
          editingId,
          name,
          Number(price),
          Number(durationMinutes),
          current?.isActive ?? true
        );
        this.showToast(`Servicio "${name}" actualizado`);
      } else {
        await this.barberService.createService(name, Number(price), Number(durationMinutes));
        this.showToast(`Nuevo servicio "${name}" añadido`);
      }
      this.haptics.success();
      this.closeServiceModal();
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async toggleService(srv: ServiceItem): Promise<void> {
    const nextState = !srv.isActive;
    await this.barberService.toggleServiceStatus(srv.id, nextState);
    this.haptics.lightTap();
    this.showToast(nextState ? `Servicio ${srv.name} activado` : `Servicio ${srv.name} desactivado`);
  }

  // ---------------------------------------------------------------------------
  // TURNOS DE CAJA (APERTURA Y CIERRE CON ARQUEO)
  // ---------------------------------------------------------------------------
  openStartShiftModal(): void {
    this.haptics.lightTap();
    this.shiftMode.set('open');
    this.openShiftForm.reset({ initialCash: 30.0, notes: '' });
    this.isShiftModalOpen.set(true);
  }

  openCloseShiftModal(): void {
    this.haptics.lightTap();
    this.shiftMode.set('close');
    const active = this.barberService.activeCashShift();
    this.closeShiftForm.reset({ actualCash: active?.expectedCash || null, notes: '' });
    this.isShiftModalOpen.set(true);
  }

  closeShiftModal(): void {
    this.isShiftModalOpen.set(false);
  }

  async submitOpenShift(): Promise<void> {
    if (this.openShiftForm.invalid || this.isSubmitting()) return;
    const { initialCash, notes } = this.openShiftForm.value;

    this.isSubmitting.set(true);
    try {
      await this.barberService.openCashShift(Number(initialCash), notes?.trim());
      this.haptics.success();
      this.closeShiftModal();
      this.showToast(`Turno de caja abierto con fondo base de $${initialCash}`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async submitCloseShift(): Promise<void> {
    if (this.closeShiftForm.invalid || this.isSubmitting()) return;
    const { actualCash, notes } = this.closeShiftForm.value;

    this.isSubmitting.set(true);
    try {
      await this.barberService.closeCashShift(Number(actualCash), notes?.trim());
      this.haptics.success();
      this.closeShiftModal();
      this.showToast(`Turno de caja cerrado y arqueado correctamente`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // MOVIMIENTOS MANUALES & TRANSFERENCIAS
  // ---------------------------------------------------------------------------
  openMovementModal(type: 'income' | 'expense'): void {
    this.haptics.lightTap();
    const defaultAcc = this.barberService.financialAccounts()[0]?.id || '';
    this.movementForm.reset({
      accountId: defaultAcc,
      movementType: type,
      amount: null,
      description: '',
    });
    this.isMovementModalOpen.set(true);
  }

  closeMovementModal(): void {
    this.isMovementModalOpen.set(false);
  }

  async submitMovement(): Promise<void> {
    if (this.movementForm.invalid || this.isSubmitting()) return;
    const { accountId, movementType, amount, description } = this.movementForm.value;

    this.isSubmitting.set(true);
    try {
      await this.barberService.createAccountMovement({
        accountId,
        movementType,
        amount: Number(amount),
        description: description.trim(),
        referenceType: 'manual',
      });
      this.haptics.success();
      this.closeMovementModal();
      this.showToast(movementType === 'income' ? `Ingreso de $${amount} registrado` : `Gasto de $${amount} registrado`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openTransferModal(): void {
    this.haptics.lightTap();
    const accs = this.barberService.financialAccounts();
    this.transferForm.reset({
      fromAccountId: accs[0]?.id || '',
      toAccountId: accs[1]?.id || accs[0]?.id || '',
      amount: null,
      description: 'Transferencia de fondos',
    });
    this.isTransferModalOpen.set(true);
  }

  closeTransferModal(): void {
    this.isTransferModalOpen.set(false);
  }

  async submitTransfer(): Promise<void> {
    if (this.transferForm.invalid || this.isSubmitting()) return;
    const { fromAccountId, toAccountId, amount, description } = this.transferForm.value;

    if (fromAccountId === toAccountId) {
      this.showToast('Selecciona cuentas distintas');
      return;
    }

    this.isSubmitting.set(true);
    try {
      await this.barberService.transferBetweenAccounts(fromAccountId, toAccountId, Number(amount), description.trim());
      this.haptics.success();
      this.closeTransferModal();
      this.showToast(`Transferencia de $${amount} completada`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // CITAS & TOAST
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
      this.showToast('Completa los datos de la cita');
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
      this.isBookAppointmentModalOpen.set(false);
      this.showToast(`¡Cita agendada para las ${apt.time}!`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openDailyCashModal(): void {
    this.setTab('cash');
  }

  closeDailyCashModal(): void {
    this.isDailyCashModalOpen.set(false);
  }

  showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage.set(null);
    }, 3500);
  }

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

  // ---------------------------------------------------------------------------
  // GESTIÓN DE USUARIOS & PERSONAL
  // ---------------------------------------------------------------------------
  openCreateUserModal(): void {
    this.haptics.lightTap();
    this.editingUserId.set(null);
    this.userForm.reset({ fullName: '', phone: '', role: 'barber', isActive: true });
    this.isUserModalOpen.set(true);
  }

  openEditUserModal(user: SystemUser): void {
    this.haptics.lightTap();
    this.editingUserId.set(user.id);
    this.userForm.reset({
      fullName: user.fullName,
      phone: user.phone || '',
      role: user.role,
      isActive: user.isActive,
    });
    this.isUserModalOpen.set(true);
  }

  closeUserModal(): void {
    this.isUserModalOpen.set(false);
    this.editingUserId.set(null);
  }

  async submitUser(): Promise<void> {
    if (this.userForm.invalid || this.isSubmitting()) {
      this.userForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Completa los campos del usuario');
      return;
    }

    const { fullName, phone, role, isActive } = this.userForm.value;
    const editId = this.editingUserId();

    this.isSubmitting.set(true);
    try {
      if (editId) {
        await this.barberService.updateSystemUser(editId, {
          fullName,
          phone,
          role,
          isActive: Boolean(isActive),
        });
        this.showToast(`Usuario ${fullName} actualizado`);
      } else {
        await this.barberService.createSystemUser({
          fullName,
          phone,
          role,
          isActive: Boolean(isActive),
        });
        this.showToast(`Nuevo usuario ${fullName} creado`);
      }
      this.haptics.success();
      this.closeUserModal();
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async toggleUserStatus(user: SystemUser): Promise<void> {
    const nextState = !user.isActive;
    await this.barberService.toggleSystemUserStatus(user.id, nextState);
    this.haptics.lightTap();
    this.showToast(nextState ? `Usuario ${user.fullName} activado` : `Usuario ${user.fullName} desactivado`);
  }

  // ---------------------------------------------------------------------------
  // MI PERFIL — AUTOGESTIÓN DEL USUARIO LOGUEADO
  // ---------------------------------------------------------------------------
  openEditProfile(): void {
    const profile = this.supabaseService.userProfile();
    this.profileForm.reset({
      fullName: profile?.full_name || '',
      phone: profile?.phone || '',
    });
    this.isEditingProfile.set(true);
  }

  cancelEditProfile(): void {
    this.isEditingProfile.set(false);
  }

  async submitProfile(): Promise<void> {
    if (this.profileForm.invalid || this.isSubmitting()) {
      this.profileForm.markAllAsTouched();
      return;
    }
    const { fullName, phone } = this.profileForm.value;
    this.isSubmitting.set(true);
    try {
      const profile = this.supabaseService.userProfile();
      if (profile && this.supabaseService.isConfigured()) {
        const { error } = await this.supabaseService.supabase
          .from('profiles')
          .update({ full_name: fullName.trim(), phone: phone?.trim() || null })
          .eq('id', profile.id);
        if (!error) {
          await this.supabaseService.refreshUserProfile();
          await this.barberService.syncFromSupabase();
          this.haptics.success();
          this.isEditingProfile.set(false);
          this.showToast('✅ Perfil actualizado con éxito');
        } else {
          this.showToast('Error al actualizar perfil en la base de datos');
        }
      } else {
        // Modo offline: solo notificar
        this.showToast('Sin conexión a Supabase — cambios no persistidos');
        this.isEditingProfile.set(false);
      }
    } catch {
      this.showToast('Error inesperado al guardar el perfil');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  getRoleLabelProfile(role: string | undefined): string {
    switch (role) {
      case 'admin': return 'Administrador';
      case 'barber': return 'Barbero / Estilista';
      case 'customer': return 'Cliente';
      default: return 'Usuario';
    }
  }

  getPaymentLabel(method: string): string {
    switch (method) {
      case 'cash': return 'Efectivo';
      case 'card': return 'Tarjeta';
      case 'transfer': return 'Yape / Transf.';
      case 'credit': return 'Crédito (Fiado)';
      default: return method;
    }
  }
}
