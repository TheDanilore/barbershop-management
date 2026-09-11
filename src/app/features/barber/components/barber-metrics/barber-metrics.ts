import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, inject, signal } from '@angular/core';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

export type MetricPeriod = 'today' | 'week' | 'month' | '6months' | 'year' | 'all';

@Component({
  selector: 'app-barber-metrics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './barber-metrics.html',
  styleUrl: './barber-metrics.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberMetrics {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);

  @Output() viewStats = new EventEmitter<void>();

  readonly selectedPeriod = signal<MetricPeriod>('today');

  readonly periods: Array<{ id: MetricPeriod; label: string }> = [
    { id: 'today', label: 'Hoy' },
    { id: 'week', label: '7 Días' },
    { id: 'month', label: '30 Días' },
    { id: '6months', label: '6 Meses' },
    { id: 'year', label: 'Año' },
    { id: 'all', label: 'Todo' },
  ];

  readonly currentMetrics = computed(() => {
    return this.barberService.getPeriodMetrics(this.selectedPeriod());
  });

  setPeriod(period: MetricPeriod): void {
    this.haptics.lightTap();
    this.selectedPeriod.set(period);
  }

  onViewStats(): void {
    this.haptics.lightTap();
    this.viewStats.emit();
  }
}
