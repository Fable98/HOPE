// User settings, kept in chrome.storage.local.

export const SETTINGS_KEY = 'hope.settings';
export const PROFILES = ['focus', 'reading', 'calm'];

export const DEFAULT_SETTINGS = {
  serverUrl: 'http://localhost:8787',
  accessCode: '',
  profile: 'focus',
  readAloud: false,
};

export function cleanSettings(raw = {}) {
  const out = { ...DEFAULT_SETTINGS };
  if (typeof raw.serverUrl === 'string') {
    try {
      const url = new URL(raw.serverUrl.trim());
      if (url.protocol === 'http:' || url.protocol === 'https:') out.serverUrl = url.origin + url.pathname.replace(/\/+$/, '');
    } catch {
      /* keep default */
    }
  }
  if (typeof raw.accessCode === 'string') out.accessCode = raw.accessCode.trim().slice(0, 200);
  if (PROFILES.includes(raw.profile)) out.profile = raw.profile;
  if (typeof raw.readAloud === 'boolean') out.readAloud = raw.readAloud;
  return out;
}

export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return cleanSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings) {
  const clean = cleanSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: clean });
  return clean;
}
