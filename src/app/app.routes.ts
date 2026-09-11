import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.page').then((m) => m.LoginPage),
    title: 'BarberTrack - Iniciar Sesión',
  },
  {
    path: 'barber',
    canActivate: [authGuard(['barber', 'admin'])],
    loadComponent: () =>
      import('./features/barber/barber-layout/barber-layout.page').then(
        (m) => m.BarberLayoutPage
      ),
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import(
            './features/barber/pages/barber-dashboard/barber-dashboard.page'
          ).then((m) => m.BarberDashboardPage),
        title: 'BarberTrack - Panel General',
      },
      {
        path: 'overview',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'appointments',
        loadComponent: () =>
          import(
            './features/barber/pages/barber-appointments/barber-appointments.page'
          ).then((m) => m.BarberAppointmentsPage),
        title: 'BarberTrack - Agenda & Turnos',
      },
      {
        path: 'clients',
        loadComponent: () =>
          import(
            './features/barber/pages/barber-clients/barber-clients.page'
          ).then((m) => m.BarberClientsPage),
        title: 'BarberTrack - Directorio de Clientes',
      },
      {
        path: 'services',
        loadComponent: () =>
          import(
            './features/barber/pages/barber-services/barber-services.page'
          ).then((m) => m.BarberServicesPage),
        title: 'BarberTrack - Catálogo de Servicios',
      },
      {
        path: 'loyalty',
        loadComponent: () =>
          import(
            './features/barber/pages/barber-loyalty/barber-loyalty.page'
          ).then((m) => m.BarberLoyaltyPage),
        title: 'BarberTrack - Fidelización & Recompensas',
      },
      {
        path: 'cash',
        loadComponent: () =>
          import('./features/barber/pages/barber-cash/barber-cash.page').then(
            (m) => m.BarberCashPage
          ),
        title: 'BarberTrack - Caja & Cuentas',
      },
      {
        path: 'stats',
        loadComponent: () =>
          import('./features/barber/pages/barber-stats/barber-stats.page').then(
            (m) => m.BarberStatsPage
          ),
        title: 'BarberTrack - Finanzas & Métricas',
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./features/barber/pages/barber-users/barber-users.page').then(
            (m) => m.BarberUsersPage
          ),
        title: 'BarberTrack - Gestión de Personal',
      },
      {
        path: 'profile',
        loadComponent: () =>
          import(
            './features/barber/pages/barber-profile/barber-profile.page'
          ).then((m) => m.BarberProfilePage),
        title: 'BarberTrack - Mi Perfil',
      },
      // Aliases para compatibilidad hacia atrás
      { path: 'inicio', redirectTo: 'overview', pathMatch: 'full' },
      { path: 'agenda', redirectTo: 'appointments', pathMatch: 'full' },
      { path: 'clientes', redirectTo: 'clients', pathMatch: 'full' },
      { path: 'servicios', redirectTo: 'services', pathMatch: 'full' },
      { path: 'fidelizacion', redirectTo: 'loyalty', pathMatch: 'full' },
      { path: 'caja', redirectTo: 'cash', pathMatch: 'full' },
      { path: 'cuentas', redirectTo: 'cash', pathMatch: 'full' },
      { path: 'finanzas', redirectTo: 'stats', pathMatch: 'full' },
      { path: 'usuarios', redirectTo: 'users', pathMatch: 'full' },
      { path: 'perfil', redirectTo: 'profile', pathMatch: 'full' },
    ],
  },
  {
    path: 'customer',
    canActivate: [authGuard(['customer'])],
    loadComponent: () =>
      import(
        './features/customer/customer-dashboard/customer-dashboard.page'
      ).then((m) => m.CustomerDashboardPage),
    title: 'BarberTrack - Experiencia Cliente',
  },
  {
    path: 'customer/:tab',
    canActivate: [authGuard(['customer'])],
    loadComponent: () =>
      import(
        './features/customer/customer-dashboard/customer-dashboard.page'
      ).then((m) => m.CustomerDashboardPage),
    title: 'BarberTrack - Experiencia Cliente',
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
