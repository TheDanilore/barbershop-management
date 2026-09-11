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
import { LoyaltyReward } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-loyalty-reward-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './loyalty-reward-modal.component.html',
  styleUrl: './loyalty-reward-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoyaltyRewardModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Input() rewardToEdit: LoyaltyReward | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly loyaltyRewardForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    description: [''],
    rewardType: ['free_cut', [Validators.required]],
    stampsRequired: [10, [Validators.required, Validators.min(1), Validators.max(100)]],
    rewardValue: [null as number | null, [Validators.min(0)]],
    isActive: [true],
    sortOrder: [0, [Validators.min(0)]],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      if (this.rewardToEdit) {
        this.loyaltyRewardForm.reset({
          name: this.rewardToEdit.name,
          description: this.rewardToEdit.description || '',
          rewardType: this.rewardToEdit.rewardType,
          stampsRequired: this.rewardToEdit.stampsRequired,
          rewardValue: this.rewardToEdit.rewardValue ?? null,
          isActive: this.rewardToEdit.isActive,
          sortOrder: this.rewardToEdit.sortOrder ?? 0,
        });
      } else {
        this.loyaltyRewardForm.reset({
          name: '',
          description: '',
          rewardType: 'free_cut',
          stampsRequired: 10,
          rewardValue: null,
          isActive: true,
          sortOrder: 0,
        });
      }
    }
  }

  close(): void {
    this.haptics.lightTap();
    this.closed.emit();
  }

  async submit(): Promise<void> {
    if (this.loyaltyRewardForm.invalid || this.isSubmitting()) {
      this.loyaltyRewardForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    const {
      name,
      description,
      rewardType,
      stampsRequired,
      rewardValue,
      isActive,
      sortOrder,
    } = this.loyaltyRewardForm.value;

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      await this.barberService.saveLoyaltyReward({
        id: this.rewardToEdit?.id,
        name: name.trim(),
        description: description?.trim() || undefined,
        rewardType,
        stampsRequired: Number(stampsRequired),
        rewardValue: rewardValue !== null && rewardValue !== '' ? Number(rewardValue) : undefined,
        isActive: Boolean(isActive),
        sortOrder: Number(sortOrder || 0),
      });

      this.haptics.success();
      this.saved.emit(this.rewardToEdit ? 'Recompensa actualizada' : 'Recompensa creada con éxito');
      this.close();
    } catch (err: any) {
      this.haptics.warning();
      this.errorMessage.set(err?.message || 'Error al guardar la recompensa');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
