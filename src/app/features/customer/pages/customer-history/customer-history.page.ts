import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CutRecord } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { ReviewModalComponent } from '../../components/review-modal/review-modal.component';
import { TicketModalComponent } from '../../components/ticket-modal/ticket-modal.component';

@Component({
  selector: 'app-customer-history',
  standalone: true,
  imports: [CommonModule, ReviewModalComponent, TicketModalComponent],
  templateUrl: './customer-history.page.html',
  styleUrl: './customer-history.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerHistoryPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);

  // Historial de cortes
  readonly history = computed(() => this.barberService.clientCutsHistory());

  // Métricas calculadas
  readonly totalSpent = computed(() => {
    return this.history().reduce((acc, curr) => acc + (curr.price || 0), 0);
  });

  // Modales
  readonly isReviewModalOpen = signal(false);
  readonly selectedCutForReview = signal<CutRecord | null>(null);

  readonly isTicketModalOpen = signal(false);
  readonly selectedCutForTicket = signal<CutRecord | null>(null);

  openReviewForCut(cut: CutRecord): void {
    this.haptics.lightTap();
    this.selectedCutForReview.set(cut);
    this.isReviewModalOpen.set(true);
  }

  closeReviewModal(): void {
    this.isReviewModalOpen.set(false);
    this.selectedCutForReview.set(null);
  }

  onReviewSubmitted(msg: string): void {
    this.haptics.success();
  }

  openTicketModal(cut: CutRecord): void {
    this.haptics.lightTap();
    this.selectedCutForTicket.set(cut);
    this.isTicketModalOpen.set(true);
  }

  closeTicketModal(): void {
    this.isTicketModalOpen.set(false);
    this.selectedCutForTicket.set(null);
  }

  formatDate(isoDate: string): string {
    try {
      const d = new Date(isoDate);
      return d.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoDate;
    }
  }

  getPaymentLabel(method: string): string {
    switch (method) {
      case 'cash': return 'Efectivo';
      case 'card': return 'Tarjeta';
      case 'transfer': return 'Billetera Digital';
      case 'credit': return 'Crédito';
      default: return method;
    }
  }
}
