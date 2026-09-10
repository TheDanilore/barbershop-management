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

  readonly stampSlots = computed(() => {
    const total = this.barberService.stampsRequired();
    return Array.from({ length: total }, (_, i) => i + 1);
  });

  readonly progressPercentage = computed(() => {
    const total = this.barberService.stampsRequired() || 10;
    const current = this.barberService.currentClient().loyaltyStamps || 0;
    return Math.min(100, Math.round((current / total) * 100));
  });
}

