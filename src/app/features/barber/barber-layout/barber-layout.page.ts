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
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { PaymentMethod } from '../../../core/models/barber.models';
import { BarberService } from '../../../core/services/barber.service';
import { HapticsService } from '../../../core/services/haptics.service';
import { getLocalDateString } from '../../../core/utils/date.utils';
import { SupabaseService } from '../../../core/services/supabase.service';
import { BookAppointmentModalComponent } from '../components/book-appointment-modal/book-appointment-modal.component';

export type BarberTab =
  | 'overview'
  | 'appointments'
  | 'clients'
  | 'services'
  | 'loyalty'
  | 'cash'
  | 'stats'
  | 'users'
  | 'profile';

@Component({
  selector: 'app-barber-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule, BookAppointmentModalComponent],
  templateUrl: './barber-layout.page.html',
  styleUrl: './barber-layout.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberLayoutPage implements OnInit {
  readonly barberService = inject(BarberService);
  readonly supabaseService = inject(SupabaseService);
  readonly haptics = inject(HapticsService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  // Pestaña activa determinada por la URL actual
  readonly currentTab = signal<BarberTab>('overview');

  // Modales de Acción Rápida Globales
  readonly isRegisterCutModalOpen = signal(false);
  readonly isBookAppointmentModalOpen = signal(false);
  readonly isNewClientModalOpen = signal(false);
  readonly isSubmitting = signal(false);

  // Toast global
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // ---------------------------------------------------------------------------
  // FORMULARIOS REACTIVOS GLOBALES
  // ---------------------------------------------------------------------------
  readonly cutForm: FormGroup = this.fb.group({
    clientId: ['', [Validators.required]],
    serviceId: ['', [Validators.required]],
    customPrice: [null],
    paymentMethod: ['cash' as PaymentMethod, [Validators.required]],
    isCredit: [false],
    notes: [''],
  });

  // Servicios seleccionados reactivos para Cobro Express POS (Soporte multi-servicio / Combos)
  readonly selectedCutServiceIds = signal<string[]>([]);

  readonly selectedCutServices = computed(() => {
    const ids = this.selectedCutServiceIds();
    const allServices = this.barberService.services();
    return ids
      .map((id) => allServices.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s);
  });

  readonly cutCalculatedSubtotal = computed(() => {
    return this.selectedCutServices().reduce((sum, s) => sum + s.price, 0);
  });

  readonly newClientForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    phone: ['', [Validators.pattern(/^[+0-9\s-]{7,20}$/)]],
    notes: [''],
  });

  // Título legible según la ruta activa
  readonly currentTabTitle = computed(() => {
    switch (this.currentTab()) {
      case 'overview': return 'Panel General';
      case 'appointments': return 'Agenda & Turnos';
      case 'clients': return 'Directorio de Clientes';
      case 'services': return 'Catálogo de Servicios';
      case 'loyalty': return 'Fidelización & Recompensas';
      case 'cash': return 'Caja & Cuentas Financieras';
      case 'stats': return 'Finanzas & Métricas';
      case 'users': return 'Usuarios & Equipo';
      case 'profile': return 'Mi Perfil';
      default: return 'Panel General';
    }
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.toastTimeout) clearTimeout(this.toastTimeout);
    });
  }

  ngOnInit(): void {
    // Sincronizar ruta actual con la pestaña activa
    this.extractTabFromUrl(this.router.url);

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((e) => {
        this.extractTabFromUrl(e.urlAfterRedirects || e.url);
      });

    // Sincronizar datos de Supabase si está autenticado
    if (this.supabaseService.isConfigured() && this.supabaseService.isAuthenticated) {
      this.barberService.syncFromSupabase();
    }
  }

  private extractTabFromUrl(url: string): void {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const segments = cleanUrl.split('/').filter(Boolean);
    const last = segments[segments.length - 1];

    if (last === 'barber' || last === 'overview' || last === 'dashboard' || last === 'inicio') {
      this.currentTab.set('overview');
    } else if (last === 'appointments' || last === 'agenda') {
      this.currentTab.set('appointments');
    } else if (last === 'clients' || last === 'clientes') {
      this.currentTab.set('clients');
    } else if (last === 'services' || last === 'servicios') {
      this.currentTab.set('services');
    } else if (last === 'loyalty' || last === 'fidelizacion' || last === 'premios') {
      this.currentTab.set('loyalty');
    } else if (last === 'cash' || last === 'caja') {
      this.currentTab.set('cash');
    } else if (last === 'stats' || last === 'finanzas') {
      this.currentTab.set('stats');
    } else if (last === 'users' || last === 'usuarios') {
      this.currentTab.set('users');
    } else if (last === 'profile' || last === 'perfil') {
      this.currentTab.set('profile');
    } else {
      this.currentTab.set('overview');
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
  }

  navigateTo(tab: BarberTab): void {
    this.haptics.lightTap();
    this.currentTab.set(tab);
    if (tab === 'overview') {
      this.router.navigate(['/barber/overview']);
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

  showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage.set(null);
    }, 3500);
  }

  // ---------------------------------------------------------------------------
  // MODAL REGISTRO DE CORTE (COBRO RÁPIDO POS - MULTI-SERVICIO)
  // ---------------------------------------------------------------------------
  openRegisterCutModal(preselectedClientId?: string): void {
    this.haptics.lightTap();
    const clientId =
      preselectedClientId ||
      this.cutForm.get('clientId')?.value ||
      this.barberService.clients()[0]?.id ||
      '';
    const firstService = this.barberService.services()[0];
    const initialServices = firstService ? [firstService.id] : [];
    this.selectedCutServiceIds.set(initialServices);

    this.cutForm.reset({
      clientId,
      serviceId: firstService?.id || '',
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

  toggleCutService(serviceId: string): void {
    this.haptics.selection();
    const current = this.selectedCutServiceIds();
    let updated: string[];

    if (current.includes(serviceId)) {
      if (current.length > 1) {
        updated = current.filter((id) => id !== serviceId);
      } else {
        this.haptics.warning();
        return;
      }
    } else {
      updated = [...current, serviceId];
    }

    this.selectedCutServiceIds.set(updated);
    this.cutForm.patchValue({ serviceId: updated[0] || '' });
  }

  selectService(serviceId: string): void {
    this.toggleCutService(serviceId);
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

    const pm = this.cutForm.get('paymentMethod')?.value;
    const creditMode = this.cutForm.get('isCredit')?.value;
    if (pm === 'cash' && !creditMode && !this.barberService.activeCashShift()) {
      this.haptics.warning();
      this.showToast('⚠️ La caja está cerrada. Abre un turno antes de registrar efectivo.');
      return;
    }

    const selectedServices = this.selectedCutServices();
    if (selectedServices.length === 0) {
      this.haptics.warning();
      this.showToast('Selecciona al menos un servicio realizado');
      return;
    }

    const { clientId, customPrice, paymentMethod, isCredit, notes } = this.cutForm.value;

    this.isSubmitting.set(true);
    try {
      const activeBarber = this.supabaseService.userProfile();
      const fallbackBarber = this.barberService.barbers()[0];
      const realBarberId = activeBarber?.id || fallbackBarber?.id || '';

      await this.barberService.registerCut({
        clientId,
        barberId: realBarberId,
        serviceId: selectedServices[0].id,
        services: selectedServices.map((s) => ({
          serviceId: s.id,
          name: s.name,
          price: s.price,
          quantity: 1,
        })),
        customPrice: customPrice ? Number(customPrice) : undefined,
        paymentMethod,
        isCredit: Boolean(isCredit),
        notes,
      });

      this.haptics.success();
      const servicesLabel = selectedServices.length > 1 ? ` (${selectedServices.length} servicios)` : '';
      this.showToast(isCredit ? `✅ Orden al Crédito registrada${servicesLabel}` : `✅ Cobro registrado con éxito${servicesLabel}`);
      this.closeRegisterCutModal();
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(err?.message || 'Error al registrar servicio');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // MODAL ALTA RÁPIDA DE CLIENTE
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
    this.isSubmitting.set(true);
    try {
      const cleanName = fullName!.trim();
      const cleanPhone = phone ? phone.trim() : '';
      const newClient = await this.barberService.createClient(
        cleanName,
        cleanPhone,
        undefined,
        notes ? notes.trim() : undefined
      );

      this.haptics.success();
      this.showToast(`Cliente "${newClient.name}" registrado`);
      this.cutForm.patchValue({ clientId: newClient.id });
      this.closeNewClientModal();
    } catch {
      this.haptics.warning();
      this.showToast('Error al crear el cliente');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // MODAL RESERVAR CITA
  // ---------------------------------------------------------------------------
  openBookAppointmentModal(): void {
    this.haptics.lightTap();
    this.barberService.openBookingModal();
  }

  closeBookAppointmentModal(): void {
    this.haptics.lightTap();
    this.barberService.closeBookingModal();
  }

  onAppointmentBooked(apt: any): void {
    this.showToast(`✓ Cita agendada para ${apt.clientName || 'Cliente'} a las ${apt.time}`);
  }

  onAppointmentUpdated(apt: any): void {
    this.showToast(`✓ Cita de ${apt.clientName || 'Cliente'} actualizada correctamente`);
  }

  getRoleLabelProfile(role: string | undefined): string {
    switch (role) {
      case 'admin': return 'Administrador';
      case 'barber': return 'Barbero / Estilista';
      case 'customer': return 'Cliente';
      default: return 'Usuario';
    }
  }
}
