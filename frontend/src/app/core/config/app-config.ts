import { InjectionToken } from '@angular/core';

/**
 * Valores injetados no build com `ng build --define`:
 * - FCAR_COLOR: cor do bucket que receberá o build (`blue`/`green`); `local` no dev server
 * - FCAR_APP_VERSION: versão/commit do app
 * O frontend de uma cor sempre fala com a API da mesma cor (blue/green consistente).
 */
declare const FCAR_COLOR: string | undefined;
declare const FCAR_APP_VERSION: string | undefined;

export type AppColor = 'blue' | 'green' | 'local';

export interface AppConfig {
  color: AppColor;
  appVersion: string;
  apiUrl: string;
  wsUrl: string;
}

export function buildConfig(color?: string, appVersion?: string): AppConfig {
  const c: AppColor = color === 'blue' || color === 'green' ? color : 'local';
  const suffix = c === 'local' ? '' : `-${c}`;
  return {
    color: c,
    appVersion: appVersion || 'dev',
    apiUrl: `https://api${suffix}.fcar.fpoiato.com`,
    wsUrl: `wss://ws${suffix}.fcar.fpoiato.com`,
  };
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG', {
  providedIn: 'root',
  factory: () =>
    buildConfig(
      typeof FCAR_COLOR === 'undefined' ? undefined : FCAR_COLOR,
      typeof FCAR_APP_VERSION === 'undefined' ? undefined : FCAR_APP_VERSION,
    ),
});
