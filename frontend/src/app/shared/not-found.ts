import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'fcar-not-found',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1>Página não encontrada</h1>
    <a routerLink="/">Voltar ao estoque</a>`,
})
export class NotFound {}
