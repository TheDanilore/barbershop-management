import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BarberService } from '../../../../core/services/barber.service';

@Component({
  selector: 'app-loyalty-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './loyalty-card.html',
  styleUrl: './loyalty-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoyaltyCard {
  readonly barberService = inject(BarberService);

  readonly targetStamps = computed(() => {
    const rewards = this.barberService.loyaltyRewards().filter((r) => r.isActive);
    if (!rewards.length) return this.barberService.stampsRequired();
    const maxReward = Math.max(...rewards.map((r) => r.stampsRequired));
    return maxReward || 10;
  });

  readonly stampSlots = computed(() => {
    const total = this.targetStamps();
    return Array.from({ length: total }, (_, i) => i + 1);
  });

  readonly progressPercentage = computed(() => {
    const total = this.targetStamps() || 10;
    const current = this.barberService.currentClient().loyaltyStamps || 0;
    return Math.min(100, Math.round((current / total) * 100));
  });

  isRewardSlot(slot: number): boolean {
    const rewards = this.barberService.loyaltyRewards().filter((r) => r.isActive);
    if (!rewards.length) return slot === this.barberService.stampsRequired();
    return rewards.some((r) => r.stampsRequired === slot);
  }
}

