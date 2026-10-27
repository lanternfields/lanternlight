/**
 * Lanternlight asset catalog.
 *
 * Every visual and sound in Lanternlight is generated at runtime (procedural
 * geometry, shaders and WebAudio synthesis), so the shared catalog is empty.
 * This module must stay deterministic and side-effect free: IWSDK evaluates it
 * in two JS realms (runtime and editor).
 */
import { defineAssets } from '@iwsdk/core';

export default defineAssets({});
