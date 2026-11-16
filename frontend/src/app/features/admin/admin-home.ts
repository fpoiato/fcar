import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'fcar-admin-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1>Admin</h1>
    <p>Em breve: gestão de estoque, agenda, reservas e atendimento.</p>`,
})
export class AdminHome {}
