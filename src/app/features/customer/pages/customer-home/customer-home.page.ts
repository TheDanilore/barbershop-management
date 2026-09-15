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

@Component({
  selector: 'app-customer-home',
  standalone: true,
  imports: [CommonModule, RouterModule, BookingModal],
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
  readonly tierPerks = computed(() => {
    const tier = this.clientTier();
    if (tier === 'VIP') {
      return [
        { icon: '👑', title: 'Atención VIP Exclusiva', desc: 'Bebida premium ilimitada y sillón de corte preferencial.' },
        { icon: '🏷️', title: '20% Dto. en Productos', desc: 'Descuento VIP en ceras, pomadas y aceites importados.' },
        { icon: '⚡', title: 'Reserva Prioritaria Élite', desc: 'Acceso prioritario garantizado en fines de semana y festivos.' },
      ];
    } else if (tier === 'Gold') {
      return [
        { icon: '☕', title: 'Bebida Premium de Cortesía', desc: 'Café de especialidad, infusión o bebida fría en cada visita.' },
        { icon: '🏷️', title: '15% Dto. en Productos', desc: 'Descuento Gold en toda la línea de cuidado capilar y barba.' },
        { icon: '⚡', title: 'Prioridad en Lista de Espera', desc: 'Preferencia en cupos libres por cancelaciones de último minuto.' },
      ];
    } else if (tier === 'Silver') {
      return [
        { icon: '☕', title: 'Bebida de Cortesía', desc: 'Café espresso artesanal o agua purificada en cada corte.' },
        { icon: '🏷️', title: '10% Dto. en Productos', desc: 'Descuento Silver en productos seleccionados de peinado.' },
        { icon: '✨', title: 'Tratamiento Toalla Caliente', desc: 'Vapor y toalla aromatizada de cortesía en servicios de barba.' },
      ];
    }
    // Bronze por defecto
    return [
      { icon: '☕', title: 'Bebida de Cortesía', desc: 'Café espresso artesanal, agua o bebida fría en cada corte.' },
      { icon: '🏷️', title: '10% Dto. en Productos', desc: 'Descuento de bienvenida en pomadas y ceras para el cabello.' },
      { icon: '⭐', title: 'Club de Sellos Dorados', desc: 'Suma sellos por cada visita y canjea cortes y premios 100% gratis.' },
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
