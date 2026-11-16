import { describe, expect, it } from 'vitest';
import { buildConfig } from './app-config';

describe('buildConfig', () => {
  it('cada cor fala com a API da mesma cor', () => {
    expect(buildConfig('blue', '1').apiUrl).toBe('https://api-blue.fcar.fpoiato.com');
    expect(buildConfig('green', '1').wsUrl).toBe('wss://ws-green.fcar.fpoiato.com');
  });

  it('local usa os domínios principais', () => {
    expect(buildConfig(undefined, undefined)).toEqual({
      color: 'local',
      appVersion: 'dev',
      apiUrl: 'https://api.fcar.fpoiato.com',
      wsUrl: 'wss://ws.fcar.fpoiato.com',
    });
  });
});
