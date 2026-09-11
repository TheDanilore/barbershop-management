import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AccountType, FinancialAccount, MovementType } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

export type MovementFilterType = 'all' | 'income' | 'expense' | 'transfer';

@Component({
  selector: 'app-barber-cash',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './barber-cash.page.html',
  styleUrl: './barber-cash.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberCashPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  // Modales
  readonly isShiftModalOpen = signal(false);
  readonly shiftMode = signal<'open' | 'close'>('open');
  readonly isAccountModalOpen = signal(false);
  readonly editingAccountId = signal<string | null>(null);
  readonly isMovementModalOpen = signal(false);
  readonly isTransferModalOpen = signal(false);
  readonly isSubmitting = signal(false);

  // Filtros de Movimientos
  readonly searchQuery = signal<string>('');
  readonly selectedTypeFilter = signal<MovementFilterType>('all');
  readonly selectedAccountFilter = signal<string>('all');

  // Input de Arqueo interactivo (en vivo)
  readonly actualCashInput = signal<number>(0);

  // Toast
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // --- COMPUTED SIGNALS: Hero de Liquidez Consolidada ---
  readonly activeShift = computed(() => this.barberService.activeCashShift());

  readonly totalConsolidatedBalance = computed(() => {
    return this.barberService
      .financialAccounts()
      .filter((a) => a.isActive)
      .reduce((sum, a) => sum + (Number(a.currentBalance) || 0), 0);
  });

  readonly cashBalance = computed(() => {
    return this.barberService
      .financialAccounts()
      .filter((a) => a.type === 'cash' && a.isActive)
      .reduce((sum, a) => sum + (Number(a.currentBalance) || 0), 0);
  });

  readonly bankBalance = computed(() => {
    return this.barberService
      .financialAccounts()
      .filter((a) => a.type === 'bank' && a.isActive)
      .reduce((sum, a) => sum + (Number(a.currentBalance) || 0), 0);
  });

  readonly walletBalance = computed(() => {
    return this.barberService
      .financialAccounts()
      .filter((a) => a.type === 'digital_wallet' && a.isActive)
      .reduce((sum, a) => sum + (Number(a.currentBalance) || 0), 0);
  });

  // Cálculo interactivo de Descuadre de Turno (Arqueo)
  readonly shiftDiscrepancy = computed(() => {
    const shift = this.activeShift();
    if (!shift) return { difference: 0, status: 'none' as const, expected: 0 };
    const expected = Number(shift.expectedCash || 0);
    const actual = Number(this.actualCashInput() || 0);
    const difference = actual - expected;
    let status: 'perfect' | 'shortage' | 'surplus' = 'perfect';
    if (difference < -0.01) status = 'shortage';
    else if (difference > 0.01) status = 'surplus';
    return { difference, status, expected, actual };
  });

  // Movimientos Filtrados & Contadores
  readonly filteredMovements = computed(() => {
    const all = this.barberService.accountMovements();
    const type = this.selectedTypeFilter();
    const acc = this.selectedAccountFilter();
    const query = this.searchQuery().trim().toLowerCase();

    return all.filter((m) => {
      // Filtro por tipo
      if (type === 'income' && m.movementType !== 'income') return false;
      if (type === 'expense' && m.movementType !== 'expense') return false;
      if (type === 'transfer' && m.referenceType !== 'transfer' && !m.movementType.includes('transfer')) return false;

      // Filtro por cuenta
      if (acc !== 'all' && m.accountId !== acc) return false;

      // Filtro por texto
      if (query) {
        const descMatch = m.description.toLowerCase().includes(query);
        const accMatch = (m.accountName || '').toLowerCase().includes(query);
        const amountMatch = m.amount.toString().includes(query);
        if (!descMatch && !accMatch && !amountMatch) return false;
      }

      return true;
    });
  });

  readonly movementsCounts = computed(() => {
    const all = this.barberService.accountMovements();
    return {
      all: all.length,
      income: all.filter((m) => m.movementType === 'income').length,
      expense: all.filter((m) => m.movementType === 'expense').length,
      transfer: all.filter((m) => m.referenceType === 'transfer' || m.movementType.includes('transfer')).length,
    };
  });

  // Formularios Reactivos
  readonly openShiftForm = this.fb.group({
    initialCash: [50, [Validators.required, Validators.min(0)]],
    notes: [''],
  });

  readonly closeShiftForm = this.fb.group({
    actualCash: [0, [Validators.required, Validators.min(0)]],
    notes: [''],
  });

  readonly accountForm = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    type: ['cash', Validators.required],
    initialBalance: [0],
    isActive: [true],
  });

  readonly movementForm = this.fb.group({
    accountId: ['', Validators.required],
    movementType: ['expense', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.5)]],
    description: ['', [Validators.required, Validators.minLength(3)]],
  });

  readonly transferForm = this.fb.group({
    fromAccountId: ['', Validators.required],
    toAccountId: ['', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.5)]],
    description: ['Transferencia interna'],
  });

  // Atajos de teclado Power User en Desktop
  @HostListener('window:keydown', ['$event'])
  handleKeyboard(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const isEditing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

    if (e.key === 'Escape') {
      if (this.isShiftModalOpen()) this.closeShiftModal();
      if (this.isAccountModalOpen()) this.closeAccountModal();
      if (this.isMovementModalOpen()) this.closeMovementModal();
      if (this.isTransferModalOpen()) this.closeTransferModal();
      return;
    }

    if (isEditing) return;

    if (e.altKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      this.openShiftModal(this.activeShift() ? 'close' : 'open');
    } else if (e.altKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      this.openMovementModal();
    } else if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      this.openTransferModal();
    } else if (e.altKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      this.openCreateAccountModal();
    }
  }

  // --- MÉTODOS DE TURNO (ARQUEO / APERTURA) ---
  openShiftModal(mode: 'open' | 'close'): void {
    this.haptics.lightTap();
    this.shiftMode.set(mode);
    if (mode === 'open') {
      this.openShiftForm.reset({ initialCash: 50, notes: '' });
    } else {
      const shift = this.activeShift();
      const expected = shift?.expectedCash ?? 0;
      this.actualCashInput.set(expected);
      this.closeShiftForm.reset({
        actualCash: expected,
        notes: '',
      });
    }
    this.isShiftModalOpen.set(true);
  }

  onActualCashChange(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value) || 0;
    this.actualCashInput.set(val);
  }

  closeShiftModal(): void {
    this.haptics.lightTap();
    this.isShiftModalOpen.set(false);
  }

  async submitShift(): Promise<void> {
    if (this.isSubmitting()) return;

    if (this.shiftMode() === 'open') {
      if (this.openShiftForm.invalid) {
        this.openShiftForm.markAllAsTouched();
        return;
      }
      this.isSubmitting.set(true);
      try {
        const { initialCash, notes } = this.openShiftForm.value;
        await this.barberService.openCashShift(Number(initialCash), notes?.trim());
        this.haptics.success();
        this.showToast('🟢 Turno de caja abierto correctamente');
        this.closeShiftModal();
      } catch (err: any) {
        this.haptics.warning();
        this.showToast(err?.message || 'Error al abrir el turno');
      } finally {
        this.isSubmitting.set(false);
      }
    } else {
      if (this.closeShiftForm.invalid) {
        this.closeShiftForm.markAllAsTouched();
        return;
      }
      this.isSubmitting.set(true);
      try {
        const { actualCash, notes } = this.closeShiftForm.value;
        await this.barberService.closeCashShift(Number(actualCash), notes?.trim());
        this.haptics.success();
        this.showToast('🔴 Turno cerrado y arqueado con éxito');
        this.closeShiftModal();
      } catch (err: any) {
        this.haptics.warning();
        this.showToast(err?.message || 'Error al arquear el turno');
      } finally {
        this.isSubmitting.set(false);
      }
    }
  }

  // --- GESTIÓN DE CUENTAS FINANCIERAS ---
  openCreateAccountModal(): void {
    this.haptics.lightTap();
    this.editingAccountId.set(null);
    this.accountForm.reset({
      name: '',
      type: 'cash',
      initialBalance: 0,
      isActive: true,
    });
    this.isAccountModalOpen.set(true);
  }

  openEditAccountModal(account: FinancialAccount): void {
    this.haptics.lightTap();
    this.editingAccountId.set(account.id);
    this.accountForm.reset({
      name: account.name,
      type: account.type,
      initialBalance: account.currentBalance,
      isActive: account.isActive,
    });
    this.isAccountModalOpen.set(true);
  }

  closeAccountModal(): void {
    this.haptics.lightTap();
    this.isAccountModalOpen.set(false);
    this.editingAccountId.set(null);
  }

  async submitAccount(): Promise<void> {
    if (this.accountForm.invalid || this.isSubmitting()) {
      this.accountForm.markAllAsTouched();
      return;
    }

    const { name, type, initialBalance, isActive } = this.accountForm.value;
    const editingId = this.editingAccountId();

    this.isSubmitting.set(true);
    try {
      if (editingId) {
        await this.barberService.updateFinancialAccount(editingId, {
          name: name!.trim(),
          isActive: Boolean(isActive),
        });
        this.haptics.success();
        this.showToast('Cuenta actualizada con éxito');
      } else {
        await this.barberService.createFinancialAccount({
          name: name!.trim(),
          type: type as AccountType,
          initialBalance: Number(initialBalance || 0),
        });
        this.haptics.success();
        this.showToast('Nueva cuenta financiera creada');
      }
      this.closeAccountModal();
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(err?.message || 'Error al guardar la cuenta');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // --- MOVIMIENTOS & TRANSFERENCIAS ---
  openMovementModal(presetAccountId?: string): void {
    this.haptics.lightTap();
    const accounts = this.barberService.financialAccounts().filter((a) => a.isActive);
    const targetAccountId = presetAccountId || accounts[0]?.id || '';

    this.movementForm.reset({
      accountId: targetAccountId,
      movementType: 'expense',
      amount: null,
      description: '',
    });
    this.isMovementModalOpen.set(true);
  }

  closeMovementModal(): void {
    this.haptics.lightTap();
    this.isMovementModalOpen.set(false);
  }

  async submitMovement(): Promise<void> {
    if (this.movementForm.invalid || this.isSubmitting()) {
      this.movementForm.markAllAsTouched();
      return;
    }

    const { accountId, movementType, amount, description } = this.movementForm.value;
    this.isSubmitting.set(true);
    try {
      await this.barberService.createAccountMovement({
        accountId: accountId!,
        movementType: movementType as MovementType,
        amount: Number(amount),
        description: description!.trim(),
      });
      this.haptics.success();
      this.showToast('Movimiento registrado en caja');
      this.closeMovementModal();
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(err?.message || 'Error al registrar movimiento');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openTransferModal(presetFromAccountId?: string): void {
    this.haptics.lightTap();
    const accounts = this.barberService.financialAccounts().filter((a) => a.isActive);
    const fromId = presetFromAccountId || accounts[0]?.id || '';
    const toId = accounts.find((a) => a.id !== fromId)?.id || accounts[1]?.id || '';

    this.transferForm.reset({
      fromAccountId: fromId,
      toAccountId: toId,
      amount: null,
      description: 'Transferencia interna de fondos',
    });
    this.isTransferModalOpen.set(true);
  }

  closeTransferModal(): void {
    this.haptics.lightTap();
    this.isTransferModalOpen.set(false);
  }

  async submitTransfer(): Promise<void> {
    if (this.transferForm.invalid || this.isSubmitting()) {
      this.transferForm.markAllAsTouched();
      return;
    }

    const { fromAccountId, toAccountId, amount, description } = this.transferForm.value;
    if (fromAccountId === toAccountId) {
      this.haptics.warning();
      this.showToast('Las cuentas de origen y destino deben ser diferentes');
      return;
    }

    this.isSubmitting.set(true);
    try {
      await this.barberService.transferBetweenAccounts(
        fromAccountId!,
        toAccountId!,
        Number(amount),
        description?.trim() || 'Transferencia interna'
      );
      this.haptics.success();
      this.showToast('Transferencia completada con éxito');
      this.closeTransferModal();
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(err?.message || 'Error en la transferencia');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // --- FILTROS DE MOVIMIENTOS ---
  setTypeFilter(type: MovementFilterType): void {
    this.haptics.lightTap();
    this.selectedTypeFilter.set(type);
  }

  setAccountFilter(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.selectedAccountFilter.set(val);
  }

  onSearchInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchQuery.set(val);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  // --- UTILIDADES ---
  getAccountPercentage(balance: number): number {
    const total = this.totalConsolidatedBalance();
    if (total <= 0 || balance <= 0) return 0;
    return Math.min(100, Math.round((balance / total) * 100));
  }

  getAccountTypeLabel(type: AccountType): string {
    switch (type) {
      case 'cash': return 'Efectivo / Caja';
      case 'bank': return 'Banco / Tarjetas';
      case 'digital_wallet': return 'Billetera Digital';
      default: return 'Cuenta';
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
