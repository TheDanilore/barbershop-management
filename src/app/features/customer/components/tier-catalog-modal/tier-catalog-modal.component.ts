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
  readonly nextTierInfo = computed(() => {
    const cuts = this.cutsCount();
    const tier = this.clientTier();

    if (tier === 'VIP') {
      return {
        isMax: true,
        nextTier: 'VIP',
        cutsNeeded: 0,
        progressPct: 100,
        message: '¡Perteneces al nivel más alto de BarberTrack! Cuentas con todos los privilegios y descuentos.',
      };
    }
    if (tier === 'Gold') {
      const target = 50;
      const cutsNeeded = Math.max(0, target - cuts);
      const progressPct = Math.min(100, Math.round((cuts / target) * 100));
      return {
        isMax: false,
        nextTier: 'VIP',
        cutsNeeded,
        progressPct,
        message: `Te faltan ${cutsNeeded} cortes para alcanzar VIP y desbloquear el 15% de descuento en productos y reservas prioritarias.`,
      };
    }
    if (tier === 'Silver') {
      const target = 20;
      const cutsNeeded = Math.max(0, target - cuts);
      const progressPct = Math.min(100, Math.round((cuts / target) * 100));
      return {
        isMax: false,
        nextTier: 'Gold',
        cutsNeeded,
        progressPct,
        message: `Te faltan ${cutsNeeded} cortes para ascender a Gold y disfrutar de tratamientos de toalla caliente y bebidas premium.`,
      };
    }
    // Bronze
    const target = 5;
    const cutsNeeded = Math.max(0, target - cuts);
    const progressPct = Math.min(100, Math.round((cuts / target) * 100));
    return {
      isMax: false,
      nextTier: 'Silver',
      cutsNeeded,
      progressPct,
      message: `Te faltan ${cutsNeeded} cortes para ascender a Silver y desbloquear tu primera cortesía artesanal en cada visita.`,
    };
  });

  // Catálogo completo de membresías del sistema
  readonly allTiers: TierDefinition[] = [
    {
      id: 'Bronze',
      name: 'Bronze Member',
      badge: 'Nivel Inicial',
      cutsRequired: '0 a 4 cortes',
      icon: '🥉',
      colorClass: 'bronze',
      tagline: 'Tu entrada al club para acumular sellos de fidelidad.',
      discount: 'Sin descuentos en productos',
      perks: [
        'Acumula sellos en tu tarjeta digital con cada visita',
        'Canjea 1 corte 100% gratis al llegar a 10 sellos',
        'Gestión y agendamiento de turnos online 24/7',
        'Recordatorios de citas en web y WhatsApp',
      ],
    },
    {
      id: 'Silver',
      name: 'Silver Member',
      badge: 'Socio Frecuente',
      cutsRequired: '5 a 19 cortes',
      icon: '🥈',
      colorClass: 'silver',
      tagline: 'Desbloquea atenciones de cortesía en cada corte.',
      discount: 'Sin descuentos en productos',
      perks: [
        'Café espresso artesanal o agua purificada de cortesía',
        'Acumulación continua de sellos hacia cortes gratis',
        'Notificaciones de ofertas especiales anticipadas',
        'Atención prioritaria en recepción',
      ],
    },
    {
      id: 'Gold',
      name: 'Gold Member',
      badge: 'Socio Distinguido',
      cutsRequired: '20 a 49 cortes',
      icon: '🥇',
      colorClass: 'gold',
      tagline: 'Experiencia premium y tratamientos relajantes.',
      discount: 'Sin descuentos en productos',
      perks: [
        'Bebida Premium de cortesía (café especialidad o infusión fría)',
        'Tratamiento de toalla caliente aromatizada en servicio de barba',
        'Prioridad en lista de espera ante citas liberadas',
        'Acumulación de sellos para canjes sin límite',
      ],
    },
    {
      id: 'VIP',
      name: 'VIP Élite Member',
      badge: 'Máximo Prestigio',
      cutsRequired: '50+ cortes',
      icon: '👑',
      colorClass: 'vip',
      tagline: 'El círculo más exclusivo con descuentos y atención total.',
      discount: '15% DTO. EXCLUSIVO',
      isVipTier: true,
      perks: [
        '15% de Descuento en todas las ceras, pomadas y aceites de barba',
        'Reserva prioritaria garantizada en fines de semana y festivos',
        'Bebidas premium ilimitadas durante toda tu visita',
        'Preferencia absoluta de horario con Master Barber',
        'Detalle y atención personalizada en tu cumpleaños',
      ],
    },
  ];

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
