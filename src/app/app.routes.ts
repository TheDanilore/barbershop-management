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
      import('./features/barber/barber-dashboard/barber-dashboard.page').then(
        (m) => m.BarberDashboardPage
      ),
    title: 'BarberTrack - Panel de Barbero',
  },
  {
    path: 'barber/:tab',
    canActivate: [authGuard(['barber', 'admin'])],
    loadComponent: () =>
      import('./features/barber/barber-dashboard/barber-dashboard.page').then(
        (m) => m.BarberDashboardPage
      ),
    title: 'BarberTrack - Panel de Barbero',
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
