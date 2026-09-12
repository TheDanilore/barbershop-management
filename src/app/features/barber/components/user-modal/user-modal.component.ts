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
  readonly isPasswordVisible = signal(false);

  readonly userForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    phone: ['', [Validators.pattern(/^\+?[0-9\s-]{7,15}$/)]],
    role: ['barber', Validators.required],
    isActive: [true],
  });

  togglePasswordVisibility(): void {
    this.haptics.lightTap();
    this.isPasswordVisible.update((v) => !v);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      this.isPasswordVisible.set(false);

      const emailControl = this.userForm.get('email');
      const passwordControl = this.userForm.get('password');

      if (this.userToEdit) {
        // En edición, email es opcional y password no se requiere modificar aquí
        emailControl?.setValidators([Validators.email]);
        passwordControl?.clearValidators();
        emailControl?.updateValueAndValidity();
        passwordControl?.updateValueAndValidity();

        this.userForm.reset({
          fullName: this.userToEdit.fullName,
          email: this.userToEdit.email || '',
          password: '',
          phone: this.userToEdit.phone || '',
          role: this.userToEdit.role,
          isActive: this.userToEdit.isActive,
        });
      } else {
        // En creación, email y password son obligatorios para habilitar el login del colaborador
        emailControl?.setValidators([Validators.required, Validators.email]);
        passwordControl?.setValidators([Validators.required, Validators.minLength(6)]);
        emailControl?.updateValueAndValidity();
        passwordControl?.updateValueAndValidity();

        this.userForm.reset({
          fullName: '',
          email: '',
          password: '',
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

    const { fullName, email, password, phone, role, isActive } = this.userForm.value;
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
          email: email?.trim().toLowerCase() || undefined,
          password: password?.trim() || undefined,
          phone: phone?.trim() || undefined,
          role: role as any,
          isActive: Boolean(isActive),
        });
        this.haptics.success();
        this.saved.emit(`Nuevo colaborador ${fullName} creado exitosamente`);
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
