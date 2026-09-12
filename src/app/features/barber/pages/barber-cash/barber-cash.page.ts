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
import { AccountType, FinancialAccount, MovementType } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

export type MovementFilterType = 'all' | 'income' | 'expense' | 'transfer';

import { CashShiftModalComponent } from '../../components/cash-shift-modal/cash-shift-modal.component';
import { FinancialAccountModalComponent } from '../../components/financial-account-modal/financial-account-modal.component';
import { CashMovementModalComponent } from '../../components/cash-movement-modal/cash-movement-modal.component';
import { CashTransferModalComponent } from '../../components/cash-transfer-modal/cash-transfer-modal.component';

@Component({
  selector: 'app-barber-cash',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CashShiftModalComponent,
    FinancialAccountModalComponent,
    CashMovementModalComponent,
    CashTransferModalComponent,
  ],
  templateUrl: './barber-cash.page.html',
  styleUrl: './barber-cash.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberCashPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.toastTimeout) clearTimeout(this.toastTimeout);
    });
  }

  // Estado de Carga Inicial Real (SWR): Solo shimmer si la caché local está 100% vacía
  readonly isCashInitialLoading = computed(() => {
    return this.barberService.isLoading() && this.barberService.financialAccounts().length === 0;
  });

  // Sincronización en segundo plano (datos en caché se muestran al instante)
  readonly isBackgroundSyncing = computed(() => {
    return this.barberService.isLoading() && this.barberService.financialAccounts().length > 0;
  });

  // Modales
  readonly isShiftModalOpen = signal(false);
  readonly shiftMode = signal<'open' | 'close'>('open');
  readonly isAccountModalOpen = signal(false);
  readonly editingAccount = signal<FinancialAccount | null>(null);
  readonly isMovementModalOpen = signal(false);
  readonly presetMovementAccountId = signal<string | undefined>(undefined);
  readonly isTransferModalOpen = signal(false);
  readonly presetTransferFromAccountId = signal<string | undefined>(undefined);

  // Filtros de Movimientos
  readonly searchQuery = signal<string>('');
  readonly selectedTypeFilter = signal<MovementFilterType>('all');
  readonly selectedAccountFilter = signal<string>('all');

  // Paginación en memoria (15 por página para máximo rendimiento DOM)
  readonly pageSize = signal<number>(15);
  readonly currentPage = signal<number>(1);

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

  // Movimientos Filtrados
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

  // Paginación reactiva de movimientos
  readonly totalPages = computed(() => {
    return Math.ceil(this.filteredMovements().length / this.pageSize()) || 1;
  });

  readonly paginatedMovements = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.filteredMovements().slice(start, start + this.pageSize());
  });

  readonly paginationInfo = computed(() => {
    const total = this.filteredMovements().length;
    if (total === 0) return '0 de 0 movimientos';
    const start = (this.currentPage() - 1) * this.pageSize() + 1;
    const end = Math.min(this.currentPage() * this.pageSize(), total);
    return `Mostrando ${start} - ${end} de ${total}`;
  });

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update((p) => p + 1);
    }
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update((p) => p - 1);
    }
  }


  // Atajos de teclado contextuales sin colisión con BarberLayout (Alt+N: Corte, Alt+A: Cita, Alt+C: Cliente)
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

    // Alt+Q: Arqueo / Cierre / Apertura de caja (No colisiona con Alt+A de Agendar Cita)
    if (e.altKey && (e.key === 'q' || e.key === 'Q')) {
      e.preventDefault();
      this.openShiftModal(this.activeShift() ? 'close' : 'open');
    }
    // Alt+K: Nueva Cuenta Financiera (No colisiona con Alt+C de Nuevo Cliente)
    else if (e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      this.openCreateAccountModal();
    }
    // Alt+M: Registrar Movimiento
    else if (e.altKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      this.openMovementModal();
    }
    // Alt+T: Transferir entre Cuentas
    else if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      this.openTransferModal();
    }
  }

  // --- MÉTODOS DE TURNO (ARQUEO / APERTURA) ---
  openShiftModal(mode: 'open' | 'close'): void {
    this.haptics.lightTap();
    this.shiftMode.set(mode);
    this.isShiftModalOpen.set(true);
  }

  closeShiftModal(): void {
    this.isShiftModalOpen.set(false);
  }

  // --- GESTIÓN DE CUENTAS FINANCIERAS ---
  openCreateAccountModal(): void {
    this.haptics.lightTap();
    this.editingAccount.set(null);
    this.isAccountModalOpen.set(true);
  }

  openEditAccountModal(account: FinancialAccount): void {
    this.haptics.lightTap();
    this.editingAccount.set(account);
    this.isAccountModalOpen.set(true);
  }

  closeAccountModal(): void {
    this.haptics.lightTap();
    this.isAccountModalOpen.set(false);
    this.editingAccount.set(null);
  }

  // --- MOVIMIENTOS & TRANSFERENCIAS ---
  openMovementModal(presetAccountId?: string): void {
    this.haptics.lightTap();
    this.presetMovementAccountId.set(presetAccountId);
    this.isMovementModalOpen.set(true);
  }

  closeMovementModal(): void {
    this.haptics.lightTap();
    this.isMovementModalOpen.set(false);
    this.presetMovementAccountId.set(undefined);
  }

  openTransferModal(presetFromAccountId?: string): void {
    this.haptics.lightTap();
    this.presetTransferFromAccountId.set(presetFromAccountId);
    this.isTransferModalOpen.set(true);
  }

  closeTransferModal(): void {
    this.haptics.lightTap();
    this.isTransferModalOpen.set(false);
    this.presetTransferFromAccountId.set(undefined);
  }

  // --- FILTROS DE MOVIMIENTOS ---
  setTypeFilter(type: MovementFilterType): void {
    this.haptics.lightTap();
    this.selectedTypeFilter.set(type);
    this.currentPage.set(1);
  }

  setAccountFilter(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.selectedAccountFilter.set(val);
    this.currentPage.set(1);
  }

  onSearchInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchQuery.set(val);
    this.currentPage.set(1);
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.currentPage.set(1);
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
