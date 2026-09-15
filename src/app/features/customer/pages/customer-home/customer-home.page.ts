import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { Appointment } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { BookingModal } from '../../components/booking-modal/booking-modal';
import { TierCatalogModalComponent } from '../../components/tier-catalog-modal/tier-catalog-modal.component';

@Component({
  selector: 'app-customer-home',
  standalone: true,
  imports: [CommonModule, RouterModule, BookingModal, TierCatalogModalComponent],
  templateUrl: './customer-home.page.html',
  styleUrl: './customer-home.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerHomePage {
  readonly barberService = inject(BarberService);
  readonly supabaseService = inject(SupabaseService);
  readonly haptics = inject(HapticsService);
  private readonly router = inject(Router);

  readonly isBookingModalOpen = signal(false);
  readonly isTierCatalogModalOpen = signal(false);

  // Nombre reactivo de cliente
  readonly displayName = computed(() => {
    return (
      this.supabaseService.userProfile()?.full_name ||
      this.barberService.currentClient().name
    );
  });

  // Nivel de membresía dinámico (Bronze, Silver, Gold, VIP)
  readonly clientTier = computed<string>(() => {
    return this.barberService.currentClient().membershipLevel || 'Bronze';
  });

  readonly isVip = computed<boolean>(() => this.clientTier() === 'VIP');

  // Beneficios contextuales según el nivel real de membresía
  // REGLA ESTRICTA: Bronze es nivel base sin descuentos comerciales ni cortesías; VIP tiene el monopolio de descuentos.
  readonly tierPerks = computed(() => {
    const tier = this.clientTier();
    if (tier === 'VIP') {
      return [
        { icon: '🏷️', title: '15% Dto. en Productos', desc: 'Descuento VIP exclusivo en todas las ceras, pomadas y aceites de barba.' },
        { icon: '👑', title: 'Atención VIP y Master Barber', desc: 'Bebidas premium ilimitadas y atención preferencial del equipo senior.' },
        { icon: '⚡', title: 'Reserva Prioritaria Élite', desc: 'Acceso garantizado en horarios estelares de fin de semana y festivos.' },
      ];
    } else if (tier === 'Gold') {
      return [
        { icon: '☕', title: 'Bebida Premium de Cortesía', desc: 'Café de especialidad, infusión o bebida fría en cada visita.' },
        { icon: '✨', title: 'Tratamiento Toalla Caliente', desc: 'Vapor y toalla aromatizada de cortesía en servicio de barba.' },
        { icon: '⚡', title: 'Prioridad en Lista de Espera', desc: 'Preferencia en cupos libres por cancelaciones de último minuto.' },
      ];
    } else if (tier === 'Silver') {
      return [
        { icon: '☕', title: 'Bebida de Cortesía', desc: 'Café espresso artesanal o agua purificada en cada corte.' },
        { icon: '⭐', title: 'Sellos de Fidelidad', desc: 'Acumulación continua de sellos hacia cortes gratuitos.' },
        { icon: '📅', title: 'Reserva Anticipada', desc: 'Prioridad estándar en la agenda de los profesionales.' },
      ];
    }
    // Bronze (Nivel Inicial Base: solo acumulación hacia premios, sin descuentos)
    return [
      { icon: '⭐', title: 'Acumulación de Sellos', desc: 'Suma 1 sello por cada visita para canjear servicios y cortes 100% gratis en el sillón.' },
      { icon: '📅', title: 'Reserva Directa 24/7', desc: 'Acceso a la agenda digital con tus barberos preferidos en tiempo real.' },
      { icon: '🔔', title: 'Recordatorios & Historial', desc: 'Alertas automáticas de tus turnos y registro de tus estilos favoritos.' },
    ];
  });

  // Próximo turno en vivo
  readonly nextApt = computed(() => this.barberService.nextClientAppointment());

  // Servicios populares
  readonly popularServices = computed(() => {
    const list = this.barberService.services().filter((s) => s.isActive !== false);
    return list.slice(0, 4);
  });

  openBookingModal(): void {
    this.haptics.lightTap();
    this.isBookingModalOpen.set(true);
  }

  closeBookingModal(): void {
    this.isBookingModalOpen.set(false);
  }

  openTierCatalogModal(): void {
    this.haptics.lightTap();
    this.isTierCatalogModalOpen.set(true);
  }

  closeTierCatalogModal(): void {
    this.isTierCatalogModalOpen.set(false);
  }

  onBookingSuccess(msg: string): void {
    // La notificación puede delegarse al layout o manejarse localmente
    this.haptics.success();
  }

  cancelAppointment(apt: Appointment): void {
    this.haptics.warning();
    this.barberService.updateAppointmentStatus(apt.id, 'cancelled');
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'confirmed': return 'Confirmado';
      case 'in-progress': return 'En atención';
      case 'completed': return 'Completado';
      case 'cancelled': return 'Cancelado';
      default: return 'Pendiente';
    }
  }
}
