import { Injectable, inject, signal } from '@angular/core';
import { SupabaseClient, User, createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  private readonly logger = inject(LoggerService);

  // Cliente oficial de Supabase
  public readonly supabase: SupabaseClient;

  // Signal reactivo para el usuario autenticado
  public readonly usuarioActual = signal<User | null>(null);

  // Signal para estado de conexión/configuración
  public readonly isOnline = signal<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });

    // Escuchar cambios de sesión de forma reactiva
    this.supabase.auth.onAuthStateChange((event, session) => {
      this.usuarioActual.set(session?.user ?? null);
      this.logger.info('SupabaseService', `Auth state changed: ${event}`, {
        userId: session?.user?.id,
      });
    });

    // Monitorear conectividad de red para PWA
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline.set(true);
        this.logger.info('SupabaseService', 'Red restablecida (online)');
      });
      window.addEventListener('offline', () => {
        this.isOnline.set(false);
        this.logger.warn('SupabaseService', 'Conexión a internet perdida (offline)');
      });
    }
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
    return !!this.usuarioActual();
  }
}
