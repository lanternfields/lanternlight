/**
 * Device detection for Meta headsets (Quest Browser user agents) and the
 * starting quality level per device generation.
 */
/** Which headset we are on (from the Quest Browser user agent). */
export function detectDevice(ua: string): string {
  if (/Quest 3S/i.test(ua)) return 'Quest 3S';
  if (/Quest 3/i.test(ua)) return 'Quest 3';
  if (/Quest Pro/i.test(ua)) return 'Quest Pro';
  if (/Quest 2/i.test(ua)) return 'Quest 2';
  if (/Quest/i.test(ua)) return 'Quest (1st gen)';
  if (/OculusBrowser/i.test(ua)) return 'Meta headset';
  return 'desktop';
}

/** Starting quality: older headsets start lower so the first seconds are smooth. */
export function initialQuality(device: string): number {
  if (device === 'Quest (1st gen)') return 0;
  if (device === 'Quest 2' || device === 'Meta headset') return 1;
  return 2;
}
