// The only Firebase code in GeoHistory, loaded on demand: when a reader opens "Suggest something we missed",
// and on admin.html. The map never loads it. It uses the shared core (js/core.js, copied unchanged from the
// backend) for App Check, sign-in and function calls. Backend: github.com/ngcoding10/backend-combination
// (functions/src/geo.js, firestore.rules, tests).
import { firebaseConfig, appCheckSiteKey } from './config.js';
import { createCore, loadSdkFromCdn, wantsEmulator } from './core.js';

/** Local testing only: localhost + ?emulator in the address talks to the Firebase emulators. */
export const emulator = wantsEmulator('geohistory');

let core = null, loading = null;

/** Load the Firebase SDK and the shared core once. */
export function loadCloud() {
  if (core) return Promise.resolve(core);
  if (!loading) {
    loading = (async () => {
      const c = createCore({ appName: 'geohistory', sdk: await loadSdkFromCdn(), config: firebaseConfig, appCheckSiteKey, emulator, offlineCache: false });
      if (emulator) window.__emuSignIn = (email, name) => c.emulatorSignIn(email, name).then((u) => u.uid);
      core = c;
      return c;
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}
export const getCore = () => core;

/** Send a reader's suggestion (no sign-in). Resolves { ok: true }. */
export async function sendSuggestion(payload) {
  const c = await loadCloud();
  return c.call('geoSuggest', payload, { timeout: 30_000 });
}

/** The owner's admin calls: list / update / delete (the server checks the uid against its allow-list). */
export async function adminCall(data) {
  const c = await loadCloud();
  return c.call('geoAdminSuggestions', data, { timeout: 60_000 });
}
