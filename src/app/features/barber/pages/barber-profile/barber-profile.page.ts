import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { getLocalDateString, isSameLocalDate } from '../../../../core/utils/date.utils';
import { ProfileModalComponent } from '../../components/profile-modal/profile-modal.component';

@Component({
  selector: 'app-barber-profile',
  standalone: true,
  imports: [CommonModule, ProfileModalComponent],
  templateUrl: './barber-profile.page.html',
  styleUrl: './barber-profile.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberProfilePage {
  readonly supabaseService = inject(SupabaseService);
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly router = inject(Router);

  readonly isEditingProfile = signal(false);
  readonly isRefreshing = signal(false);
  readonly isCopied = signal(false);
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: any = null;
  private copyTimeout: any = null;

  // Ámbito de visualización de métricas (Personal vs Toda la Barbería si es admin)
  readonly viewScope = signal<'personal' | 'shop'>('personal');

  readonly currentProfile = computed(() => this.supabaseService.userProfile());
  readonly isAdmin = computed(() => this.currentProfile()?.role === 'admin');

  // Métricas reactivas computadas vinculadas a la sesión actual
  readonly myCutsToday = computed(() => {
    const today = getLocalDateString();
    const profile = this.currentProfile();
    const scope = this.viewScope();
    const all = this.barberService.cuts().filter((c) => isSameLocalDate(c.date, today));
    if (scope === 'shop' && this.isAdmin()) return all;
    if (!profile) return all;
    return all.filter((c) => c.barberId === profile.id || (!c.barberId && profile.role === 'admin'));
  });

  readonly myProductionToday = computed(() => {
    return this.myCutsToday().reduce((sum, c) => sum + (Number(c.price) || 0), 0);
  });

  readonly myCashCollectedToday = computed(() => {
    return this.myCutsToday()
      .filter((c) => c.paymentMethod !== 'credit')
      .reduce((sum, c) => sum + (Number(c.price) || 0), 0);
  });

  readonly myCreditToday = computed(() => {
    return this.myCutsToday()
      .filter((c) => c.paymentMethod === 'credit')
      .reduce((sum, c) => sum + (Number(c.price) || 0), 0);
  });

  readonly myAppointmentsToday = computed(() => {
    const today = getLocalDateString();
    const profile = this.currentProfile();
    const scope = this.viewScope();
    const all = this.barberService.appointments().filter((a) => a.date === today);
    if (scope === 'shop' && this.isAdmin()) return all;
    if (!profile) return all;
    return all.filter((a) => a.barberId === profile.id || profile.role === 'admin');
  });

  readonly myUniqueClientsToday = computed(() => {
    return new Set(this.myCutsToday().map((c) => c.clientId)).size;
  });

  readonly recentMyCuts = computed(() => {
    const profile = this.currentProfile();
    const scope = this.viewScope();
    const all = this.barberService.cuts();
    if (scope === 'shop' && this.isAdmin()) return all.slice(0, 5);
    if (!profile) return all.slice(0, 5);
    return all
      .filter((c) => c.barberId === profile.id || (!c.barberId && profile.role === 'admin'))
      .slice(0, 5);
  });

  setScope(scope: 'personal' | 'shop'): void {
    this.haptics.lightTap();
    this.viewScope.set(scope);
  }

  async refreshData(): Promise<void> {
    this.haptics.lightTap();
    this.isRefreshing.set(true);
    try {
      await this.supabaseService.refreshUserProfile();
      await this.barberService.syncFromSupabase();
      this.haptics.success();
      this.showToast('✅ Datos y métricas sincronizados con éxito');
    } catch {
      this.haptics.warning();
      this.showToast('⚠️ Sincronizado en modo local');
    } finally {
      this.isRefreshing.set(false);
    }
  }

  openEditProfile(): void {
    this.haptics.lightTap();
    this.isEditingProfile.set(true);
  }

  cancelEditProfile(): void {
    this.haptics.lightTap();
    this.isEditingProfile.set(false);
  }

  onProfileSaved(message: string): void {
    this.showToast(message);
    this.isEditingProfile.set(false);
  }

  @HostListener('window:keydown', ['$event'])
  handleGlobalShortcuts(event: KeyboardEvent): void {
    // Escape cierra el modal de edición
    if (event.key === 'Escape' && this.isEditingProfile()) {
      event.preventDefault();
      this.cancelEditProfile();
      return;
    }

    // Alt + E o Meta + E abre el editor de perfil
    if ((event.altKey || event.metaKey) && (event.key === 'e' || event.key === 'E')) {
      event.preventDefault();
      this.openEditProfile();
      return;
    }

    // Alt + S o Meta + S sincroniza datos con la nube
    if ((event.altKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
      event.preventDefault();
      this.refreshData();
      return;
    }
  }

  async copyAccountId(): Promise<void> {
    const id = this.supabaseService.currentUser()?.id;
    if (!id) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(id);
      }
      this.isCopied.set(true);
      this.haptics.success();
      this.showToast('✅ ID de cuenta copiado al portapapeles');
      if (this.copyTimeout) clearTimeout(this.copyTimeout);
      this.copyTimeout = setTimeout(() => {
        this.isCopied.set(false);
      }, 2500);
    } catch {
      this.showToast('⚠️ No se pudo copiar al portapapeles');
    }
  }

  getLatencyQuality(latency: number | null): 'good' | 'medium' | 'high' {
    if (latency === null) return 'good';
    if (latency < 150) return 'good';
    if (latency < 350) return 'medium';
    return 'high';
  }

  logout(): void {
    this.haptics.lightTap();
    this.supabaseService.signOut();
    this.router.navigate(['/login']);
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

  getRoleLabel(role?: string): string {
    switch (role) {
      case 'admin':
        return 'Administrador';
      case 'barber':
        return 'Barbero / Estilista';
      case 'customer':
        return 'Cliente';
      default:
        return 'Usuario Autorizado';
    }
  }

  showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage.set(null);
    }, 3500);
  }
}
