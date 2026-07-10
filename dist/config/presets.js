import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const BUILT_IN_PRESETS = ['frontend', 'backend', 'mobile'];
export function defaultPresetDir() {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../../presets');
}
export function isBuiltInPreset(value) {
    return BUILT_IN_PRESETS.includes(value);
}
