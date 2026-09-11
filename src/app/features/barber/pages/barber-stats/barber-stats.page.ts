import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

@Component({
  selector: 'app-barber-stats',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './barber-stats.page.html',
  styleUrl: './barber-stats.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberStatsPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);

  readonly averageTicket = computed(() => {
    const cuts = this.barberService.cuts();
    if (!cuts.length) return 0;
    return this.barberService.totalRevenue() / cuts.length;
  });

  readonly highPerformanceService = computed(() => {
    const top = this.barberService.topRequestedServices();
    return top.length > 0 ? top[0] : null;
  });
}
