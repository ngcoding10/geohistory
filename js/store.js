// Preferences kept in this browser only. Keys start with "geohistory." (shared origin with the owner's other apps).
// A later "bookmarks and notes" feature would add the shared core.js with data prefix geo_; nothing here needs it yet.
const PREFIX = 'geohistory.';

export function getPref(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode or storage full: preferences are optional */
  }
}
