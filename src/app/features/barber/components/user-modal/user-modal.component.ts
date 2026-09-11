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
import { SystemUser } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-user-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './user-modal.component.html',
  styleUrl: './user-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Input() userToEdit: SystemUser | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly userForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    phone: [''],
    role: ['barber', Validators.required],
    isActive: [true],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      if (this.userToEdit) {
        this.userForm.reset({
          fullName: this.userToEdit.fullName,
          phone: this.userToEdit.phone || '',
          role: this.userToEdit.role,
          isActive: this.userToEdit.isActive,
        });
      } else {
        this.userForm.reset({
          fullName: '',
          phone: '',
          role: 'barber',
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
    if (this.userForm.invalid || this.isSubmitting()) {
      this.userForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    const { fullName, phone, role, isActive } = this.userForm.value;
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      if (this.userToEdit) {
        await this.barberService.updateSystemUser(this.userToEdit.id, {
          fullName: fullName!.trim(),
          phone: phone?.trim() || undefined,
          role: role as any,
          isActive: Boolean(isActive),
        });
        this.haptics.success();
        this.saved.emit(`Usuario ${fullName} actualizado correctamente`);
      } else {
        await this.barberService.createSystemUser({
          fullName: fullName!.trim(),
          phone: phone?.trim() || undefined,
          role: role as any,
          isActive: Boolean(isActive),
        });
        this.haptics.success();
        this.saved.emit(`Nuevo colaborador ${fullName} creado`);
      }
      this.close();
    } catch (err: any) {
      this.haptics.warning();
      this.errorMessage.set(err?.message || 'Error al procesar colaborador');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
