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
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Client } from '../../../core/models/barber.models';
import { BarberService } from '../../../core/services/barber.service';
import { HapticsService } from '../../../core/services/haptics.service';
import { LoggerService } from '../../../core/services/logger.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { BookAppointmentModalComponent } from '../components/book-appointment-modal/book-appointment-modal.component';
import { CommandPaletteComponent } from '../components/command-palette/command-palette.component';
import { DebtPaymentModalComponent } from '../components/debt-payment-modal/debt-payment-modal.component';
import { NewClientModalComponent } from '../components/new-client-modal/new-client-modal.component';
import { RegisterCutModalComponent } from '../components/register-cut-modal/register-cut-modal.component';

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
  imports: [
    CommonModule,
    RouterModule,
    RegisterCutModalComponent,
    NewClientModalComponent,
    BookAppointmentModalComponent,
    DebtPaymentModalComponent,
    CommandPaletteComponent,
  ],
  templateUrl: './barber-layout.page.html',
  styleUrl: './barber-layout.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberLayoutPage implements OnInit {
  readonly barberService = inject(BarberService);
  readonly supabaseService = inject(SupabaseService);
  readonly haptics = inject(HapticsService);
  private readonly logger = inject(LoggerService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Pestaña activa determinada por la URL
  readonly currentTab = signal<BarberTab>('overview');

  // Estado de modales y menús
  readonly isCommandPaletteOpen = signal(false);
  readonly isNewClientModalOpen = signal(false);
  readonly isMobileMoreMenuOpen = signal(false);

  // Toast flotante global
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

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
    this.extractTabFromUrl(this.router.url);

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((e) => {
        this.extractTabFromUrl(e.urlAfterRedirects || e.url);
        this.isMobileMoreMenuOpen.set(false);
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
    // Abrir Command Palette con Cmd+K / Ctrl+K
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.toggleCommandPalette();
      return;
    }

    if (event.key === 'Escape') {
      this.closeAllModals();
      return;
    }

    // Atajos de acción rápida (Alt + Letra)
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

  toggleCommandPalette(): void {
    this.haptics.lightTap();
    this.isCommandPaletteOpen.update((v) => !v);
  }

  closeCommandPalette(): void {
    this.isCommandPaletteOpen.set(false);
  }

  toggleMobileMoreMenu(): void {
    this.haptics.lightTap();
    this.isMobileMoreMenuOpen.update((v) => !v);
  }

  closeMobileMoreMenu(): void {
    this.isMobileMoreMenuOpen.set(false);
  }

  closeAllModals(): void {
    this.barberService.closeRegisterCutModal();
    this.barberService.closeBookingModal();
    this.isNewClientModalOpen.set(false);
    this.isCommandPaletteOpen.set(false);
    this.isMobileMoreMenuOpen.set(false);
  }

  navigateTo(tab: BarberTab): void {
    this.haptics.lightTap();
    this.currentTab.set(tab);
    this.isMobileMoreMenuOpen.set(false);
    if (tab === 'overview') {
      this.router.navigate(['/barber/overview']);
    } else {
      this.router.navigate(['/barber', tab]);
    }
  }

  switchToCustomer(): void {
    this.haptics.lightTap();
    this.isMobileMoreMenuOpen.set(false);
    this.barberService.setRole('client');
    this.router.navigate(['/customer']);
  }

  logout(): void {
    this.haptics.lightTap();
    this.isMobileMoreMenuOpen.set(false);
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
  // CONTROL DE MODALES GLOBALES
  // ---------------------------------------------------------------------------
  openRegisterCutModal(preselectedClientId?: string): void {
    this.haptics.lightTap();
    this.isCommandPaletteOpen.set(false);
    this.isMobileMoreMenuOpen.set(false);
    this.barberService.openRegisterCutModal({ clientId: preselectedClientId });
  }

  closeRegisterCutModal(): void {
    this.barberService.closeRegisterCutModal();
  }

  onCutSuccess(event: { message: string }): void {
    this.showToast(event.message);
  }

  openNewClientModal(): void {
    this.haptics.lightTap();
    this.isCommandPaletteOpen.set(false);
    this.isNewClientModalOpen.set(true);
  }

  closeNewClientModal(): void {
    this.isNewClientModalOpen.set(false);
  }

  onClientCreated(client: Client): void {
    this.showToast(`✓ Cliente "${client.name}" registrado`);
    // Si el modal de corte está abierto, podemos preseleccionar el cliente
    if (this.barberService.isRegisterCutModalOpen()) {
      this.barberService.openRegisterCutModal({ clientId: client.id });
    }
  }

  openBookAppointmentModal(): void {
    this.haptics.lightTap();
    this.isCommandPaletteOpen.set(false);
    this.barberService.openBookingModal();
  }

  closeBookAppointmentModal(): void {
    this.barberService.closeBookingModal();
  }

  onAppointmentBooked(apt: any): void {
    this.showToast(`✓ Cita agendada para ${apt.clientName || 'Cliente'} a las ${apt.time}`);
  }

  onAppointmentUpdated(apt: any): void {
    this.showToast(`✓ Cita de ${apt.clientName || 'Cliente'} actualizada correctamente`);
  }

  onDebtPaymentSuccess(event: { client: Client; amount: number }): void {
    this.showToast(`✓ Abono de ${this.barberService.currencySymbol()}${event.amount.toFixed(2)} registrado a ${event.client.name}`);
  }

  goToCashRegister(): void {
    this.haptics.lightTap();
    this.closeRegisterCutModal();
    this.navigateTo('cash');
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
