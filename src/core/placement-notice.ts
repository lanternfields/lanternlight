/**
 * When the wall in front can't take the stage, the show goes on on the paper
 * scroll, and the viewer is told why, honestly, in a few words, and that
 * another wall would work ("A window is here. / Try another wall.").
 */
import { COPY } from './copy.js';

/** The notice for a placement's reason ('' when the stage is on a wall, or there is no wall at all). */
export function blockedNotice(kind: 'wall' | 'scroll', reason: string): string {
  if (kind !== 'scroll') return '';
  if (reason === 'wall-occluded') return COPY.NOTICE_BLOCKED_FURNITURE;
  if (reason === 'wall-too-small') return COPY.NOTICE_BLOCKED_SMALL;
  if (reason.startsWith('wall-covered')) {
    const labels = reason.includes(':') ? reason.slice(reason.indexOf(':') + 1).split(',') : [];
    if (labels.some((l) => l === 'window' || l === 'windowframe')) return COPY.NOTICE_BLOCKED_WINDOW;
    if (labels.some((l) => l === 'screen')) return COPY.NOTICE_BLOCKED_SCREEN;
    if (labels.some((l) => l === 'mirror')) return COPY.NOTICE_BLOCKED_MIRROR;
    if (labels.some((l) => l === 'shelf')) return COPY.NOTICE_BLOCKED_SHELF;
    return COPY.NOTICE_BLOCKED_BUSY;
  }
  return '';
}
