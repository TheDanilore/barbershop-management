import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-cash-transfer-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './cash-transfer-modal.component.html',
  styleUrl: './cash-transfer-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CashTransferModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Input() presetFromAccountId?: string;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly transferForm: FormGroup = this.fb.group({
    fromAccountId: ['', Validators.required],
    toAccountId: ['', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.5)]],
    description: ['Transferencia interna de fondos'],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      const accounts = this.barberService.financialAccounts().filter((a) => a.isActive);
      const fromId = this.presetFromAccountId || accounts[0]?.id || '';
      const toId = accounts.find((a) => a.id !== fromId)?.id || accounts[1]?.id || '';

      this.transferForm.reset({
        fromAccountId: fromId,
        toAccountId: toId,
        amount: null,
        description: 'Transferencia interna de fondos',
      });
    }
  }

  close(): void {
    this.haptics.lightTap();
    this.closed.emit();
  }

  async submit(): Promise<void> {
    if (this.transferForm.invalid || this.isSubmitting()) {
      this.transferForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    const { fromAccountId, toAccountId, amount, description } = this.transferForm.value;

    if (fromAccountId === toAccountId) {
      this.haptics.warning();
      this.errorMessage.set('La cuenta origen y destino no pueden ser la misma.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      await this.barberService.transferBetweenAccounts(
        fromAccountId!,
        toAccountId!,
        Number(amount),
        description?.trim() || 'Traspaso de fondos entre cuentas'
      );

      this.haptics.success();
      this.saved.emit('Transferencia realizada con éxito');
      this.close();
    } catch (err: any) {
      this.haptics.warning();
      this.errorMessage.set(err?.message || 'Error al procesar la transferencia');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
