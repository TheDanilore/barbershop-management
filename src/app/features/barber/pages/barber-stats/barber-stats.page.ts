import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

export type StatsPeriod = 'today' | 'week' | 'month' | '6months' | 'year' | 'all';

export interface StatsPeriodItem {
  id: StatsPeriod;
  label: string;
  shortLabel: string;
  shortcut: string;
}

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

  readonly periods: StatsPeriodItem[] = [
    { id: 'today', label: 'Hoy', shortLabel: 'Hoy', shortcut: 'Alt+1' },
    { id: 'week', label: '7 Días', shortLabel: '7D', shortcut: 'Alt+2' },
    { id: 'month', label: 'Este Mes', shortLabel: 'Mes', shortcut: 'Alt+3' },
    { id: '6months', label: '6 Meses', shortLabel: '6M', shortcut: 'Alt+4' },
    { id: 'year', label: 'Año', shortLabel: 'Año', shortcut: 'Alt+5' },
    { id: 'all', label: 'Histórico', shortLabel: 'Todo', shortcut: 'Alt+6' },
  ];

  // Métricas financieras y operativas del período seleccionado
  readonly currentMetrics = computed(() => {
    return this.barberService.getPeriodMetrics(this.selectedPeriod());
  });

  // Tasa porcentual de realización de cobro efectivo vs crédito fiado
  readonly collectionRate = computed(() => {
    const m = this.currentMetrics();
    if (m.production <= 0) return 100;
    return Math.min(100, Math.max(0, Math.round((m.cashCollected / m.production) * 100)));
  });

  readonly creditRate = computed(() => {
    const m = this.currentMetrics();
    if (m.production <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((m.creditSales / m.production) * 100)));
  });

  // Servicios estrella del período
  readonly currentTopServices = computed(() => {
    return this.barberService.getTopServicesByPeriod(this.selectedPeriod());
  });

  // Máximo conteo de servicio para escalar las barras de progreso
  readonly maxServiceCount = computed(() => {
    const list = this.currentTopServices();
    if (list.length === 0) return 1;
    return Math.max(...list.map((s) => s.count), 1);
  });

  // Servicio Top #1 más solicitado
  readonly highPerformanceService = computed(() => {
    const top = this.currentTopServices().filter((s) => s.count > 0);
    return top.length > 0 ? top[0] : null;
  });

  // Atajos de teclado ergonómicos para escritorio (Alt+1 .. Alt+6)
  @HostListener('window:keydown', ['$event'])
  handleKeyboard(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const isEditing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    if (isEditing) return;

    if (e.altKey) {
      if (e.key === '1') { e.preventDefault(); this.setPeriod('today'); }
      else if (e.key === '2') { e.preventDefault(); this.setPeriod('week'); }
      else if (e.key === '3') { e.preventDefault(); this.setPeriod('month'); }
      else if (e.key === '4') { e.preventDefault(); this.setPeriod('6months'); }
      else if (e.key === '5') { e.preventDefault(); this.setPeriod('year'); }
      else if (e.key === '6') { e.preventDefault(); this.setPeriod('all'); }
    }
  }

  setPeriod(period: StatsPeriod): void {
    if (this.selectedPeriod() === period) return;
    this.haptics.selection();
    this.selectedPeriod.set(period);
  }
}
