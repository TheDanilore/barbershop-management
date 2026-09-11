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
import { MovementType } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-cash-movement-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './cash-movement-modal.component.html',
  styleUrl: './cash-movement-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CashMovementModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Input() presetAccountId?: string;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly movementForm: FormGroup = this.fb.group({
    accountId: ['', Validators.required],
    movementType: ['expense', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.5)]],
    description: ['', [Validators.required, Validators.minLength(3)]],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      const accounts = this.barberService.financialAccounts().filter((a) => a.isActive);
      const targetId = this.presetAccountId || accounts[0]?.id || '';

      this.movementForm.reset({
        accountId: targetId,
        movementType: 'expense',
        amount: null,
        description: '',
      });
    }
  }

  close(): void {
    this.haptics.lightTap();
    this.closed.emit();
  }

  async submit(): Promise<void> {
    if (this.movementForm.invalid || this.isSubmitting()) {
      this.movementForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    const { accountId, movementType, amount, description } = this.movementForm.value;
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      await this.barberService.createAccountMovement({
        accountId: accountId!,
        movementType: movementType as MovementType,
        amount: Number(amount),
        description: description!.trim(),
      });

      this.haptics.success();
      this.saved.emit('Movimiento registrado en caja');
      this.close();
    } catch (err: any) {
      this.haptics.warning();
      this.errorMessage.set(err?.message || 'Error al registrar movimiento');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
