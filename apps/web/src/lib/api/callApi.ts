/** The one callApi the screens use: the real client wired to the real fetch, the crisis check and the online flag. Browser only. */
import { isCrisis } from '@/lib/crisis';
import { createCallApi } from './client';

export const callApi = createCallApi({
  fetchFn: (input, init) => fetch(input, init),
  isCrisis,
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
});
