import { describe, expect, it } from 'vitest';
import { blockedNotice } from '../src/core/placement-notice.js';
import { COPY } from '../src/core/copy.js';

describe('the honest notice when the wall in front cannot take the stage', () => {
  it('names what is in the way and suggests another wall', () => {
    expect(blockedNotice('scroll', 'wall-covered:window,window')).toBe(COPY.NOTICE_BLOCKED_WINDOW);
    expect(blockedNotice('scroll', 'wall-covered:windowframe')).toBe(COPY.NOTICE_BLOCKED_WINDOW);
    expect(blockedNotice('scroll', 'wall-covered:screen')).toBe(COPY.NOTICE_BLOCKED_SCREEN);
    expect(blockedNotice('scroll', 'wall-covered:mirror')).toBe(COPY.NOTICE_BLOCKED_MIRROR);
    expect(blockedNotice('scroll', 'wall-covered:shelf')).toBe(COPY.NOTICE_BLOCKED_SHELF);
    expect(blockedNotice('scroll', 'wall-covered:invisiblewallface')).toBe(COPY.NOTICE_BLOCKED_BUSY);
    expect(blockedNotice('scroll', 'wall-occluded')).toBe(COPY.NOTICE_BLOCKED_FURNITURE);
    expect(blockedNotice('scroll', 'wall-too-small')).toBe(COPY.NOTICE_BLOCKED_SMALL);
    for (const k of ['WINDOW', 'SCREEN', 'MIRROR', 'SHELF', 'BUSY', 'FURNITURE', 'SMALL'] as const) {
      expect(COPY[`NOTICE_BLOCKED_${k}`]).toMatch(/Try another wall\.$/);
    }
  });
  it('says nothing on a wall, with no room scan, or with no wall in front at all', () => {
    expect(blockedNotice('wall', 'wall')).toBe('');
    expect(blockedNotice('wall', 'wall-turn')).toBe('');
    expect(blockedNotice('scroll', 'no-planes')).toBe('');
    expect(blockedNotice('scroll', 'no-wall-in-front')).toBe('');
    expect(blockedNotice('scroll', 'wall-too-far')).toBe('');
  });
});
