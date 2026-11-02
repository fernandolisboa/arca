import { describe, expect, it } from 'vitest';
import { createWebCapabilities, type Capability } from '../src/index.js';

const all: readonly Capability[] = [
  'documentCapture',
  'keyStorage',
  'biometricUnlock',
  'notifications',
  'receiveSharedFiles',
  'deepLinks',
];

describe('web capabilities', () => {
  it.each(all)('reports %s as unavailable', (capability) => {
    expect(createWebCapabilities().has(capability)).toBe(false);
  });
});
