import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
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
import { LoyaltyReward, RewardType } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { LoyaltyRewardModalComponent } from '../../components/loyalty-reward-modal/loyalty-reward-modal.component';

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

  readonly isLoyaltyRewardModalOpen = signal(false);
  readonly editingReward = signal<LoyaltyReward | null>(null);
  readonly isSubmitting = signal(false);

  // Notificación local de feedback
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Clientes con más sellos acumulados
  readonly topLoyaltyClients = computed(() => {
    return [...this.barberService.clients()]
      .sort((a, b) => b.loyaltyStamps - a.loyaltyStamps)
      .slice(0, 8);
  });

  // Recompensas activas
  readonly activeRewardsCount = computed(() => {
    return this.barberService.loyaltyRewards().filter((r) => r.isActive).length;
  });

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
          ? '✅ Modo activo: 1 sello por cada servicio realizado'
          : '✅ Modo activo: 1 sello por visita / ticket'
      );
    } catch {
      this.showToast('Error al actualizar el modo de fidelización');
    }
  }

  getRewardTypeLabel(type: RewardType | undefined): string {
    switch (type) {
      case 'free_cut': return 'Corte Gratis';
      case 'discount_pct': return 'Descuento %';
      case 'discount_fixed': return 'Descuento Monto';
      case 'gift': return 'Regalo / Producto';
      default: return 'Recompensa';
    }
  }
}
