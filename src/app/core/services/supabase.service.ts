import { Injectable, inject, signal } from '@angular/core';
import { SupabaseClient, User, createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { ProfileRow, UserRole } from '../models/barber.models';
import { LoggerService } from './logger.service';

export type SupabaseConnectionStatus = 'checking' | 'connected' | 'offline' | 'error';

const STORAGE_KEY_ROLE = 'barbertrack_user_role';

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  private readonly logger = inject(LoggerService);

  // Cliente oficial de Supabase
  public readonly supabase: SupabaseClient;

  // Reactive signal for the authenticated user
  public readonly currentUser = signal<User | null>(null);

  // Reactive signal for the current user role ('barber' | 'customer' | 'admin')
  public readonly currentRole = signal<UserRole | null>(this.getInitialRole());

  // Reactive signal for the current user profile
  public readonly userProfile = signal<ProfileRow | null>(null);

  // Signal for network status
  public readonly isOnline = signal<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Signal for Supabase latency & active status
  public readonly connectionStatus = signal<SupabaseConnectionStatus>('checking');
  public readonly latencyMs = signal<number | null>(null);

  private lastHealthCheck = 0;
  private isCheckingHealth = false;
  private readonly HEALTH_COOLDOWN_MS = 30000; // 30s de enfriamiento para proteger cuota de Data Egress

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });

    // Listen to auth state changes reactively
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user ?? null;
      this.currentUser.set(user);
      this.logger.info('SupabaseService', `Auth state changed: ${event}`, {
        userId: user?.id,
        email: user?.email,
      });

      if (user) {
        await this.loadUserProfile(user.id);
      } else if (event === 'SIGNED_OUT') {
        this.clearSessionState();
      }
    });

    // Monitorear conectividad de red para PWA con debounce
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline.set(true);
        this.logger.info('SupabaseService', 'Red restablecida (online)');
        this.checkHealth();
      });
      window.addEventListener('offline', () => {
        this.isOnline.set(false);
        this.connectionStatus.set('offline');
        this.logger.warn('SupabaseService', 'Conexión a internet perdida (offline)');
      });
    }

    // Comprobar salud inicial
    this.checkHealth(true);
  }

  /**
   * Ping activo a Supabase para verificar conexión en tiempo real y medir latencia.
   * Incluye protección de cooldown y candado de ejecución para evitar sobreconsumo de Egress.
   */
  async checkHealth(force = false): Promise<void> {
    if (!this.isOnline()) {
      this.connectionStatus.set('offline');
      return;
    }

    const now = Date.now();
    if (!force && (now - this.lastHealthCheck < this.HEALTH_COOLDOWN_MS || this.isCheckingHealth)) {
      return;
    }

    this.isCheckingHealth = true;
    this.connectionStatus.set('checking');
    const start = performance.now();

    try {
      // Petición HEAD ultraliviana a profiles
      const { error } = await this.supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true });

      const elapsed = Math.round(performance.now() - start);
      this.latencyMs.set(elapsed);

      if (error && error.code !== 'PGRST116') {
        if (error.message.includes('FetchError') || error.message.includes('network')) {
          this.connectionStatus.set('error');
        } else {
          this.connectionStatus.set('connected');
        }
      } else {
        this.connectionStatus.set('connected');
      }

      this.logger.info('SupabaseService', `Salud de Supabase verificada (${elapsed}ms)`);
    } catch (err: unknown) {
      this.latencyMs.set(null);
      this.connectionStatus.set(this.isOnline() ? 'error' : 'offline');
      this.logger.warn('SupabaseService', 'Error comprobando conectividad con Supabase', err);
    } finally {
      this.lastHealthCheck = Date.now();
      this.isCheckingHealth = false;
    }
  }

  /**
   * Iniciar sesión con Email y Contraseña, resolviendo el rol del usuario en la base de datos
   */
  async signInWithPassword(email: string, password: string) {
    this.logger.info('SupabaseService', `Iniciando autenticación para: ${email}`);
    const res = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (res.error) {
      this.logger.error('SupabaseService', `Fallo de autenticación: ${res.error.message}`, {
        status: res.error.status,
        code: res.error.code,
        name: res.error.name,
        email,
      });
      return { ...res, role: null };
    }

    if (res.data.user) {
      this.logger.info('SupabaseService', `Autenticación exitosa en Supabase Auth`, {
        userId: res.data.user.id,
        email: res.data.user.email,
      });
      this.currentUser.set(res.data.user);
      const profile = await this.loadUserProfile(res.data.user.id);
      const role: UserRole =
        profile?.role ||
        (res.data.user.app_metadata?.['role'] as UserRole) ||
        (res.data.user.user_metadata?.['role'] as UserRole) ||
        'customer';
      this.setRole(role);
      return { ...res, role };
    }

    return { ...res, role: null };
  }

  /**
   * Registro exclusivo para Clientes (Los administradores/barberos se crean en Supabase)
   */
  async signUpCustomer(email: string, password: string, fullName: string, phone?: string) {
    this.logger.info('SupabaseService', `Registrando nuevo cliente en Supabase: ${email}`);
    const res = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: 'customer',
          phone: phone || null,
        },
      },
    });

    if (res.error) {
      this.logger.error('SupabaseService', `Fallo al registrar cliente: ${res.error.message}`, {
        status: res.error.status,
        code: res.error.code,
        email,
      });
      return res;
    }

    if (res.data.user) {
      this.logger.info('SupabaseService', `Cliente registrado exitosamente`, {
        userId: res.data.user.id,
        email: res.data.user.email,
      });
      this.currentUser.set(res.data.user);
      this.setRole('customer');

      // Crear o asegurar fila inicial en profiles (inmune a duplicados y sincronizado con triggers)
      try {
        await this.supabase.from('profiles').upsert(
          {
            id: res.data.user.id,
            auth_user_id: res.data.user.id,
            full_name: fullName.trim(),
            role: 'customer',
            phone: phone ? phone.trim() : null,
            membership_tier: 'Bronze',
            is_active: true,
          },
          { onConflict: 'id', ignoreDuplicates: true }
        );
      } catch (err) {
        this.logger.warn('SupabaseService', 'Aviso al asegurar perfil en Supabase', err);
      }
    }

    return res;
  }

  /**
   * Carga quirúrgica del perfil del usuario (role, full_name, is_active)
   * Busca por auth_user_id (relación con auth.users) o por id directo
   */
  async loadUserProfile(userId: string): Promise<ProfileRow | null> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('id, full_name, role, phone, membership_tier, is_active, created_at, avatar_url, auth_user_id')
        .or(`auth_user_id.eq.${userId},id.eq.${userId}`)
        .maybeSingle();

      if (data && !error) {
        const profile = data as ProfileRow;
        this.userProfile.set(profile);
        this.setRole(profile.role);
        return profile;
      }
    } catch (err) {
      this.logger.warn('SupabaseService', 'Error cargando perfil de usuario', err);
    }

    // Fallback seguro con claims del JWT autenticado en Supabase
    const authUser = this.currentUser();
    const fallbackRole: UserRole =
      (authUser?.app_metadata?.['role'] as UserRole) ||
      (authUser?.user_metadata?.['role'] as UserRole) ||
      'customer';
    this.setRole(fallbackRole);
    return null;
  }

  /**
   * Fuerza la recarga del perfil del usuario autenticado desde Supabase.
   * Usado por el tab de Mi Perfil tras una edición exitosa.
   */
  async refreshUserProfile(): Promise<void> {
    const user = this.currentUser();
    if (user) {
      await this.loadUserProfile(user.id);
    }
  }

  /**
   * Establece el rol y lo persiste para recargas de PWA
   */
  setRole(role: UserRole): void {
    this.currentRole.set(role);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_ROLE, role);
      } catch {
        // Ignorar en entornos restringidos
      }
    }
  }

  /**
   * Cierre de sesión completo
   */
  async signOut(): Promise<void> {
    try {
      await this.supabase.auth.signOut();
    } catch (err) {
      this.logger.warn('SupabaseService', 'Error en signOut de Supabase', err);
    } finally {
      this.clearSessionState();
    }
  }

  private clearSessionState(): void {
    this.currentUser.set(null);
    this.userProfile.set(null);
    this.currentRole.set(null);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY_ROLE);
      } catch {
        // Ignorar
      }
    }
  }

  private getInitialRole(): UserRole | null {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_ROLE);
        if (saved === 'barber' || saved === 'customer' || saved === 'admin') {
          return saved;
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Verifica si las credenciales de Supabase están configuradas con valores válidos
   */
  isConfigured(): boolean {
    const url = environment.supabaseUrl;
    const key = environment.supabaseKey;
    return (
      Boolean(url && key) &&
      !url.includes('tu-proyecto') &&
      !key.includes('tu-anon-key')
    );
  }

  get isAuthenticated(): boolean {
    return !!this.currentUser() || !!this.currentRole();
  }
}
