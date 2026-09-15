import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  computed,
  inject,
} from '@angular/core';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

export interface TierDefinition {
  id: 'Bronze' | 'Silver' | 'Gold' | 'VIP';
  name: string;
  badge: string;
  cutsRequired: string;
  icon: string;
  colorClass: string;
  tagline: string;
  discount: string;
  perks: string[];
  isVipTier?: boolean;
}

@Component({
  selector: 'app-tier-catalog-modal',
  standalone: true,
  imports: [CommonModule, BottomSheetDirective],
  templateUrl: './tier-catalog-modal.component.html',
  styleUrl: './tier-catalog-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TierCatalogModalComponent {
  private readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);

  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();

  // Estado del cliente actual
  readonly currentClient = computed(() => this.barberService.currentClient());
  readonly clientTier = computed<string>(() => this.currentClient().membershipLevel || 'Bronze');
  readonly cutsCount = computed<number>(() => this.currentClient().cutsCount || 0);

  // Progresión hacia el siguiente nivel
  // Unidades dinámicas según el modo de fidelización del negocio ('servicios' o 'visitas')
  readonly loyaltyUnitLabel = computed(() => this.barberService.loyaltyUnitLabel());
  readonly loyaltyUnitSingular = computed(() => this.barberService.loyaltyUnitSingular());

  // Configuración VIP dinámica desde Supabase
  readonly vipTier = computed(() => {
    return this.barberService.membershipTiers().find((t) => t.id === 'VIP');
  });

  readonly vipDiscountPct = computed(() => {
    return this.vipTier()?.discountPercentage ?? 15;
  });

  // Progresión hacia el siguiente nivel (computado dinámicamente desde membership_tiers)
  readonly nextTierInfo = computed(() => {
    const cuts = this.cutsCount();
    const currentTierId = this.clientTier();
    const unit = this.loyaltyUnitLabel();
    const tiers = this.barberService.membershipTiers().filter((t) => t.isActive);

    const currentIndex = tiers.findIndex((t) => t.id.toLowerCase() === currentTierId.toLowerCase());
    const nextTier = currentIndex >= 0 && currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : null;

    if (!nextTier) {
      return {
        isMax: true,
        nextTier: currentTierId,
        cutsNeeded: 0,
        progressPct: 100,
        message: '¡Perteneces al nivel más alto de BarberTrack! Cuentas con todos los privilegios y descuentos.',
      };
    }

    const target = nextTier.minCutsRequired;
    const cutsNeeded = Math.max(0, target - cuts);
    const progressPct = Math.min(100, Math.round((cuts / target) * 100));

    const perkHint = nextTier.discountPercentage > 0
      ? `desbloquear el ${nextTier.discountPercentage}% de descuento en productos y reservas prioritarias.`
      : `desbloquear tus privilegios de socio ${nextTier.name}.`;

    return {
      isMax: false,
      nextTier: nextTier.name,
      cutsNeeded,
      progressPct,
      message: `Te faltan ${cutsNeeded} ${unit} para alcanzar ${nextTier.name} y ${perkHint}`,
    };
  });

  // Catálogo completo de membresías del sistema (computado dinámicamente desde Supabase)
  readonly allTiers = computed<TierDefinition[]>(() => {
    const unit = this.loyaltyUnitLabel();
    const configuredTiers = this.barberService.membershipTiers().filter((t) => t.isActive);

    return configuredTiers.map((t, index) => {
      const nextTier = configuredTiers[index + 1];
      const cutsRequiredStr = nextTier
        ? `${t.minCutsRequired} a ${nextTier.minCutsRequired - 1} ${unit}`
        : `${t.minCutsRequired}+ ${unit}`;

      const isVip = t.id === 'VIP' || t.discountPercentage > 0;
      const discountLabel = t.discountPercentage > 0
        ? `${t.discountPercentage}% DTO. EXCLUSIVO`
        : 'Sin descuentos en productos';

      const icon = t.id === 'VIP' ? '👑' : t.id === 'Gold' ? '🥇' : t.id === 'Silver' ? '🥈' : '🥉';

      return {
        id: t.id as any,
        name: t.name,
        badge: t.badgeLabel,
        cutsRequired: cutsRequiredStr,
        icon,
        colorClass: t.colorClass,
        tagline: t.tagline,
        discount: discountLabel,
        perks: t.perks,
        isVipTier: isVip,
      };
    });
  });

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
}
