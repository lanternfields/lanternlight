// Builds IWER 2.7's hand pose library (MIT, Meta Platforms; vendored in ./src)
// into JSON so tests can inject realistic captured hand skeletons into the
// IWER build pinned by IWSDK 1.0.1 (which ships only default/pinch/point).
import { libraryHandPoses } from './src/device/configs/hand/library.js';
import { relaxedHandPose } from './src/device/configs/hand/relaxed.js';
import { pinchHandPose } from './src/device/configs/hand/pinch.js';
const out = { relaxed: relaxedHandPose, pinchCaptured: pinchHandPose, ...libraryHandPoses };
process.stdout.write(JSON.stringify(out));
