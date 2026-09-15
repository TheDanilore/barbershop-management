import { Injectable, computed, inject, signal } from '@angular/core';
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

  // Signals reactivos resilientes que garantizan la identidad del usuario en cualquier vista
  public readonly userDisplayName = computed(() => {
    const profile = this.userProfile();
    const profileName = profile?.full_name?.trim();
    if (
      profileName &&
      profileName !== 'Usuario del Sistema' &&
      profileName !== 'Usuario Autorizado' &&
      profileName !== 'Cliente Nuevo'
    ) {
      return profileName;
    }

    const user = this.currentUser();
    const metaName = (user?.user_metadata?.['full_name'] || user?.user_metadata?.['name'])?.trim();
    if (metaName) {
      return metaName;
    }

    const email = user?.email;
    if (email) {
      const prefix = email.split('@')[0];
      return prefix.charAt(0).toUpperCase() + prefix.slice(1);
    }

    const role = this.currentRole() || profile?.role;
    if (role === 'admin') return 'Administrador BarberTrack';
    if (role === 'barber') return 'Barbero BarberTrack';
    if (role === 'customer') return 'Cliente BarberTrack';
    return 'Administrador';
  });

  public readonly userDisplayEmail = computed(() => {
    const user = this.currentUser();
    if (user?.email) return user.email;
    const phone = this.userProfile()?.phone;
    if (phone) return phone;
    return 'Sin correo registrado';
  });

  public readonly userDisplayRole = computed(() => {
    return this.userProfile()?.role || this.currentRole() || 'admin';
  });

  public readonly userInitial = computed(() => {
    const name = this.userDisplayName();
    return (name ? name.charAt(0) : 'A').toUpperCase();
  });

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
  private sessionReadyPromise: Promise<void> | null = null;

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
   * Garantiza que la sesión de Supabase almacenada localmente (localStorage)
   * se haya resuelto y cargado en memoria antes de evaluar guardianes de rutas en arranques en frío (F5).
   */
  async ensureSessionReady(): Promise<void> {
    if (this.sessionReadyPromise) {
      return this.sessionReadyPromise;
    }

    this.sessionReadyPromise = (async () => {
      try {
        const { data, error } = await this.supabase.auth.getSession();
        if (!error && data?.session?.user) {
          const user = data.session.user;
          this.currentUser.set(user);
          await this.loadUserProfile(user.id);
        }
      } catch (err) {
        this.logger.warn('SupabaseService', 'Error al verificar sesión persistente inicial', err);
      }
    })();

    return this.sessionReadyPromise;
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
      // 1. Consulta con las columnas básicas garantizadas para que NUNCA falle por columnas opcionales no migradas
      const { data, error } = await this.supabase
        .from('profiles')
        .select('id, full_name, role, phone, membership_tier, is_active, created_at, avatar_url, auth_user_id')
        .or(`auth_user_id.eq.${userId},id.eq.${userId}`)
        .maybeSingle();

      if (data && !error) {
        const profile = data as ProfileRow;
        const authUser = this.currentUser();
        // Si el full_name en base de datos está vacío o es un placeholder genérico, enriquecerlo con datos de auth
        if (
          (!profile.full_name ||
            profile.full_name.trim() === '' ||
            profile.full_name === 'Usuario del Sistema' ||
            profile.full_name === 'Usuario Autorizado' ||
            profile.full_name === 'Cliente Nuevo') &&
          authUser
        ) {
          const enrichedName =
            authUser.user_metadata?.['full_name'] ||
            authUser.user_metadata?.['name'] ||
            (authUser.email ? authUser.email.split('@')[0] : 'Administrador BarberTrack');
          profile.full_name = enrichedName;
        }

        this.userProfile.set(profile);
        this.setRole(profile.role);
        return profile;
      }
    } catch (err) {
      this.logger.warn('SupabaseService', 'Error cargando perfil de usuario desde Supabase', err);
    }

    // 2. Fallback resiliente con datos de Supabase Auth (JWT / Metadatos)
    const authUser = this.currentUser();
    if (authUser) {
      const fallbackName =
        authUser.user_metadata?.['full_name'] ||
        authUser.user_metadata?.['name'] ||
        (authUser.email ? authUser.email.split('@')[0] : 'Administrador BarberTrack');

      const fallbackRole: UserRole =
        (authUser.app_metadata?.['role'] as UserRole) ||
        (authUser.user_metadata?.['role'] as UserRole) ||
        this.currentRole() ||
        'admin';

      const synthesizedProfile: ProfileRow = {
        id: userId,
        auth_user_id: userId,
        full_name: fallbackName,
        role: fallbackRole,
        phone: authUser.user_metadata?.['phone'] || null,
        membership_tier: 'Bronze',
        is_active: true,
        created_at: authUser.created_at || new Date().toISOString(),
        avatar_url: authUser.user_metadata?.['avatar_url'] || null,
      };

      this.userProfile.set(synthesizedProfile);
      this.setRole(fallbackRole);

      // Auto-reparación no bloqueante en Supabase para asegurar que exista la fila
      try {
        await this.supabase.from('profiles').upsert(
          {
            id: userId,
            auth_user_id: userId,
            full_name: fallbackName,
            role: fallbackRole,
            phone: authUser.user_metadata?.['phone'] || null,
            membership_tier: 'Bronze',
            is_active: true,
          },
          { onConflict: 'id', ignoreDuplicates: true }
        );
      } catch {
        // Silencioso
      }

      return synthesizedProfile;
    }

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
   * Actualiza los datos del perfil del usuario autenticado (nombre, teléfono, notas de estilo).
   * Implementa validación estricta y sincronización inmediata con Supabase.
   */
  async updateUserProfile(payload: {
    fullName: string;
    phone?: string | null;
    notes?: string | null;
  }): Promise<{ success: boolean; error?: string }> {
    const profile = this.userProfile();
    const user = this.currentUser();
    const targetId = profile?.id || user?.id;

    if (!targetId) {
      return { success: false, error: 'No se identificó una sesión activa para actualizar el perfil.' };
    }

    if (!this.isConfigured()) {
      // Modo local / fallback
      if (profile) {
        this.userProfile.set({
          ...profile,
          full_name: payload.fullName.trim(),
          phone: payload.phone ? payload.phone.trim() : null,
          notes: payload.notes !== undefined ? (payload.notes?.trim() || null) : profile.notes,
        });
      }
      return { success: true };
    }

    try {
      const updateData: Record<string, any> = {
        full_name: payload.fullName.trim(),
        phone: payload.phone !== undefined ? (payload.phone?.trim() || null) : undefined,
      };

      // Limpiar undefined
      Object.keys(updateData).forEach(
        (key) => updateData[key] === undefined && delete updateData[key]
      );

      let updateError: any = null;

      if (payload.notes !== undefined) {
        const withNotes = { ...updateData, notes: payload.notes?.trim() || null };
        const res = await this.supabase
          .from('profiles')
          .update(withNotes)
          .eq('id', targetId);

        if (res.error && (res.error.code === '42703' || res.error.message?.includes('notes'))) {
          // Si notes no existe en la base remota, actualizar sin notes
          const retry = await this.supabase
            .from('profiles')
            .update(updateData)
            .eq('id', targetId);
          updateError = retry.error;
        } else {
          updateError = res.error;
        }
      } else {
        const res = await this.supabase
          .from('profiles')
          .update(updateData)
          .eq('id', targetId);
        updateError = res.error;
      }

      if (updateError) {
        this.logger.error('SupabaseService', 'Error al actualizar perfil en Supabase', updateError);
        return { success: false, error: updateError.message || 'Error al actualizar perfil en la base de datos' };
      }

      await this.refreshUserProfile();
      return { success: true };
    } catch (err: any) {
      this.logger.error('SupabaseService', 'Excepción al actualizar perfil', err);
      return { success: false, error: err?.message || 'Error inesperado al guardar los datos del perfil' };
    }
  }

  /**
   * Modifica la contraseña del usuario con verificación obligatoria de contraseña previa (Zero-Trust).
   * Previene secuestro de cuentas en terminales compartidas o sesiones abiertas.
   */
  async changePasswordWithVerification(
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    const user = this.currentUser();
    if (!user?.email) {
      return { success: false, error: 'No se encontró una sesión activa con correo electrónico.' };
    }

    if (!this.isConfigured()) {
      return { success: true };
    }

    try {
      // 1. Re-autenticación defensiva criptográfica con credencial actual
      const verifyRes = await this.supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (verifyRes.error) {
        this.logger.warn('SupabaseService', 'Fallo de re-autenticación para cambio de contraseña', verifyRes.error);
        return {
          success: false,
          error: 'La contraseña actual no coincide. Por seguridad, no se modificaron tus credenciales.',
        };
      }

      // 2. Actualización segura en Supabase Auth
      const { error: updateError } = await this.supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        this.logger.error('SupabaseService', 'Error al actualizar contraseña en Auth', updateError);
        return {
          success: false,
          error: updateError.message || 'No fue posible actualizar la contraseña.',
        };
      }

      this.logger.info('SupabaseService', 'Contraseña actualizada exitosamente con re-autenticación');
      return { success: true };
    } catch (err: any) {
      this.logger.error('SupabaseService', 'Excepción en changePasswordWithVerification', err);
      return {
        success: false,
        error: err?.message || 'Error inesperado durante el cambio de contraseña.',
      };
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
   * Cierre de sesión completo garantizado contra rebotes en el login
   */
  async signOut(): Promise<void> {
    // 1. Limpieza síncrona inmediata de estado reactivo y almacenamiento local
    this.clearSessionState();
    try {
      await this.supabase.auth.signOut();
    } catch (err) {
      this.logger.warn('SupabaseService', 'Error en signOut de Supabase', err);
    }
    // 2. Segunda pasada para garantizar que ningún callback tardío restablezca tokens
    this.clearSessionState();
  }

  private clearSessionState(): void {
    this.sessionReadyPromise = Promise.resolve();
    this.currentUser.set(null);
    this.userProfile.set(null);
    this.currentRole.set(null);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY_ROLE);
        localStorage.removeItem('barbertrack_user_role');
        localStorage.removeItem('supabase_user_role');
        localStorage.removeItem('barbertrack_role');
        localStorage.removeItem('barbertrack_current_client_id');
        // Purgar inmediatamente todos los tokens de auth de Supabase
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (
            key &&
            (key.startsWith('sb-') ||
              key.includes('auth-token') ||
              key.includes('supabase.auth') ||
              key.startsWith('supabase.'))
          ) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
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
