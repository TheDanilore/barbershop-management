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

export type AuthTab = 'login' | 'register';

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

  // Pestaña activa: 'login' o 'register'
  readonly activeTab = signal<AuthTab>('login');

  // Visor de logs interactivo en pantalla
  readonly showLogsModal = signal(false);

  // Estados de interacción y feedback
  readonly isLoading = signal(false);
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
    phone: [''],
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.feedbackTimeout) clearTimeout(this.feedbackTimeout);
    });
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcuts(event: KeyboardEvent): void {
    const activeEl = document.activeElement;
    const isTyping =
      activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement;

    if (event.key === 'Escape') {
      this.showLogsModal.set(false);
      return;
    }

    if (!isTyping) {
      if (event.key === '1') {
        this.setTab('login');
      } else if (event.key === '2') {
        this.setTab('register');
      }
    }
  }

  setTab(tab: AuthTab): void {
    this.haptics.selection();
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.activeTab.set(tab);
  }

  toggleLogsModal(): void {
    this.haptics.lightTap();
    this.showLogsModal.update((v) => !v);
  }

  /**
   * Iniciar sesión con Supabase Auth y redirección automática según rol del perfil
   */
  async submitLogin(): Promise<void> {
    if (this.loginForm.invalid || this.isLoading()) {
      this.loginForm.markAllAsTouched();
      this.haptics.warning();
      this.showError('Ingresa un correo y contraseña válidos');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);
    const { email, password } = this.loginForm.value;

    this.logger.info('LoginPage', `Intento de login con email: ${email}`);

    try {
      const res = await this.supabaseService.signInWithPassword(email.trim(), password);

      if (res.error) {
        this.haptics.warning();
        this.logger.error('LoginPage', `Error Supabase Auth: ${res.error.message}`, {
          status: res.error.status,
          code: res.error.code,
        });
        this.showError(res.error.message || 'Credenciales no válidas en Supabase');
      } else {
        this.haptics.success();
        this.logger.info('LoginPage', `Login exitoso. Rol detectado: ${res.role}`);
        this.showSuccess('¡Bienvenido a BarberTrack!');

        // Redirección inteligente basada en el rol resuelto en Supabase
        const targetRoute = res.role === 'barber' || res.role === 'admin' ? '/barber' : '/customer';
        this.barberService.setRole(res.role === 'barber' || res.role === 'admin' ? 'barber' : 'client');

        setTimeout(() => {
          this.router.navigate([targetRoute]);
        }, 400);
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
  async submitRegister(): Promise<void> {
    if (this.registerForm.invalid || this.isLoading()) {
      this.registerForm.markAllAsTouched();
      this.haptics.warning();
      this.showError('Completa todos los campos obligatorios');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);
    const { email, password, fullName, phone } = this.registerForm.value;

    this.logger.info('LoginPage', `Registrando cliente: ${email}`);

    try {
      const res = await this.supabaseService.signUpCustomer(
        email.trim(),
        password,
        fullName.trim(),
        phone?.trim()
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
        }, 800);
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

  /**
   * Relleno rápido de credenciales en el formulario para probar
   */
  fillDemoCredentials(role: 'barber' | 'customer'): void {
    this.haptics.selection();
    if (role === 'barber') {
      this.loginForm.patchValue({
        email: 'admin@barbertrack.com',
        password: 'barberpassword123',
      });
    } else {
      this.loginForm.patchValue({
        email: 'mateo@cliente.com',
        password: 'clientepassword123',
      });
    }
  }

  /**
   * Acceso instantáneo demo para no bloquear el desarrollo
   */
  quickDemoLogin(role: 'barber' | 'customer'): void {
    this.haptics.selection();
    this.supabaseService.setRole(role);
    this.barberService.setRole(role === 'barber' ? 'barber' : 'client');
    this.router.navigate([role === 'barber' ? '/barber' : '/customer']);
  }

  retryHealthCheck(): void {
    this.haptics.lightTap();
    this.supabaseService.checkHealth();
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
