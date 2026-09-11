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
import { AccountType, FinancialAccount } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-financial-account-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './financial-account-modal.component.html',
  styleUrl: './financial-account-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinancialAccountModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Input() accountToEdit: FinancialAccount | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly accountForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    type: ['cash', Validators.required],
    initialBalance: [0, [Validators.required, Validators.min(0)]],
    isActive: [true],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      if (this.accountToEdit) {
        this.accountForm.reset({
          name: this.accountToEdit.name,
          type: this.accountToEdit.type,
          initialBalance: this.accountToEdit.currentBalance,
          isActive: this.accountToEdit.isActive,
        });
      } else {
        this.accountForm.reset({
          name: '',
          type: 'cash',
          initialBalance: 0,
          isActive: true,
        });
      }
    }
  }

  close(): void {
    this.haptics.lightTap();
    this.closed.emit();
  }

  async submit(): Promise<void> {
    if (this.accountForm.invalid || this.isSubmitting()) {
      this.accountForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    const { name, type, initialBalance, isActive } = this.accountForm.value;
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      if (this.accountToEdit) {
        await this.barberService.updateFinancialAccount(this.accountToEdit.id, {
          name: name!.trim(),
          isActive: Boolean(isActive),
        });
        this.haptics.success();
        this.saved.emit('Cuenta actualizada con éxito');
      } else {
        await this.barberService.createFinancialAccount({
          name: name!.trim(),
          type: type as AccountType,
          initialBalance: Number(initialBalance || 0),
        });
        this.haptics.success();
        this.saved.emit('Nueva cuenta financiera creada');
      }
      this.close();
    } catch (err: any) {
      this.haptics.warning();
      this.errorMessage.set(err?.message || 'Error al guardar la cuenta');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
