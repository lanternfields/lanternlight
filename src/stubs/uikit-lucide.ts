/**
 * Build-time stand-in for @pmndrs/uikit-lucide. IWSDK's UIKitML interpreter
 * imports all ~1,600 lucide icons so that markup can name any of them;
 * Lanternlight has no UIKitML panels, so the production build keeps only the
 * two icons uikit-horizon imports by name (saves ~2.5 MB of bundle).
 * Lucide icons are ISC licensed (see README credits).
 */
export { CheckIcon } from '../../node_modules/@pmndrs/uikit-lucide/dist/Check.js';
export { ChevronDownIcon } from '../../node_modules/@pmndrs/uikit-lucide/dist/ChevronDown.js';
