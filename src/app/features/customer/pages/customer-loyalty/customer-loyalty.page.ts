import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { LoyaltyCard } from '../../components/loyalty-card/loyalty-card';
import { TierCatalogModalComponent } from '../../components/tier-catalog-modal/tier-catalog-modal.component';

@Component({
  selector: 'app-customer-loyalty',
  standalone: true,
  imports: [CommonModule, LoyaltyCard, TierCatalogModalComponent],
  templateUrl: './customer-loyalty.page.html',
  styleUrl: './customer-loyalty.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerLoyaltyPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly destroyRef = inject(DestroyRef);

  // Modal Comparador de Membresías
  readonly isTierCatalogModalOpen = signal(false);

  // Píldora de código copiado temporalmente con micro-feedback
  readonly copiedCode = signal<string | null>(null);
  private copyTimeout: ReturnType<typeof setTimeout> | null = null;

  // Filtro de vista móvil (Pase vs Premios & Cupones)
  readonly mobileViewTab = signal<'all' | 'pass' | 'rewards'>('all');

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.copyTimeout) clearTimeout(this.copyTimeout);
    });
  }

  openTierCatalogModal(): void {
    this.haptics.lightTap();
    this.isTierCatalogModalOpen.set(true);
  }

  closeTierCatalogModal(): void {
    this.isTierCatalogModalOpen.set(false);
  }

  setMobileTab(tab: 'all' | 'pass' | 'rewards'): void {
    this.haptics.selection();
    this.mobileViewTab.set(tab);
  }

  copyVoucherCode(code: string): void {
    this.haptics.success();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
    this.copiedCode.set(code);
    if (this.copyTimeout) clearTimeout(this.copyTimeout);
    this.copyTimeout = setTimeout(() => {
      this.copiedCode.set(null);
    }, 2800);
  }

  readonly currentStamps = computed(
    () => this.barberService.currentClient().loyaltyStamps || 0
  );

  readonly clientTier = computed<string>(
    () => this.barberService.currentClient().membershipLevel || 'Bronze'
  );

  readonly isVip = computed<boolean>(() => this.clientTier() === 'VIP');

  readonly targetStamps = computed(() => {
    const rewards = this.barberService.loyaltyRewards().filter((r) => r.isActive);
    if (!rewards.length) return this.barberService.stampsRequired();
    return Math.max(...rewards.map((r) => r.stampsRequired)) || 10;
  });

  // Recompensas ganadas pendientes de canje en sillón
  readonly activeClaims = computed(() => this.barberService.clientLoyaltyClaims());

  // Catálogo de recompensas ordenado por sellos requeridos
  readonly sortedRewards = computed(() => {
    return [...this.barberService.loyaltyRewards()]
      .filter((r) => r.isActive)
      .sort((a, b) => a.stampsRequired - b.stampsRequired);
  });

  formatClaimDate(dateStr: string): string {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  // Atajos de Teclado en Desktop (Filosofía Power User)
  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcuts(event: KeyboardEvent): void {
    // Alt+N o Alt+E: Explorar niveles y membresías
    if (event.altKey && (event.key === 'n' || event.key === 'N' || event.key === 'e' || event.key === 'E')) {
      event.preventDefault();
      this.openTierCatalogModal();
    }
  }
}
