import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
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
import { Router } from '@angular/router';
import { BarberService } from '../../../core/services/barber.service';
import { HapticsService } from '../../../core/services/haptics.service';
import { LoggerService } from '../../../core/services/logger.service';
import { SupabaseService } from '../../../core/services/supabase.service';

export type AuthMode = 'login' | 'register';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './login.page.html',
  styleUrl: './login.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  readonly supabaseService = inject(SupabaseService);
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  readonly logger = inject(LoggerService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  // Modo activo de autenticación: 'login' o 'register'
  readonly authMode = signal<AuthMode>('login');

  // Signals reactivos para estados de interacción en la UI
  readonly isLoading = signal(false);
  readonly isPasswordVisible = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  // Formulario reactivo de Login
  readonly loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  // Formulario reactivo de Registro (Exclusivo para Clientes)
  readonly registerForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    phone: ['', [Validators.pattern(/^\+?[0-9\s-]{7,15}$/)]],
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.feedbackTimeout) clearTimeout(this.feedbackTimeout);
    });
  }

  @HostListener('window:keydown.escape')
  handleEscapeKey(): void {
    if (this.errorMessage() || this.successMessage()) {
      this.errorMessage.set(null);
      this.successMessage.set(null);
    }
  }

  setAuthMode(mode: AuthMode): void {
    this.haptics.selection();
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.authMode.set(mode);
  }

  togglePasswordVisibility(): void {
    this.haptics.lightTap();
    this.isPasswordVisible.update((val) => !val);
  }

  /**
   * Iniciar sesión con Supabase Auth y redirección automática según rol del perfil
   */
  async handleLogin(): Promise<void> {
    if (this.loginForm.invalid || this.isLoading()) {
      this.loginForm.markAllAsTouched();
      this.haptics.warning();
      this.showError('Ingresa un correo y contraseña válidos');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);
    const rawEmail = this.loginForm.value.email || '';
    const cleanEmail = rawEmail.trim().toLowerCase();
    const cleanPassword = this.loginForm.value.password || '';

    this.logger.info('LoginPage', `Intento de login con email: ${cleanEmail}`);

    try {
      const res = await this.supabaseService.signInWithPassword(cleanEmail, cleanPassword);

      if (res.error) {
        this.haptics.warning();
        const code = res.error.code ?? '';
        const msg = res.error.message ?? '';
        let friendlyMessage = 'No se pudo iniciar sesión. Verifica tus datos.';
        if (code === 'invalid_credentials' || msg === 'Invalid login credentials') {
          friendlyMessage = 'Credenciales inválidas. Verifica tu correo y contraseña.';
        } else if (code === 'email_not_confirmed' || msg.includes('Email not confirmed')) {
          friendlyMessage = 'Correo no verificado. Confirma tu correo o desactiva "Confirm email" en Supabase.';
        } else if (code === 'email_provider_disabled' || msg.includes('Email logins are disabled')) {
          friendlyMessage = 'El acceso por correo está deshabilitado en Supabase Auth.';
        } else if (msg) {
          friendlyMessage = msg;
        }
        this.showError(friendlyMessage);
      } else {
        this.haptics.success();
        this.logger.info('LoginPage', `Login exitoso. Rol detectado: ${res.role}`);
        this.showSuccess('¡Bienvenido a BarberTrack!');

        // Redirección inteligente basada en el rol resuelto en Supabase
        const isStaff = res.role === 'barber' || res.role === 'admin';
        const targetRoute = isStaff ? '/barber' : '/customer';
        this.barberService.setRole(isStaff ? 'barber' : 'client');
        this.barberService.syncFromSupabase();

        setTimeout(() => {
          this.router.navigate([targetRoute]);
        }, 300);
      }
    } catch (err: unknown) {
      this.haptics.warning();
      const message = err instanceof Error ? err.message : 'Error de conexión con Supabase';
      this.logger.error('LoginPage', `Excepción en submitLogin: ${message}`, err);
      this.showError(message);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Registro en Supabase (Estrictamente Clientes)
   */
  async handleRegister(): Promise<void> {
    if (this.registerForm.invalid || this.isLoading()) {
      this.registerForm.markAllAsTouched();
      this.haptics.warning();
      this.showError('Por favor completa todos los campos requeridos');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);
    const { email, password, fullName, phone } = this.registerForm.value;
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanFullName = (fullName || '').trim();
    const cleanPhone = phone?.trim() || undefined;

    this.logger.info('LoginPage', `Registrando cliente: ${cleanEmail}`);

    try {
      const res = await this.supabaseService.signUpCustomer(
        cleanEmail,
        password,
        cleanFullName,
        cleanPhone
      );

      if (res.error) {
        this.haptics.warning();
        this.logger.error('LoginPage', `Error registrando cliente: ${res.error.message}`);
        this.showError(res.error.message);
      } else {
        this.haptics.success();
        this.logger.info('LoginPage', `Cliente registrado exitosamente en Supabase`);
        this.showSuccess('Cuenta de cliente creada exitosamente.');
        this.barberService.setRole('client');

        setTimeout(() => {
          this.router.navigate(['/customer']);
        }, 700);
      }
    } catch (err: unknown) {
      this.haptics.warning();
      const message = err instanceof Error ? err.message : 'Error al registrar cliente';
      this.logger.error('LoginPage', `Excepción registrando cliente: ${message}`, err);
      this.showError(message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private showError(msg: string): void {
    this.errorMessage.set(msg);
    if (this.feedbackTimeout) clearTimeout(this.feedbackTimeout);
    this.feedbackTimeout = setTimeout(() => this.errorMessage.set(null), 5000);
  }

  private showSuccess(msg: string): void {
    this.successMessage.set(msg);
    if (this.feedbackTimeout) clearTimeout(this.feedbackTimeout);
    this.feedbackTimeout = setTimeout(() => this.successMessage.set(null), 5000);
  }
}
