/**
 * Component catalog shared by the runtime and the IWSDK editor.
 * Lanternlight keeps its state in plain TypeScript modules (see src/core), so
 * only small tag components are declared here.
 */
import { defineComponents } from '@iwsdk/core';
import { StageAnchor } from './stage-components.js';

export default defineComponents([StageAnchor]);
