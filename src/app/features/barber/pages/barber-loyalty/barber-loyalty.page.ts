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
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { LoyaltyReward, RewardType } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { LoyaltyRewardModalComponent } from '../../components/loyalty-reward-modal/loyalty-reward-modal.component';

export interface ClientProgressItem {
  id: string;
  name: string;
  phone?: string;
  loyaltyStamps: number;
  percentage: number;
  nextRewardName?: string;
  stampsRemaining: number;
}

@Component({
  selector: 'app-barber-loyalty',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, LoyaltyRewardModalComponent],
  templateUrl: './barber-loyalty.page.html',
  styleUrl: './barber-loyalty.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberLoyaltyPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoyaltyRewardModalOpen = signal(false);
  readonly editingReward = signal<LoyaltyReward | null>(null);
  readonly isSubmitting = signal(false);

  // Notificación local de feedback con limpieza automática
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.toastTimeout) clearTimeout(this.toastTimeout);
    });
  }

  // Estado SWR: Shimmer SOLO cuando la caché local esté vacía y aún no haya completado la primera carga
  readonly isLoyaltyInitialLoading = computed(() => {
    if (this.barberService.loyaltyRewards().length > 0) return false;
    return this.barberService.isLoading() && !this.barberService.isLoyaltyLoaded();
  });

  // Recompensas activas
  readonly activeRewardsCount = computed(() => {
    return this.barberService.loyaltyRewards().filter((r) => r.isActive).length;
  });

  // Recompensas ordenadas por sellos requeridos
  readonly sortedRewards = computed(() => {
    return [...this.barberService.loyaltyRewards()].sort(
      (a, b) => a.stampsRequired - b.stampsRequired
    );
  });

  // Sellos máximos configurados para escalar barras de progreso
  readonly maxStampsGoal = computed(() => {
    const rewards = this.sortedRewards();
    if (rewards.length === 0) return 10;
    return rewards[rewards.length - 1].stampsRequired || 10;
  });

  // Clientes top con cálculo memoizado de progreso y siguiente meta
  readonly topLoyaltyClientsWithProgress = computed<ClientProgressItem[]>(() => {
    const rewards = this.sortedRewards().filter((r) => r.isActive);
    const maxGoal = this.maxStampsGoal();

    return [...this.barberService.clients()]
      .sort((a, b) => b.loyaltyStamps - a.loyaltyStamps)
      .slice(0, 8)
      .map((cli) => {
        const stamps = cli.loyaltyStamps || 0;
        const nextReward = rewards.find((r) => r.stampsRequired > stamps);
        const stampsRemaining = nextReward ? Math.max(0, nextReward.stampsRequired - stamps) : 0;
        const percentage = Math.min(100, Math.max(0, Math.round((stamps / maxGoal) * 100)));

        return {
          id: cli.id,
          name: cli.name,
          phone: cli.phone,
          loyaltyStamps: stamps,
          percentage,
          nextRewardName: nextReward ? nextReward.name : (rewards.length > 0 ? '¡Máximo nivel alcanzado!' : undefined),
          stampsRemaining,
        };
      });
  });

  // Atajos de teclado contextuales sin colisión con BarberLayout (Alt+N: Corte, Alt+A: Cita, Alt+C: Cliente)
  @HostListener('window:keydown', ['$event'])
  handleKeyboard(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const isEditing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

    if (e.key === 'Escape') {
      if (this.isLoyaltyRewardModalOpen()) this.closeLoyaltyRewardModal();
      return;
    }

    if (isEditing) return;

    // Alt+R: Nueva Recompensa (Reward)
    if (e.altKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      this.openLoyaltyRewardModal();
    }
    // Alt+M: Alternar Modo de Acumulación (Servicio vs Ticket)
    else if (e.altKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      const nextMode = this.barberService.loyaltyMode() === 'per_service' ? 'per_visit' : 'per_service';
      this.setLoyaltyMode(nextMode);
    }
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toastMessage.set(null), 3500);
  }

  openLoyaltyRewardModal(rewardId?: string): void {
    this.haptics.lightTap();
    if (rewardId) {
      const reward = this.barberService.loyaltyRewards().find((r) => r.id === rewardId);
      this.editingReward.set(reward || null);
    } else {
      this.editingReward.set(null);
    }
    this.isLoyaltyRewardModalOpen.set(true);
  }

  closeLoyaltyRewardModal(): void {
    this.haptics.lightTap();
    this.isLoyaltyRewardModalOpen.set(false);
    this.editingReward.set(null);
  }

  async confirmToggleReward(id: string, currentActive: boolean): Promise<void> {
    try {
      await this.barberService.toggleLoyaltyReward(id, !currentActive);
      this.haptics.lightTap();
      this.showToast(!currentActive ? 'Recompensa activada' : 'Recompensa pausada');
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(err?.message || 'Error al cambiar estado');
    }
  }

  async confirmDeleteReward(id: string, name: string): Promise<void> {
    if (!confirm(`¿Eliminar la recompensa "${name}"?`)) return;
    try {
      await this.barberService.deleteLoyaltyReward(id);
      this.haptics.success();
      this.showToast('Recompensa eliminada');
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(err?.message || 'Error al eliminar');
    }
  }

  async submitRedeemClaim(claimId: string): Promise<void> {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);
    try {
      await this.barberService.redeemRewardClaim(claimId);
      this.haptics.success();
      this.showToast('¡Premio canjeado con éxito!');
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(err?.message || 'Error al canjear premio');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async setLoyaltyMode(mode: 'per_service' | 'per_visit'): Promise<void> {
    this.haptics.selection();
    try {
      await this.barberService.updateBusinessSettings({ loyaltyMode: mode });
      this.showToast(
        mode === 'per_service'
          ? 'Modo activo: 1 sello por servicio realizado'
          : 'Modo activo: 1 sello por visita / ticket'
      );
    } catch {
      this.showToast('Error al actualizar el modo de fidelización');
    }
  }

  getRewardTypeLabel(type: RewardType | undefined): string {
    switch (type) {
      case 'free_cut': return 'Corte Gratis';
      case 'discount_pct': return 'Descuento %';
      case 'discount_fixed': return 'Descuento Fijo';
      case 'gift': return 'Regalo / Producto';
      default: return 'Recompensa';
    }
  }
}
