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
import { BarberService } from '../../../core/services/barber.service';
import { HapticsService } from '../../../core/services/haptics.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { BookingModal } from '../components/booking-modal/booking-modal';

export type CustomerTab = 'home' | 'appointments' | 'loyalty' | 'history' | 'profile';

@Component({
  selector: 'app-customer-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, BookingModal],
  templateUrl: './customer-layout.page.html',
  styleUrl: './customer-layout.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerLayoutPage implements OnInit {
  readonly barberService = inject(BarberService);
  readonly supabaseService = inject(SupabaseService);
  readonly haptics = inject(HapticsService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Pestaña activa determinada por la URL
  readonly currentTab = signal<CustomerTab>('home');

  // Modal global de agendamiento
  readonly isBookingModalOpen = signal(false);

  // Toast flotante global
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Nombre de visualización reactivo
  readonly displayName = computed(() => {
    return (
      this.supabaseService.userProfile()?.full_name ||
      this.barberService.currentClient().name
    );
  });

  // Título legible según la ruta activa
  readonly currentTabTitle = computed(() => {
    switch (this.currentTab()) {
      case 'home': return 'Mi Portal';
      case 'appointments': return 'Mis Citas';
      case 'loyalty': return 'Tarjeta & Sellos';
      case 'history': return 'Historial';
      case 'profile': return 'Mi Perfil';
      default: return 'Mi Portal';
    }
  });

  // Nivel de membresía dinámico del cliente (Bronze, Silver, Gold, VIP)
  readonly clientTier = computed<string>(() => {
    return this.barberService.currentClient().membershipLevel || 'Bronze';
  });

  // Flag estricto: ¿Es socio VIP?
  readonly isVip = computed<boolean>(() => this.clientTier() === 'VIP');

  // Etiqueta formal para el Topbar
  readonly tierBadgeLabel = computed<string>(() => {
    return this.isVip() ? 'CLIENTE VIP' : `CLIENTE ${this.clientTier().toUpperCase()}`;
  });

  // Conteo de citas activas para el badge de navegación
  readonly activeAppointmentsCount = computed(() => {
    return this.barberService.clientAppointments().filter(
      (a) => a.status === 'confirmed' || a.status === 'pending' || a.status === 'in-progress'
    ).length;
  });

  // Conteo de cupones de fidelidad listos para canjear
  readonly claimableRewardsCount = computed(() => {
    return this.barberService.clientLoyaltyClaims().length;
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
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event: NavigationEnd) => {
        this.extractTabFromUrl(event.urlAfterRedirects || event.url);
      });

    // Sincronización hiper-optimizada quirúrgica para portal de cliente (Zero-Leak de datos de terceros)
    if (this.supabaseService.isConfigured() && this.supabaseService.isAuthenticated) {
      const profile = this.supabaseService.userProfile();
      this.barberService.syncCustomerPortalData(profile?.id);
      this.setupRealtimeLoyalty(profile?.id);
    }
  }

  /**
   * Suscripción en tiempo real a cambios en fidelidad o perfil (POS checkout en sillón)
   */
  private setupRealtimeLoyalty(clientId?: string): void {
    if (!this.supabaseService.isConfigured() || !clientId) return;

    const channel = this.supabaseService.supabase
      .channel(`customer_loyalty_realtime_${clientId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'loyalty_progress',
          filter: `customer_id=eq.${clientId}`,
        },
        () => {
          this.barberService.syncCustomerPortalData(clientId);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${clientId}`,
        },
        () => {
          this.barberService.syncCustomerPortalData(clientId);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'membership_tiers',
        },
        () => {
          this.barberService.syncCustomerPortalData(clientId);
        }
      )
      .subscribe();

    this.destroyRef.onDestroy(() => {
      this.supabaseService.supabase.removeChannel(channel);
    });
  }

  private extractTabFromUrl(url: string): void {
    const cleanUrl = url.split('?')[0].split('#')[0];
    if (cleanUrl.includes('/appointments')) {
      this.currentTab.set('appointments');
    } else if (cleanUrl.includes('/loyalty') || cleanUrl.includes('/fidelidad')) {
      this.currentTab.set('loyalty');
    } else if (cleanUrl.includes('/history') || cleanUrl.includes('/historial')) {
      this.currentTab.set('history');
    } else if (cleanUrl.includes('/profile') || cleanUrl.includes('/perfil')) {
      this.currentTab.set('profile');
    } else {
      this.currentTab.set('home');
    }
  }

  // Flag: ¿Tiene al menos una cita activa programada? (Regla: 1 cita a la vez)
  readonly hasActiveAppointment = computed<boolean>(() => this.activeAppointmentsCount() > 0);

  navigateTo(tab: CustomerTab): void {
    this.haptics.lightTap();
    this.currentTab.set(tab);
    this.router.navigate([`/customer/${tab}`]);
  }

  handleQuickBookClick(): void {
    if (this.hasActiveAppointment()) {
      this.haptics.warning();
      this.showToast('🛡️ Ya cuentas con una cita activa programada. Puedes reprogramarla desde Mis Citas.');
      this.navigateTo('appointments');
      return;
    }
    this.openBookingModal();
  }

  openBookingModal(): void {
    this.haptics.lightTap();
    this.isBookingModalOpen.set(true);
  }

  closeBookingModal(): void {
    this.isBookingModalOpen.set(false);
  }

  onBookingSuccess(msg: string): void {
    this.showToast(msg);
  }

  showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage.set(null);
    }, 3800);
  }

  switchToBarber(): void {
    this.haptics.lightTap();
    this.barberService.setRole('barber');
    this.router.navigate(['/barber']);
  }

  logout(): void {
    this.haptics.lightTap();
    this.supabaseService.signOut();
    this.router.navigate(['/login']);
  }

  // Atajos de teclado en Desktop (Power User)
  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcuts(event: KeyboardEvent): void {
    // Alt+B: Agendar nueva cita
    if (event.altKey && (event.key === 'b' || event.key === 'B')) {
      event.preventDefault();
      this.handleQuickBookClick();
    }
  }
}
