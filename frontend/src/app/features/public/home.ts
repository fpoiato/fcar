import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'fcar-home',
  imports: [CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <h1>Estoque</h1>
      <p>A vitrine está sendo preparada. Em breve, os carros disponíveis aparecem aqui.</p>
      <p class="hint" data-testid="locale-sample">A partir de {{ 4990000 / 100 | currency }}</p>
    </section>
  `,
  styles: `
    .hero {
      padding: 2rem 0;
    }
    .hint {
      color: var(--fcar-muted);
    }
  `,
})
export class Home {}
