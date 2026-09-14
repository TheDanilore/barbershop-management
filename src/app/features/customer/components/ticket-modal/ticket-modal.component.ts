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

@Component({
  selector: 'app-ticket-modal',
  standalone: true,
  imports: [CommonModule],
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
    window.print();
  }

  formatDate(dateStr?: string): string {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
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
      case 'cash': return 'Efectivo';
      case 'card': return 'Tarjeta de Débito/Crédito';
      case 'transfer': return 'Billetera Digital / Transferencia';
      case 'credit': return 'Crédito / Cuenta Corriente';
      default: return method || 'Pagado';
    }
  }
}
