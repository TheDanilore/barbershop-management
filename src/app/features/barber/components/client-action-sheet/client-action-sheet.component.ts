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
import { Client } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-client-action-sheet',
  standalone: true,
  imports: [CommonModule, BottomSheetDirective],
  templateUrl: './client-action-sheet.component.html',
  styleUrl: './client-action-sheet.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientActionSheetComponent {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);

  @Input() isOpen = false;
  @Input() client: Client | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() registerCut = new EventEmitter<Client>();
  @Output() payDebt = new EventEmitter<Client>();
  @Output() bookAppointment = new EventEmitter<Client>();
  @Output() editClient = new EventEmitter<Client>();
  @Output() toggleStatus = new EventEmitter<Client>();

  @HostListener('window:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  close(): void {
    this.haptics.lightTap();
    this.closed.emit();
  }

  onRegisterCut(): void {
    if (!this.client) return;
    this.haptics.lightTap();
    this.registerCut.emit(this.client);
    this.close();
  }

  onPayDebt(): void {
    if (!this.client) return;
    this.haptics.lightTap();
    this.payDebt.emit(this.client);
    this.close();
  }

  onBookAppointment(): void {
    if (!this.client) return;
    this.haptics.lightTap();
    this.bookAppointment.emit(this.client);
    this.close();
  }

  onEditClient(): void {
    if (!this.client) return;
    this.haptics.lightTap();
    this.editClient.emit(this.client);
    this.close();
  }

  onToggleStatus(): void {
    if (!this.client) return;
    this.haptics.lightTap();
    this.toggleStatus.emit(this.client);
    this.close();
  }

  getWhatsAppUrl(phone?: string): string {
    if (!phone) return '#';
    const digits = phone.replace(/\D/g, '');
    const cleanNumber = digits.length === 9 ? `51${digits}` : digits;
    return `https://wa.me/${cleanNumber}?text=Hola%20te%20escribimos%20de%20BarberTrack%20PRO`;
  }
}
