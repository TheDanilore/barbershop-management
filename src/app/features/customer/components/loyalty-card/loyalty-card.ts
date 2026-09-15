import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

@Component({
  selector: 'app-loyalty-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './loyalty-card.html',
  styleUrl: './loyalty-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoyaltyCard {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);

  // Estado reactivo: giro 3D de la tarjeta (Frente: Sellos / Reverso: QR de Sillón)
  readonly isFlipped = signal<boolean>(false);

  toggleFlip(): void {
    this.haptics.lightTap();
    this.isFlipped.update((v) => !v);
  }

  readonly currentClient = computed(() => this.barberService.currentClient());

  readonly clientName = computed(() => this.currentClient().name || 'Cliente Estimado');

  readonly clientTier = computed<string>(
    () => this.currentClient().membershipLevel || 'Bronze'
  );

  readonly isVip = computed<boolean>(() => this.clientTier() === 'VIP');

  readonly stampsCount = computed(
    () => this.currentClient().loyaltyStamps || 0
  );

  // Número de ciclo actual de 10 sellos (Tarjeta 1: 1-10, Tarjeta 2: 11-20, etc.)
  readonly currentCycle = computed<number>(() => {
    const stamps = this.stampsCount();
    if (stamps <= 0) return 1;
    return Math.floor((stamps - 1) / 10) + 1;
  });

  // Base de inicio y fin del ciclo actual
  readonly cycleStart = computed<number>(() => (this.currentCycle() - 1) * 10 + 1);
  readonly cycleEnd = computed<number>(() => this.currentCycle() * 10);

  // Exactamente 10 slots por tarjeta física virtual (2 filas de 5 - Estándar Internacional)
  readonly stampSlots = computed<number[]>(() => {
    const start = this.cycleStart();
    return Array.from({ length: 10 }, (_, i) => start + i);
  });

  // Progreso en el ciclo activo (0 a 10)
  readonly cycleStampsCompleted = computed<number>(() => {
    const stamps = this.stampsCount();
    if (stamps <= 0) return 0;
    const start = this.cycleStart();
    const completed = stamps - start + 1;
    return Math.max(0, Math.min(10, completed));
  });

  // Porcentaje del ciclo actual (0 a 100%)
  readonly progressPercentage = computed<number>(() => {
    return Math.round((this.cycleStampsCompleted() / 10) * 100);
  });

  // Código formal del cliente para identificación rápida en caja
  readonly clientCode = computed(() => {
    const id = this.currentClient().id || '00000000';
    return `BT-${id.slice(0, 8).toUpperCase()}`;
  });

  isRewardSlot(slot: number): boolean {
    const rewards = this.barberService.loyaltyRewards().filter((r) => r.isActive);
    if (!rewards.length) return slot === this.barberService.stampsRequired();
    return rewards.some((r) => r.stampsRequired === slot);
  }

  getRewardNameForSlot(slot: number): string | null {
    const r = this.barberService.loyaltyRewards().find((rew) => rew.stampsRequired === slot);
    return r ? r.name : null;
  }
}
