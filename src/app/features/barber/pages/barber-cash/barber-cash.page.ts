import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AccountType, FinancialAccount, MovementType } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

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

  // Toast
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Formularios
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
    amount: [null, [Validators.required, Validators.min(0.5)]],
    description: ['', [Validators.required, Validators.minLength(3)]],
  });

  readonly transferForm = this.fb.group({
    fromAccountId: ['', Validators.required],
    toAccountId: ['', Validators.required],
    amount: [null, [Validators.required, Validators.min(0.5)]],
    description: ['Transferencia interna'],
  });

  // Turno de Caja (Apertura y Cierre)
  openShiftModal(mode: 'open' | 'close'): void {
    this.haptics.lightTap();
    this.shiftMode.set(mode);
    if (mode === 'open') {
      this.openShiftForm.reset({ initialCash: 50, notes: '' });
    } else {
      const activeShift = this.barberService.activeCashShift();
      this.closeShiftForm.reset({
        actualCash: activeShift?.expectedCash ?? 0,
        notes: '',
      });
    }
    this.isShiftModalOpen.set(true);
  }

  closeShiftModal(): void {
    this.haptics.lightTap();
    this.isShiftModalOpen.set(false);
  }

  async submitShift(): Promise<void> {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);

    try {
      if (this.shiftMode() === 'open') {
        if (this.openShiftForm.invalid) {
          this.openShiftForm.markAllAsTouched();
          return;
        }
        const { initialCash, notes } = this.openShiftForm.value;
        await this.barberService.openCashShift(Number(initialCash), notes?.trim());
        this.haptics.success();
        this.showToast('🟢 Turno de caja abierto');
      } else {
        if (this.closeShiftForm.invalid) {
          this.closeShiftForm.markAllAsTouched();
          return;
        }
        const { actualCash, notes } = this.closeShiftForm.value;
        await this.barberService.closeCashShift(Number(actualCash), notes?.trim());
        this.haptics.success();
        this.showToast('🔴 Turno cerrado y arqueado');
      }
      this.closeShiftModal();
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(err?.message || 'Error al procesar el turno');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // Cuentas financieras
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
        this.showToast('Cuenta actualizada');
      } else {
        await this.barberService.createFinancialAccount({
          name: name!.trim(),
          type: type as AccountType,
          initialBalance: Number(initialBalance || 0),
        });
        this.haptics.success();
        this.showToast('Cuenta financiera creada');
      }
      this.closeAccountModal();
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(err?.message || 'Error al guardar la cuenta');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // Movimientos y transferencias
  openMovementModal(): void {
    this.haptics.lightTap();
    const firstAcc = this.barberService.financialAccounts()[0];
    this.movementForm.reset({
      accountId: firstAcc?.id || '',
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
      this.showToast('Movimiento registrado');
      this.closeMovementModal();
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(err?.message || 'Error al registrar movimiento');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openTransferModal(): void {
    this.haptics.lightTap();
    const accounts = this.barberService.financialAccounts();
    this.transferForm.reset({
      fromAccountId: accounts[0]?.id || '',
      toAccountId: accounts[1]?.id || '',
      amount: null,
      description: 'Transferencia interna',
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
      this.showToast('Las cuentas de origen y destino deben ser distintas');
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

  getAccountTypeLabel(type: AccountType): string {
    switch (type) {
      case 'cash': return 'Efectivo / Caja';
      case 'bank': return 'Banco';
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
