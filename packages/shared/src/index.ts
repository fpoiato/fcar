export const APP_NAME = 'fcar';

export type DeployColor = 'blue' | 'green';

export function isDeployColor(value: unknown): value is DeployColor {
  return value === 'blue' || value === 'green';
}
