import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILT_IN_PRESETS = ['frontend', 'backend', 'mobile'] as const;

export type BuiltInPreset = (typeof BUILT_IN_PRESETS)[number];

export function defaultPresetDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../presets');
}

export function isBuiltInPreset(value: string): value is BuiltInPreset {
  return (BUILT_IN_PRESETS as readonly string[]).includes(value);
}
