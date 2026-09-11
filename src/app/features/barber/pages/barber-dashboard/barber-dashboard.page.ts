import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
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

  // Modales de Acción Rápida In-situ
  readonly isShiftModalOpen = signal(false);
  readonly shiftMode = signal<'open' | 'close'>('open');
  readonly activeShift = computed(() => this.barberService.activeCashShift());
  readonly isDebtPaymentModalOpen = signal(false);
  readonly debtPaymentClient = signal<Client | null>(null);
  readonly isSubmitting = signal(false);

  // Toast Notificaciones
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Formulario Reactivo de Abono de Deuda
  readonly debtPaymentForm = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.5)]],
    accountId: ['', Validators.required],
    paymentMethod: ['cash', Validators.required],
    notes: [''],
  });

  // Clientes con deuda pendiente
  readonly clientsWithDebt = computed(() => {
    return this.barberService.clients().filter((c) => (c.currentDebt || 0) > 0);
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
  // ABONO DE DEUDAS (FIADOS)
  // ---------------------------------------------------------------------------
  openDebtPaymentModal(client: Client): void {
    this.haptics.lightTap();
    this.debtPaymentClient.set(client);
    const defaultAcc = this.barberService.financialAccounts()[0]?.id || '';
    this.debtPaymentForm.reset({
      amount: client.currentDebt || null,
      accountId: defaultAcc,
      paymentMethod: 'cash',
      notes: '',
    });
    this.isDebtPaymentModalOpen.set(true);
  }

  closeDebtPaymentModal(): void {
    this.haptics.lightTap();
    this.isDebtPaymentModalOpen.set(false);
    this.debtPaymentClient.set(null);
  }

  async submitDebtPayment(): Promise<void> {
    const client = this.debtPaymentClient();
    if (!client || this.debtPaymentForm.invalid || this.isSubmitting()) return;

    const { amount, accountId, paymentMethod, notes } = this.debtPaymentForm.value;

    this.isSubmitting.set(true);
    try {
      await this.barberService.registerCreditPayment({
        clientId: client.id,
        amount: Number(amount),
        accountId: accountId!,
        paymentMethod: paymentMethod || 'cash',
        notes: notes?.trim(),
      });
      this.haptics.success();
      this.closeDebtPaymentModal();
      this.showToast(`Abono de ${this.barberService.currencySymbol()}${amount} registrado a ${client.name}`);
    } catch (err: unknown) {
      this.logger.error('BarberDashboardPage', 'Error al procesar el abono de deuda', err);
      this.haptics.warning();
      this.showToast('Error al procesar el abono');
    } finally {
      this.isSubmitting.set(false);
    }
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
