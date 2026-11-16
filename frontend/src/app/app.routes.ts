import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/public/home').then((m) => m.Home),
    title: 'fcar — Estoque',
  },
  {
    path: 'conta',
    loadComponent: () => import('./features/account/account-home').then((m) => m.AccountHome),
    title: 'fcar — Minha conta',
  },
  {
    path: 'admin',
    loadComponent: () => import('./features/admin/admin-home').then((m) => m.AdminHome),
    title: 'fcar — Admin',
  },
  {
    path: '**',
    loadComponent: () => import('./shared/not-found').then((m) => m.NotFound),
    title: 'fcar — Página não encontrada',
  },
];
