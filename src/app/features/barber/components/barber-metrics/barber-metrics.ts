import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Output, inject } from '@angular/core';
import { BarberService } from '../../../../core/services/barber.service';

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

  @Output() viewStats = new EventEmitter<void>();

  onViewStats(): void {
    this.viewStats.emit();
  }
}
