import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BarberMetrics } from '../../components/barber-metrics/barber-metrics';
import { BarberSchedule } from '../../components/barber-schedule/barber-schedule';

@Component({
  selector: 'app-barber-overview',
  standalone: true,
  imports: [CommonModule, BarberMetrics, BarberSchedule],
  templateUrl: './barber-overview.page.html',
  styleUrl: './barber-overview.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberOverviewPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly router = inject(Router);

  // Top clientes para el widget de fidelización
  readonly topLoyaltyClients = computed(() => {
    return [...this.barberService.clients()]
      .sort((a, b) => b.loyaltyStamps - a.loyaltyStamps)
      .slice(0, 4);
  });

  navigateTo(path: string): void {
    this.haptics.lightTap();
    this.router.navigate(['/barber', path]);
  }
}
