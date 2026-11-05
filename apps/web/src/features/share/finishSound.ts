import type { Settings } from '@/features/shared/types';

/** The finish chime is opt-in: only an exact `true` plays it. */
export const shouldPlayFinishSound = (s: Settings): boolean => s.finishSound === true;
