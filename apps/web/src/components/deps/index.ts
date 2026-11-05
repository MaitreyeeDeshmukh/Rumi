/**
 * The ONE place the UI imports other lanes' code from.
 * Right now every export is a temporary stand-in (files in this folder), because lane/harness,
 * lane/features and lane/memory had not merged when lane/ui started.
 * When a lane merges, replace its line with a re-export from the real module, e.g.
 *   export { useRumi, RumiProvider } from '@/features/state';
 *   export { callApi } from '@/lib/api/client';
 * then delete the stand-in file.
 */
export { useRumi, RumiProvider, STORAGE_KEY } from './state';
export { callApi } from './api';
export { useMemoryControls } from './memory';
export { DEMO_PLAN, SAMPLE_VISIT, SAVED_RECAP_REPLY } from './fixtures';
export {
  isCrisis, SUPPORT_PRESETS, newSupportCard, addCustomItem, buildSupportCardText, syncPersona,
  FOCUS_LABEL, itemsForFocus, summarizeSession, startLevelFor, buildShareText, buildKitText, shouldPlayFinishSound,
} from './builders';
export type { ShareKey, SessionSummary } from './builders';
