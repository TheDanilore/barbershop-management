import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { SupabaseService } from '../../../../core/services/supabase.service';

@Component({
  selector: 'app-customer-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './customer-profile.page.html',
  styleUrl: './customer-profile.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerProfilePage implements OnInit {
  readonly barberService = inject(BarberService);
  readonly supabaseService = inject(SupabaseService);
  readonly haptics = inject(HapticsService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  // Estados reactivos de guardado de perfil
  readonly isSaving = signal(false);
  readonly saveSuccess = signal(false);
  readonly saveError = signal<string | null>(null);

  // Estados reactivos de cambio de contraseña (Zero-Trust)
  readonly isChangingPassword = signal(false);
  readonly passwordSuccess = signal(false);
  readonly passwordError = signal<string | null>(null);

  // Visibilidad de contraseñas
  readonly showCurrentPassword = signal(false);
  readonly showNewPassword = signal(false);
  readonly showConfirmPassword = signal(false);

  // Cerrojos síncronos contra ráfagas de clicks / bots
  private isProfileLocked = false;
  private isPasswordLocked = false;

  // Formulario reactivo de perfil
  readonly profileForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(70)]],
    phone: ['', [Validators.required, Validators.pattern(/^[0-9+\s-]{7,15}$/)]],
    email: [{ value: '', disabled: true }],
    preferredStyle: [''],
  });

  // Formulario reactivo de cambio de contraseña
  readonly passwordForm: FormGroup = this.fb.group(
    {
      currentPassword: ['', [Validators.required, Validators.minLength(6)]],
      newPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: this.passwordMatchValidator }
  );

  // Medidor de fortaleza de contraseña
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

  readonly currentClient = computed(() => this.barberService.currentClient());

  ngOnInit(): void {
    const client = this.currentClient();
    const profile = this.supabaseService.userProfile();
    const userEmail = this.supabaseService.currentUser()?.email || client.email || '';

    this.profileForm.patchValue({
      fullName: profile?.full_name || client.name,
      phone: profile?.phone || client.phone,
      email: userEmail,
      preferredStyle: profile?.notes || client.notes || 'Degradado medio, navaja al ras',
    });
  }

  readonly isAdmin = computed<boolean>(() => {
    return this.supabaseService.userProfile()?.role === 'admin';
  });

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

  async saveProfile(): Promise<void> {
    if (this.isProfileLocked || this.isSaving()) return;

    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    this.isProfileLocked = true;
    this.isSaving.set(true);
    this.saveError.set(null);
    this.saveSuccess.set(false);

    const { fullName, phone, preferredStyle } = this.profileForm.getRawValue();
    const cleanName = (fullName || '').trim();
    const cleanPhone = (phone || '').trim();
    const cleanStyle = (preferredStyle || '').trim();

    try {
      // 1. Actualización en Supabase si está disponible
      const res = await this.supabaseService.updateUserProfile({
        fullName: cleanName,
        phone: cleanPhone,
        notes: cleanStyle,
      });

      if (!res.success) {
        this.haptics.warning();
        this.saveError.set(res.error || 'Error al actualizar tus datos');
        return;
      }

      // 2. Sincronización con el estado local de clientes
      const client = this.currentClient();
      if (client?.id) {
        await this.barberService.updateClient(client.id, {
          name: cleanName,
          phone: cleanPhone,
          notes: cleanStyle,
        });
      }

      this.haptics.success();
      this.saveSuccess.set(true);
      setTimeout(() => this.saveSuccess.set(false), 3500);
    } catch (err: any) {
      this.haptics.warning();
      this.saveError.set(err?.message || 'Error inesperado al guardar');
    } finally {
      this.isSaving.set(false);
      this.isProfileLocked = false;
    }
  }

  async changePassword(): Promise<void> {
    if (this.isPasswordLocked || this.isChangingPassword()) return;

    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    this.isPasswordLocked = true;
    this.isChangingPassword.set(true);
    this.passwordError.set(null);
    this.passwordSuccess.set(false);

    const { currentPassword, newPassword } = this.passwordForm.value;

    try {
      const res = await this.supabaseService.changePasswordWithVerification(
        currentPassword,
        newPassword
      );

      if (res.success) {
        this.haptics.success();
        this.passwordSuccess.set(true);
        this.passwordForm.reset();
        setTimeout(() => this.passwordSuccess.set(false), 4000);
      } else {
        this.haptics.warning();
        this.passwordError.set(res.error || 'No se pudo actualizar la contraseña');
      }
    } catch (err: any) {
      this.haptics.warning();
      this.passwordError.set(err?.message || 'Error inesperado al actualizar credenciales');
    } finally {
      this.isChangingPassword.set(false);
      this.isPasswordLocked = false;
    }
  }

  private passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const newPass = control.get('newPassword')?.value;
    const confirmPass = control.get('confirmPassword')?.value;
    if (!newPass || !confirmPass) return null;
    return newPass === confirmPass ? null : { passwordMismatch: true };
  }

  switchToBarber(): void {
    if (!this.isAdmin()) {
      this.haptics.warning();
      return;
    }
    this.haptics.lightTap();
    this.barberService.setRole('barber');
    this.router.navigate(['/barber']);
  }

  // Modal de confirmación de cierre de sesión
  readonly showLogoutModal = signal(false);
  readonly isLoggingOut = signal(false);

  promptLogout(): void {
    this.haptics.lightTap();
    this.showLogoutModal.set(true);
  }

  cancelLogout(): void {
    this.haptics.lightTap();
    this.showLogoutModal.set(false);
  }

  async confirmLogout(): Promise<void> {
    if (this.isLoggingOut()) return;
    this.isLoggingOut.set(true);
    this.haptics.lightTap();

    try {
      this.barberService.setRole('landing');
      await this.supabaseService.signOut();
      await this.router.navigate(['/login'], { replaceUrl: true });
    } catch {
      await this.router.navigate(['/login'], { replaceUrl: true });
    } finally {
      this.isLoggingOut.set(false);
      this.showLogoutModal.set(false);
    }
  }

  logout(): void {
    this.promptLogout();
  }
}
