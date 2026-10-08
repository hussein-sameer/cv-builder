import { defaultAISettings, emptyCV, normalizeCV } from './defaults'
import type { AISettings, CV, ProviderType } from './types'

const BASE_KEYS = {
  cv: 'cvbuilder.cv.v1',
  ai: 'cvbuilder.ai.v1',
  aiKeys: 'cvbuilder.ai.keys.v1',
  lastDoc: 'cvbuilder.lastDoc',
}

// Everything kept in the browser is namespaced per signed-in user, so two people
// sharing a computer never see each other's draft or API keys.
let namespace = 'local'
export function setStorageUser(userId: string): void {
  namespace = userId
}
const key = (k: keyof typeof BASE_KEYS) => `${BASE_KEYS[k]}:${namespace}`

function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

function safeSet(store: Storage, key: string, value: string): boolean {
  try {
    store.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function loadCV(): CV {
  const raw = safeGet(localStorage, key('cv'))
  if (!raw) return emptyCV()
  try {
    return normalizeCV(JSON.parse(raw))
  } catch {
    return emptyCV()
  }
}

/** Local copy of the CV being edited: crash/offline backup, and the store when the server DB is unreachable. */
export function saveCV(cv: CV): boolean {
  return safeSet(localStorage, key('cv'), JSON.stringify(cv))
}

export function hasLocalCV(): boolean {
  return !!safeGet(localStorage, key('cv'))
}

export const lastDoc = {
  get: () => safeGet(localStorage, key('lastDoc')),
  set: (id: string) => safeSet(localStorage, key('lastDoc'), id),
}

/** Remove this user's local draft and session-only API keys (on log out / account deletion). */
export function clearUserLocalData(everything = false): void {
  try {
    localStorage.removeItem(key('cv'))
    sessionStorage.removeItem(key('aiKeys'))
    if (everything) {
      localStorage.removeItem(key('ai'))
      localStorage.removeItem(key('lastDoc'))
    }
  } catch {
    /* storage unavailable */
  }
}

/**
 * AI settings live in localStorage. API keys go to localStorage only when the
 * user ticks "Remember"; otherwise they're kept for this browser tab session.
 */
export function loadAISettings(): AISettings {
  const base = defaultAISettings()
  try {
    const raw = safeGet(localStorage, key('ai')) ?? safeGet(localStorage, BASE_KEYS.ai) // fall back to pre-account settings
    const saved = raw ? (JSON.parse(raw) as Partial<AISettings>) : {}
    const merged: AISettings = {
      ...base,
      ...saved,
      providers: { ...base.providers },
    }
    for (const t of Object.keys(base.providers) as ProviderType[]) {
      merged.providers[t] = { ...base.providers[t], ...(saved.providers?.[t] ?? {}) }
    }
    const sessionKeys = JSON.parse(safeGet(sessionStorage, key('aiKeys')) ?? '{}') as Record<string, string>
    for (const [t, key] of Object.entries(sessionKeys)) {
      if (key && merged.providers[t as ProviderType] && !merged.providers[t as ProviderType].apiKey) {
        merged.providers[t as ProviderType].apiKey = key
      }
    }
    return merged
  } catch {
    return base
  }
}

export function saveAISettings(s: AISettings): void {
  const persisted: AISettings = JSON.parse(JSON.stringify(s))
  const keys: Record<string, string> = {}
  if (!s.remember) {
    for (const t of Object.keys(persisted.providers) as ProviderType[]) {
      keys[t] = persisted.providers[t].apiKey
      persisted.providers[t].apiKey = ''
    }
  }
  safeSet(localStorage, key('ai'), JSON.stringify(persisted))
  safeSet(sessionStorage, key('aiKeys'), JSON.stringify(keys))
}
