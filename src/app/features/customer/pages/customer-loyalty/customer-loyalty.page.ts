import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { LoyaltyCard } from '../../components/loyalty-card/loyalty-card';

@Component({
  selector: 'app-customer-loyalty',
  standalone: true,
  imports: [CommonModule, LoyaltyCard],
  templateUrl: './customer-loyalty.page.html',
  styleUrl: './customer-loyalty.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerLoyaltyPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);

  readonly currentStamps = computed(
    () => this.barberService.currentClient().loyaltyStamps || 0
  );

  readonly isVip = computed<boolean>(
    () => this.barberService.currentClient().membershipLevel === 'VIP'
  );

  readonly targetStamps = computed(() => {
    const rewards = this.barberService.loyaltyRewards().filter((r) => r.isActive);
    if (!rewards.length) return this.barberService.stampsRequired();
    return Math.max(...rewards.map((r) => r.stampsRequired)) || 10;
  });

  // Recompensas ganadas pendientes de canje
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
}
