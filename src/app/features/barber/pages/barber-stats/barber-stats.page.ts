import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

export type StatsPeriod = 'today' | 'week' | 'month' | '6months' | 'year' | 'all';

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

  readonly selectedPeriod = signal<StatsPeriod>('all');

  readonly periods: Array<{ id: StatsPeriod; label: string }> = [
    { id: 'today', label: 'Hoy' },
    { id: 'week', label: '7 Días' },
    { id: 'month', label: 'Este Mes' },
    { id: '6months', label: '6 Meses' },
    { id: 'year', label: 'Año' },
    { id: 'all', label: 'Histórico' },
  ];

  readonly currentMetrics = computed(() => {
    return this.barberService.getPeriodMetrics(this.selectedPeriod());
  });

  readonly currentTopServices = computed(() => {
    return this.barberService.getTopServicesByPeriod(this.selectedPeriod());
  });

  readonly highPerformanceService = computed(() => {
    const top = this.currentTopServices().filter((s) => s.count > 0);
    return top.length > 0 ? top[0] : null;
  });

  setPeriod(period: StatsPeriod): void {
    this.haptics.lightTap();
    this.selectedPeriod.set(period);
  }
}
