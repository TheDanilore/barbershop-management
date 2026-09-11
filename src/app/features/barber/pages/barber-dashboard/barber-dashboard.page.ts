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
  readonly isRegisterCutModalOpen = signal(false);
  readonly isShiftModalOpen = signal(false);
  readonly shiftMode = signal<'open' | 'close'>('open');
  readonly activeShift = computed(() => this.barberService.activeCashShift());
  readonly isDebtPaymentModalOpen = signal(false);
  readonly debtPaymentClient = signal<Client | null>(null);
  readonly isSubmitting = signal(false);

  // Toast Notificaciones
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Formularios Reactivos
  readonly cutForm = this.fb.group({
    clientId: ['', Validators.required],
    serviceId: ['', Validators.required],
    paymentMethod: ['cash' as PaymentMethod, Validators.required],
    notes: [''],
  });

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
  // COBRO DE CORTES
  // ---------------------------------------------------------------------------
  openRegisterCutModal(preselectedClientId?: string): void {
    this.haptics.lightTap();
    const clientId =
      preselectedClientId ||
      this.cutForm.get('clientId')?.value ||
      this.barberService.clients()[0]?.id ||
      '';
    const firstService = this.barberService.services()[0];
    this.cutForm.reset({
      clientId,
      serviceId: firstService?.id || '',
      paymentMethod: 'cash',
      notes: '',
    });
    this.isRegisterCutModalOpen.set(true);
  }

  closeRegisterCutModal(): void {
    this.haptics.lightTap();
    this.isRegisterCutModalOpen.set(false);
  }

  async submitRegisterCut(): Promise<void> {
    if (this.cutForm.invalid || this.isSubmitting()) {
      this.cutForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Selecciona el cliente y servicio');
      return;
    }

    const { clientId, serviceId, paymentMethod, notes } = this.cutForm.value;

    // Validación preventiva de efectivo sin turno
    if (paymentMethod === 'cash' && !this.barberService.activeCashShift()) {
      this.haptics.warning();
      this.showToast('⚠️ No puedes cobrar en efectivo con el turno de caja cerrado');
      return;
    }

    this.isSubmitting.set(true);
    try {
      const barberId =
        this.supabaseService.userProfile()?.id ||
        this.barberService.barbers()[0]?.id ||
        '';

      const cut = await this.barberService.registerCut({
        clientId: clientId!,
        serviceId: serviceId!,
        barberId,
        paymentMethod: paymentMethod as PaymentMethod,
        notes: notes?.trim(),
      });

      this.haptics.success();
      this.closeRegisterCutModal();
      this.showToast(
        `✅ Cobro de $${cut.price.toFixed(2)} registrado (${this.getPaymentLabel(cut.paymentMethod)})`
      );
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(err?.message || 'Error al procesar el cobro');
    } finally {
      this.isSubmitting.set(false);
    }
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
      this.showToast(`Abono de $${amount} registrado a ${client.name}`);
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
