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
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

export type ProfileModalTab = 'info' | 'password';

@Component({
  selector: 'app-profile-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './profile-modal.component.html',
  styleUrl: './profile-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileModalComponent implements OnChanges {
  readonly supabaseService = inject(SupabaseService);
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Input() initialTab: ProfileModalTab = 'info';
  @Input() profile: { full_name?: string | null; phone?: string | null; email?: string | null } | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<string>();

  readonly currentTab = signal<ProfileModalTab>('info');
  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Visibilidad de contraseñas
  readonly showCurrentPassword = signal(false);
  readonly showNewPassword = signal(false);
  readonly showConfirmPassword = signal(false);

  // Cerrojo síncrono para neutralizar clicks en ráfaga / bots (Zero-Trust)
  private isLocked = false;

  readonly profileForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(70)]],
    phone: ['', [Validators.pattern(/^\+?[0-9\s-]{7,15}$/)]],
  });

  readonly passwordForm: FormGroup = this.fb.group(
    {
      currentPassword: ['', [Validators.required, Validators.minLength(6)]],
      newPassword: [
        '',
        [
          Validators.required,
          Validators.minLength(8),
          Validators.maxLength(72),
        ],
      ],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: this.passwordMatchValidator }
  );

  // Medidor reactivo de fortaleza de contraseña
  readonly passwordStrength = computed<'débil' | 'media' | 'fuerte' | null>(() => {
    const val = this.passwordForm.get('newPassword')?.value;
    if (!val || typeof val !== 'string') return null;
    let score = 0;
    if (val.length >= 8) score++;
    if (val.length >= 12) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;

    if (score <= 2) return 'débil';
    if (score <= 4) return 'media';
    return 'fuerte';
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      this.successMessage.set(null);
      this.currentTab.set(this.initialTab || 'info');
      this.isSubmitting.set(false);
      this.isLocked = false;

      this.profileForm.reset({
        fullName: this.profile?.full_name || '',
        phone: this.profile?.phone || '',
      });
      this.passwordForm.reset();
    }
    if (changes['initialTab'] && this.initialTab) {
      this.currentTab.set(this.initialTab);
    }
  }

  setTab(tab: ProfileModalTab): void {
    if (this.isSubmitting() || this.isLocked) return;
    this.haptics.lightTap();
    this.currentTab.set(tab);
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }

  togglePasswordVisibility(field: 'current' | 'new' | 'confirm'): void {
    this.haptics.lightTap();
    if (field === 'current') {
      this.showCurrentPassword.update((v) => !v);
    } else if (field === 'new') {
      this.showNewPassword.update((v) => !v);
    } else {
      this.showConfirmPassword.update((v) => !v);
    }
  }

  close(): void {
    if (this.isSubmitting()) return;
    this.haptics.lightTap();
    this.closed.emit();
  }

  async submitProfile(): Promise<void> {
    if (this.isLocked || this.isSubmitting()) return;

    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    this.isLocked = true;
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { fullName, phone } = this.profileForm.value;

    try {
      const res = await this.supabaseService.updateUserProfile({
        fullName: fullName?.trim(),
        phone: phone?.trim() || null,
      });

      if (res.success) {
        await this.barberService.syncFromSupabase();
        this.haptics.success();
        this.saved.emit('✅ Datos del perfil actualizados correctamente');
        this.close();
      } else {
        this.haptics.warning();
        this.errorMessage.set(res.error || 'Error al actualizar el perfil');
      }
    } catch (err: any) {
      this.haptics.warning();
      this.errorMessage.set(err?.message || 'Error inesperado al guardar');
    } finally {
      this.isSubmitting.set(false);
      this.isLocked = false;
    }
  }

  async submitPassword(): Promise<void> {
    if (this.isLocked || this.isSubmitting()) return;

    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    this.isLocked = true;
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { currentPassword, newPassword } = this.passwordForm.value;

    try {
      const res = await this.supabaseService.changePasswordWithVerification(
        currentPassword,
        newPassword
      );

      if (res.success) {
        this.haptics.success();
        this.successMessage.set('🔒 ¡Contraseña modificada con éxito!');
        this.passwordForm.reset();
        this.saved.emit('✅ Contraseña actualizada de forma segura');
        setTimeout(() => {
          this.close();
        }, 1200);
      } else {
        this.haptics.warning();
        this.errorMessage.set(res.error || 'No se pudo actualizar la contraseña');
      }
    } catch (err: any) {
      this.haptics.warning();
      this.errorMessage.set(err?.message || 'Error inesperado en cambio de credenciales');
    } finally {
      this.isSubmitting.set(false);
      this.isLocked = false;
    }
  }

  private passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const newPass = control.get('newPassword')?.value;
    const confirmPass = control.get('confirmPassword')?.value;
    if (!newPass || !confirmPass) return null;
    return newPass === confirmPass ? null : { passwordMismatch: true };
  }
}
