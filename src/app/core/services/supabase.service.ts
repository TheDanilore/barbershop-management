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

  // Signal reactivo para el usuario autenticado
  public readonly usuarioActual = signal<User | null>(null);

  // Signal reactivo para el rol del usuario actual ('barber' | 'customer' | 'admin')
  public readonly currentRole = signal<UserRole | null>(this.getInitialRole());

  // Signal reactivo para el perfil del usuario actual
  public readonly userProfile = signal<ProfileRow | null>(null);

  // Signal para estado de conexión/red
  public readonly isOnline = signal<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Signal de estado de conexión activa y latencia hacia Supabase
  public readonly connectionStatus = signal<SupabaseConnectionStatus>('checking');
  public readonly latencyMs = signal<number | null>(null);

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });

    // Escuchar cambios de sesión de forma reactiva
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user ?? null;
      this.usuarioActual.set(user);
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

    // Monitorear conectividad de red para PWA
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
    this.checkHealth();
  }

  /**
   * Ping activo a Supabase para verificar conexión en tiempo real y medir latencia
   */
  async checkHealth(): Promise<void> {
    if (!this.isOnline()) {
      this.connectionStatus.set('offline');
      return;
    }

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
      this.usuarioActual.set(res.data.user);
      const profile = await this.loadUserProfile(res.data.user.id);
      const role = profile?.role || (res.data.user.user_metadata?.['role'] as UserRole) || 'customer';
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
      this.usuarioActual.set(res.data.user);
      this.setRole('customer');
    }

    return res;
  }

  /**
   * Carga quirúrgica del perfil del usuario (role, full_name, is_active)
   */
  async loadUserProfile(userId: string): Promise<ProfileRow | null> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('id, full_name, role, phone, membership_tier, is_active, created_at, avatar_url, auth_user_id')
        .eq('id', userId)
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

    // Fallback con metadata de auth
    const authUser = this.usuarioActual();
    const fallbackRole = (authUser?.user_metadata?.['role'] as UserRole) || 'customer';
    this.setRole(fallbackRole);
    return null;
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
    this.usuarioActual.set(null);
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

  get estaAutenticado(): boolean {
    return !!this.usuarioActual() || !!this.currentRole();
  }
}
