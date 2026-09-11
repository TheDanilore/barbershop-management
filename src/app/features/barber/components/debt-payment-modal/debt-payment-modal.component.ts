import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Client, FinancialAccount } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-debt-payment-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './debt-payment-modal.component.html',
  styleUrl: './debt-payment-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DebtPaymentModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly logger = inject(LoggerService);

  @Input() isOpen = false;
  @Input() client: Client | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() paymentSuccess = new EventEmitter<{ client: Client; amount: number }>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // Formulario reactivo
  readonly form: FormGroup = this.fb.group({
    amount: [null, [Validators.required, Validators.min(0.5)]],
    accountId: ['', [Validators.required]],
    paymentMethod: ['cash', [Validators.required]],
    notes: [''],
  });

  // Saldo restante simulado en tiempo real
  readonly remainingDebtSimulated = computed(() => {
    if (!this.client) return 0;
    const current = Number(this.client.currentDebt) || 0;
    const paying = Number(this.enteredAmount()) || 0;
    return Math.max(0, current - paying);
  });

  // Señal local para reactividad rápida del monto ingresado
  readonly enteredAmount = signal<number>(0);

  // Cuenta financiera actualmente seleccionada
  readonly selectedAccount = computed<FinancialAccount | null>(() => {
    const accId = this.form.get('accountId')?.value;
    const list = this.barberService.financialAccounts();
    return list.find((a) => a.id === accId) || list[0] || null;
  });

  constructor() {
    this.form.get('amount')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => {
        this.enteredAmount.set(Number(val) || 0);
      });

    // Sincronizar método de pago al cambiar la cuenta financiera
    this.form.get('accountId')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((accId) => {
        const acc = this.barberService.financialAccounts().find((a) => a.id === accId);
        if (acc) {
          if (acc.type === 'cash') this.form.patchValue({ paymentMethod: 'cash' }, { emitEvent: false });
          else if (acc.type === 'digital_wallet') this.form.patchValue({ paymentMethod: 'transfer' }, { emitEvent: false });
          else this.form.patchValue({ paymentMethod: 'card' }, { emitEvent: false });
        }
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.client) {
      this.resetForm();
    }
  }

  private resetForm(): void {
    this.errorMessage.set(null);
    const cli = this.client;
    if (!cli) return;

    const accounts = this.barberService.financialAccounts();
    const defaultAcc = accounts[0]?.id || '';
    const initialAmount = cli.currentDebt || 0;

    this.form.reset({
      amount: initialAmount,
      accountId: defaultAcc,
      paymentMethod: accounts[0]?.type === 'cash' ? 'cash' : 'transfer',
      notes: '',
    });

    this.enteredAmount.set(initialAmount);
  }

  setAmount(val: number): void {
    this.haptics.selection();
    const safeVal = Math.round(val * 100) / 100;
    this.form.patchValue({ amount: safeVal });
    this.enteredAmount.set(safeVal);
  }

  setAmountPercentage(percentage: number): void {
    if (!this.client) return;
    const current = this.client.currentDebt || 0;
    const calculated = Math.round((current * percentage) * 100) / 100;
    this.setAmount(calculated);
  }

  closeModal(): void {
    this.haptics.lightTap();
    this.errorMessage.set(null);
    this.closed.emit();
  }

  async submitPayment(): Promise<void> {
    this.errorMessage.set(null);
    const cli = this.client;

    if (!cli || this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    const { amount, accountId, paymentMethod, notes } = this.form.value;
    const numAmount = Number(amount);
    const debt = Number(cli.currentDebt) || 0;

    if (numAmount <= 0) {
      this.errorMessage.set('El monto a abonar debe ser mayor a cero.');
      this.haptics.warning();
      return;
    }

    if (numAmount > debt) {
      this.errorMessage.set(`El abono no puede superar la deuda total (${this.barberService.currencySymbol()}${debt.toFixed(2)}).`);
      this.haptics.warning();
      return;
    }

    this.isSubmitting.set(true);
    try {
      this.haptics.selection();
      await this.barberService.registerCreditPayment({
        clientId: cli.id,
        amount: numAmount,
        accountId: accountId,
        paymentMethod: paymentMethod || 'cash',
        notes: notes?.trim() || undefined,
      });

      this.haptics.success();
      this.paymentSuccess.emit({ client: cli, amount: numAmount });
      this.closeModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar el abono';
      this.logger.error('DebtPaymentModalComponent', 'Error al procesar abono de deuda', err);
      this.errorMessage.set(msg);
      this.haptics.warning();
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
