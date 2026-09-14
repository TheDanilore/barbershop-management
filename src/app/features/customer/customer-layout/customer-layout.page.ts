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
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.extractTabFromUrl(event.urlAfterRedirects || event.url);
      });

    // Sincronización inicial si está autenticado en Supabase
    if (this.supabaseService.isConfigured() && this.supabaseService.isAuthenticated) {
      this.barberService.syncFromSupabase();
    }
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

  navigateTo(tab: CustomerTab): void {
    this.haptics.lightTap();
    this.currentTab.set(tab);
    this.router.navigate([`/customer/${tab}`]);
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
      this.openBookingModal();
    }
  }
}
