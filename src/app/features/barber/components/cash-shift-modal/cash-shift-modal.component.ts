import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

export interface ShiftDiscrepancy {
  difference: number;
  status: 'perfect' | 'shortage' | 'surplus' | 'none';
  expected: number;
  actual: number;
}

/**
 * Componente Standalone Reutilizable de Apertura y Cierre/Arqueo de Turno de Caja.
 * Usado tanto en BarberDashboardPage como en BarberCashPage.
 */
@Component({
  selector: 'app-cash-shift-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './cash-shift-modal.component.html',
  styleUrl: './cash-shift-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CashShiftModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);
  private readonly logger = inject(LoggerService);

  @Input() isOpen = false;
  @Input() mode: 'open' | 'close' = 'open';

  @Output() closed = new EventEmitter<void>();
  @Output() shiftSuccess = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly isLoadingSuggested = signal(false);
  readonly suggestedAmount = signal<number>(0);
  readonly actualCashInput = signal<number>(0);

  // Símbolo oficial de moneda configurado en el negocio
  readonly currencySymbol = this.barberService.currencySymbol;

  // Turno activo en tiempo real
  readonly activeShift = computed(() => this.barberService.activeCashShift());

  // Formulario de Apertura de Gaveta
  readonly openShiftForm: FormGroup = this.fb.group({
    initialCash: [0, [Validators.required, Validators.min(0)]],
    notes: [''],
  });

  // Formulario de Cierre & Arqueo
  readonly closeShiftForm: FormGroup = this.fb.group({
    actualCash: [0, [Validators.required, Validators.min(0)]],
    notes: [''],
  });

  // Cálculo interactivo del arqueo y detección reactiva de faltante/sobrante
  readonly shiftDiscrepancy = computed<ShiftDiscrepancy>(() => {
    const shift = this.activeShift();
    if (!shift) return { difference: 0, status: 'none', expected: 0, actual: 0 };

    const expected = Number(shift.expectedCash || 0);
    const actual = Number(this.actualCashInput() || 0);
    const difference = actual - expected;

    let status: 'perfect' | 'shortage' | 'surplus' = 'perfect';
    if (difference < -0.01) status = 'shortage';
    else if (difference > 0.01) status = 'surplus';

    return { difference, status, expected, actual };
  });

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['isOpen'] && this.isOpen) || (changes['mode'] && this.isOpen)) {
      this.initFormState();
    }
  }

  private async initFormState(): Promise<void> {
    this.errorMessage.set(null);

    if (this.mode === 'open') {
      this.isLoadingSuggested.set(true);
      try {
        const suggested = await this.barberService.getSuggestedOpeningCash();
        this.suggestedAmount.set(suggested);
        this.openShiftForm.reset({ initialCash: suggested, notes: '' });
      } catch (err) {
        this.logger.warn('CashShiftModalComponent', 'No se pudo resolver fondo sugerido', err);
        this.openShiftForm.reset({ initialCash: 0, notes: '' });
      } finally {
        this.isLoadingSuggested.set(false);
      }
    } else {
      const shift = this.activeShift();
      const expected = shift?.expectedCash ?? 0;
      this.actualCashInput.set(expected);
      this.closeShiftForm.reset({
        actualCash: expected,
        notes: '',
      });
    }
  }

  onActualCashChange(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    this.actualCashInput.set(val || 0);
  }

  closeModal(): void {
    this.errorMessage.set(null);
    this.haptics.lightTap();
    this.closed.emit();
  }

  async submitShift(): Promise<void> {
    if (this.isSubmitting()) return;
    this.errorMessage.set(null);

    if (this.mode === 'open') {
      if (this.openShiftForm.invalid) {
        this.openShiftForm.markAllAsTouched();
        this.haptics.warning();
        return;
      }

      this.isSubmitting.set(true);
      try {
        const { initialCash, notes } = this.openShiftForm.value;
        await this.barberService.openCashShift(Number(initialCash), notes?.trim());
        this.haptics.success();
        this.shiftSuccess.emit('🟢 Turno de caja abierto correctamente');
        this.closeModal();
      } catch (err: any) {
        this.logger.error('CashShiftModalComponent', 'Error abriendo turno de caja', err);
        this.errorMessage.set(err.message || 'Error al abrir el turno de caja. Verifica tu conexión.');
        this.haptics.warning();
      } finally {
        this.isSubmitting.set(false);
      }
    } else {
      if (this.closeShiftForm.invalid) {
        this.closeShiftForm.markAllAsTouched();
        this.haptics.warning();
        return;
      }

      this.isSubmitting.set(true);
      try {
        const { actualCash, notes } = this.closeShiftForm.value;
        await this.barberService.closeCashShift(Number(actualCash), notes?.trim());
        this.haptics.success();
        this.shiftSuccess.emit('🔴 Turno cerrado y arqueado correctamente');
        this.closeModal();
      } catch (err: any) {
        this.logger.error('CashShiftModalComponent', 'Error cerrando turno de caja', err);
        this.errorMessage.set(err.message || 'Error al cerrar el turno y arquear.');
        this.haptics.warning();
      } finally {
        this.isSubmitting.set(false);
      }
    }
  }
}

