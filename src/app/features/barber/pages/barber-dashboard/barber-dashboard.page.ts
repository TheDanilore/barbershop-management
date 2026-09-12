import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Client, PaymentMethod } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { BarberMetrics } from '../../components/barber-metrics/barber-metrics';
import { BarberSchedule } from '../../components/barber-schedule/barber-schedule';
import { CashShiftModalComponent } from '../../components/cash-shift-modal/cash-shift-modal.component';

@Component({
  selector: 'app-barber-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, BarberMetrics, BarberSchedule, CashShiftModalComponent],
  templateUrl: './barber-dashboard.page.html',
  styleUrl: './barber-dashboard.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberDashboardPage {
  readonly barberService = inject(BarberService);
  readonly supabaseService = inject(SupabaseService);
  readonly haptics = inject(HapticsService);
  private readonly logger = inject(LoggerService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
        this.toastTimeout = null;
      }
    });
  }

  // Modales de Acción Rápida In-situ
  readonly isShiftModalOpen = signal(false);
  readonly shiftMode = signal<'open' | 'close'>('open');
  readonly activeShift = computed(() => this.barberService.activeCashShift());
  readonly isSubmitting = signal(false);

  // Toast Notificaciones
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Estado de Shimmer condicional: solo en carga en frío sin datos en memoria
  readonly shouldShowSkeleton = computed(() => {
    return (
      this.barberService.isLoading() &&
      this.barberService.cuts().length === 0 &&
      this.barberService.clients().length === 0
    );
  });

  // Clientes con deuda pendiente
  readonly clientsWithDebt = computed(() => {
    return this.barberService.clients().filter((c) => (c.currentDebt || 0) > 0);
  });

  // Monto total acumulado en fiados
  readonly totalDebtAmount = computed(() => {
    return this.clientsWithDebt().reduce((sum, c) => sum + (c.currentDebt || 0), 0);
  });

  // Top clientes para el widget de fidelización
  readonly topLoyaltyClients = computed(() => {
    return [...this.barberService.clients()]
      .sort((a, b) => b.loyaltyStamps - a.loyaltyStamps)
      .slice(0, 4);
  });

  // Últimos servicios cobrados (hasta 7 registros)
  readonly recentCuts = computed(() => {
    return this.barberService.cuts().slice(0, 7);
  });

  // ---------------------------------------------------------------------------
  // POWER USER KEYBOARD SHORTCUTS (ESTÁNDAR BARBERTRACK PRO: ALT + TECLA)
  // ---------------------------------------------------------------------------
  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcuts(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;

    // Ignorar si el usuario está interactuando con formularios o inputs
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

    // Alt + N -> Registrar Nuevo Corte POS
    if (event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.openRegisterCutModal();
      return;
    }

    // Alt + A -> Ver Agenda
    if (event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.navigateTo('appointments');
      return;
    }

    // Alt + C -> Arqueo / Caja
    if (event.altKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      this.openShiftModal(this.activeShift() ? 'close' : 'open');
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // NAVEGACIÓN
  // ---------------------------------------------------------------------------
  navigateTo(path: string): void {
    this.haptics.lightTap();
    this.router.navigate(['/barber', path]);
  }

  // ---------------------------------------------------------------------------
  // COBRO DE CORTES (DELEGA AL MODAL POS CHAMELEON CENTRALIZADO)
  // ---------------------------------------------------------------------------
  openRegisterCutModal(preselectedClientId?: string): void {
    this.haptics.lightTap();
    this.barberService.openRegisterCutModal({ clientId: preselectedClientId });
  }

  // ---------------------------------------------------------------------------
  // TURNO DE CAJA (APERTURA Y ARQUEO IN-SITU)
  // ---------------------------------------------------------------------------
  openShiftModal(mode: 'open' | 'close'): void {
    this.haptics.lightTap();
    this.shiftMode.set(mode);
    this.isShiftModalOpen.set(true);
  }

  closeShiftModal(): void {
    this.isShiftModalOpen.set(false);
  }

  // ---------------------------------------------------------------------------
  // ABONO DE DEUDAS (FIADOS) - CENTRALIZADO
  // ---------------------------------------------------------------------------
  openDebtPaymentModal(client: Client): void {
    this.haptics.lightTap();
    this.barberService.openDebtPaymentModal(client);
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  formatDate(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      return date.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoDate;
    }
  }

  formatTime(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      return date.toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoDate;
    }
  }

  formatRelativeDate(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      const now = new Date();
      const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();

      const timeStr = date.toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
      });

      if (isToday) {
        return `Hoy, ${timeStr}`;
      }

      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const isYesterday =
        date.getDate() === yesterday.getDate() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getFullYear() === yesterday.getFullYear();

      if (isYesterday) {
        return `Ayer, ${timeStr}`;
      }

      return date.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoDate;
    }
  }

  getInitials(name: string): string {
    if (!name) return 'C';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  }

  getPaymentLabel(method: string): string {
    switch (method) {
      case 'cash': return 'Efectivo';
      case 'card': return 'Tarjeta';
      case 'transfer': return 'Yape / Transf.';
      case 'credit': return 'Crédito (Fiado)';
      default: return method;
    }
  }

  showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage.set(null);
    }, 3500);
  }
}
