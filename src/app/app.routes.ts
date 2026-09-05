import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'select-role',
    pathMatch: 'full',
  },
  {
    path: 'select-role',
    loadComponent: () =>
      import('./features/auth/role-selection/role-selection.page').then(
        (m) => m.RoleSelectionPage
      ),
    title: 'BarberTrack - Selección de Rol',
  },
  {
    path: 'barber',
    loadComponent: () =>
      import('./features/barber/barber-dashboard/barber-dashboard.page').then(
        (m) => m.BarberDashboardPage
      ),
    title: 'BarberTrack - Panel de Barbero',
  },
  {
    path: 'customer',
    loadComponent: () =>
      import(
        './features/customer/customer-dashboard/customer-dashboard.page'
      ).then((m) => m.CustomerDashboardPage),
    title: 'BarberTrack - Experiencia Cliente',
  },
  {
    path: '**',
    redirectTo: 'select-role',
  },
];
