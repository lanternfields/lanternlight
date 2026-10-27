import { describe, expect, it } from 'vitest';
import { detectDevice, initialQuality, maxQuality, preferredFrameRate } from '../src/core/device.js';

describe('device detection', () => {
  const ua = (model: string) => `Mozilla/5.0 (X11; Linux x86_64; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/40.0 Chrome/130 VR Safari/537.36`;
  it('recognises Quest models from the browser user agent', () => {
    expect(detectDevice(ua('Quest 3'))).toBe('Quest 3');
    expect(detectDevice(ua('Quest 3S'))).toBe('Quest 3S');
    expect(detectDevice(ua('Quest 2'))).toBe('Quest 2');
    expect(detectDevice(ua('Quest Pro'))).toBe('Quest Pro');
    expect(detectDevice('Mozilla/5.0 (Linux; Android 10; Quest) OculusBrowser/20.0')).toBe('Quest (1st gen)');
    expect(detectDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')).toBe('desktop');
  });
  it('older headsets start at lower quality', () => {
    expect(initialQuality('Quest (1st gen)')).toBe(0);
    expect(initialQuality('Quest 2')).toBe(1);
    expect(initialQuality('Quest 3')).toBe(3);
    expect(maxQuality('Quest 2')).toBe(2);
    expect(maxQuality('Quest (1st gen)')).toBe(1);
  });
  it('asks for 90 Hz only where there is headroom', () => {
    expect(preferredFrameRate('Quest 3', new Float32Array([72, 80, 90, 120]))).toBe(90);
    expect(preferredFrameRate('Quest 2', new Float32Array([72, 90]))).toBeNull();
    expect(preferredFrameRate('Quest 3', undefined)).toBeNull();
    expect(preferredFrameRate('desktop', [60])).toBeNull();
  });
});
