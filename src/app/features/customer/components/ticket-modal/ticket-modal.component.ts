import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  inject,
} from '@angular/core';
import { CutRecord } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-ticket-modal',
  standalone: true,
  imports: [CommonModule, BottomSheetDirective],
  templateUrl: './ticket-modal.component.html',
  styleUrl: './ticket-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketModalComponent {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);

  @Input() isOpen = false;
  @Input() cutRecord: CutRecord | null = null;
  @Output() close = new EventEmitter<void>();

  @HostListener('window:keydown.escape')
  handleEscape(): void {
    if (this.isOpen) {
      this.onClose();
    }
  }

  onClose(): void {
    this.haptics.lightTap();
    this.close.emit();
  }

  printReceipt(): void {
    this.haptics.selection();
    if (typeof window !== 'undefined') {
      window.print();
    }
  }

  formatDate(dateStr?: string): string {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('es-ES', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  }

  getPaymentLabel(method?: string): string {
    switch (method) {
      case 'cash':
        return 'Efectivo';
      case 'card':
        return 'Tarjeta Débito/Crédito';
      case 'transfer':
        return 'Billetera Digital (Yape / Plin)';
      case 'credit':
        return 'Cuenta Corriente / Crédito';
      default:
        return method || 'Cancelado';
    }
  }
}
