import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserRole } from '../models/barber.models';
import { SupabaseService } from '../services/supabase.service';

/**
 * Guardián de ruta reactivo para proteger vistas según autenticación y rol de Supabase
 */
export const authGuard = (allowedRoles?: UserRole[]): CanActivateFn => {
  return () => {
    const supabase = inject(SupabaseService);
    const router = inject(Router);

    // Si no está autenticado en Supabase ni tiene rol activo, va a /login
    if (!supabase.isAuthenticated) {
      return router.createUrlTree(['/login']);
    }

    const currentRole = supabase.currentRole();
    if (!currentRole) {
      return router.createUrlTree(['/login']);
    }

    // Validación de permisos por rol
    if (allowedRoles && allowedRoles.length > 0) {
      const hasPermission = allowedRoles.includes(currentRole) || currentRole === 'admin';
      if (!hasPermission) {
        // Redirige al panel que le corresponde
        return router.createUrlTree([currentRole === 'barber' ? '/barber' : '/customer']);
      }
    }

    return true;
  };
};
