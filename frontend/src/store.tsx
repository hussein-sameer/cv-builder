import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import { emptyCV, exampleCV, normalizeCV } from './defaults'
import { hasLocalAISettings, hasLocalCV, lastDoc, loadAISettings, loadCV, saveAISettings, saveCV } from './storage'
import type { AIConfig, AISettings, CV, CvMeta, Item, ProviderInfo, ProviderSettings, ProviderType, SavedKey, Section, TemplateInfo } from './types'

export type Toast = { id: number; kind: 'info' | 'success' | 'error'; text: string }
export type SaveState = 'saved' | 'saving' | 'error'

interface Store {
  cv: CV
  mutate: (fn: (draft: CV) => void) => void
  replaceCV: (cv: CV) => void
  undo: () => void
  canUndo: boolean
  saveState: SaveState
  // CV library
  storageMode: 'loading' | 'server' | 'local'
  library: CvMeta[]
  docId: string | null
  docName: string
  openDoc: (id: string) => Promise<void>
  createDoc: (how: 'blank' | 'duplicate' | 'example' | { data: CV }, name: string) => Promise<string | null>
  renameDoc: (id: string, name: string) => Promise<void>
  deleteDoc: (id: string) => Promise<void>
  saveNow: () => Promise<void>
  templates: TemplateInfo[]
  headingFor: (s: Section) => string
  ai: AISettings
  setAI: (s: AISettings) => void
  aiConfig: AIConfig | null
  savedKeys: SavedKey[]
  setSavedKeys: (keys: SavedKey[]) => void
  aiReady: boolean
  aiModalOpen: boolean
  openAISettings: (open?: boolean) => void
  toasts: Toast[]
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
}

const Ctx = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside provider')
  return s
}

export function findSection(cv: CV, id: string): Section {
  const s = cv.sections.find((x) => x.id === id)
  if (!s) throw new Error(`section ${id} not found`)
  return s
}

export function findItem(cv: CV, sectionId: string, itemId: string): Item {
  const it = findSection(cv, sectionId).items.find((x) => x.id === itemId)
  if (!it) throw new Error(`item ${itemId} not found`)
  return it
}

export function moveInArray<T>(arr: T[], index: number, delta: number): void {
  const to = index + delta
  if (to < 0 || to >= arr.length) return
  const [x] = arr.splice(index, 1)
  arr.splice(to, 0, x)
}

const HISTORY_LIMIT = 50
export const CLOUD_HOSTS = /api\.openai\.com|openrouter\.ai|api\.groq\.com|api\.deepseek\.com|api\.mistral\.ai|api\.together\.xyz/

/** The endpoint a provider config will call (blank = server default), normalised like the server does. */
export function effectiveBaseUrl(p: ProviderSettings, info?: ProviderInfo): string {
  const strip = (u: string) => u.trim().replace(/\/+$/, '')
  return strip(p.baseUrl) || strip(info?.defaultBaseUrl ?? '')
}

/** The account key the server will use for this provider, if one is saved for exactly this endpoint. */
export function savedKeyFor(keys: SavedKey[], type: ProviderType, p: ProviderSettings, info?: ProviderInfo): SavedKey | undefined {
  const base = effectiveBaseUrl(p, info)
  return base ? keys.find((k) => k.provider === type && k.baseUrl === base) : undefined
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [cv, setCv] = useState<CV>(loadCV)
  const cvRef = useRef(cv)
  const historyRef = useRef<CV[]>([])
  const [historyLen, setHistoryLen] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [storageMode, setStorageMode] = useState<'loading' | 'server' | 'local'>('loading')
  const [library, setLibrary] = useState<CvMeta[]>([])
  const [docId, setDocId] = useState<string | null>(null)
  const docIdRef = useRef<string | null>(null)
  const [docName, setDocName] = useState('')
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [ai, setAIState] = useState<AISettings>(loadAISettings)
  const [aiConfig, setAIConfig] = useState<AIConfig | null>(null)
  const [savedKeys, setSavedKeys] = useState<SavedKey[]>([])
  const [aiModalOpen, setAIModalOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const lastSnapshot = useRef<number>(0)
  // the CV object last loaded from / written to the server – no need to save it again
  const persistedRef = useRef<CV | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveErrorShown = useRef(false)

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000)
  }, [])

  const upsertMeta = (meta: CvMeta) =>
    setLibrary((lib) => [meta, ...lib.filter((m) => m.id !== meta.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))

  /** Write the current CV to the server now (used by autosave and before switching docs). */
  const flushSave = useCallback(async (keepalive = false) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const id = docIdRef.current
    const current = cvRef.current
    if (!id || current === persistedRef.current) return
    setSaveState('saving')
    try {
      const meta = await api.updateCV(id, { data: current }, keepalive)
      persistedRef.current = current
      saveErrorShown.current = false
      if (docIdRef.current === id) setSaveState(cvRef.current === current ? 'saved' : 'saving')
      upsertMeta(meta)
    } catch (e) {
      setSaveState('error')
      if (!saveErrorShown.current) {
        saveErrorShown.current = true
        toast(`Couldn't save to the server (${(e as Error).message}). A copy is kept in this browser; retrying on your next edit.`, 'error')
      }
    }
  }, [toast])

  const loadIntoEditor = (id: string, name: string, data: CV) => {
    const next = normalizeCV(data)
    docIdRef.current = id
    setDocId(id)
    setDocName(name)
    persistedRef.current = next
    cvRef.current = next
    setCv(next)
    historyRef.current = []
    setHistoryLen(0)
    lastSnapshot.current = 0
    setSaveState('saved')
    lastDoc.set(id)
  }
  // Boot: load the library from the server; migrate a pre-library local draft on first run.
  useEffect(() => {
    api.meta().then((m) => setTemplates(m.templates)).catch(() => undefined)
    void Promise.allSettled([api.aiConfig(), api.aiKeys()]).then(([cfgRes, keysRes]) => {
      const cfg = cfgRes.status === 'fulfilled' ? cfgRes.value : null
      const keys = keysRes.status === 'fulfilled' ? keysRes.value : []
      if (cfg) setAIConfig(cfg)
      setSavedKeys(keys)
      // New device or browser: start from the most recently saved account key instead of blank settings.
      // Only for the default or a preset endpoint, so a key planted for some other URL (e.g. via a stolen
      // session) can't silently redirect this user's CV text. Not persisted until the user saves AI settings.
      if (!hasLocalAISettings() && cfg) {
        const blank = { baseUrl: '', apiKey: '', model: '', temperature: null }
        const known = (k: SavedKey) => {
          const info = cfg.providers.find((p) => p.type === k.provider)
          if (!info) return null
          if (effectiveBaseUrl(blank, info) === k.baseUrl) return ''
          return info.presets.some((x) => effectiveBaseUrl({ ...blank, baseUrl: x.baseUrl }) === k.baseUrl) ? k.baseUrl : null
        }
        const k = [...keys].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).find((x) => known(x) !== null)
        if (k) {
          const baseUrl = known(k) ?? ''
          setAIState((s) => ({ ...s, active: k.provider, providers: { ...s.providers, [k.provider]: { ...s.providers[k.provider], baseUrl } } }))
        }
      }
    })
    let cancelled = false
    ;(async () => {
      try {
        let list = await api.listCVs()
        if (!list.length) {
          const seed = hasLocalCV() ? loadCV() : emptyCV()
          const created = await api.createCV(seed.personal.headline || 'My CV', { data: seed })
          list = [created]
        }
        if (cancelled) return
        const wanted = list.find((m) => m.id === lastDoc.get()) ?? list[0]
        const full = await api.getCV(wanted.id)
        if (cancelled) return
        setLibrary(list)
        loadIntoEditor(full.id, full.name, full.data)
        setStorageMode('server')
      } catch (e) {
        if (cancelled || (e instanceof ApiError && e.status === 401)) return // login screen takes over
        setStorageMode('local')
        toast('Server storage is unavailable — this CV is saved in your browser only.', 'error')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave: local backup immediately-ish, server write debounced.
  useEffect(() => {
    const t = setTimeout(() => saveCV(cv), 300)
    if (storageMode === 'server' && cv !== persistedRef.current) {
      setSaveState('saving')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void flushSave(), 900)
    }
    return () => clearTimeout(t)
  }, [cv, storageMode, flushSave])

  // Don't lose the last keystrokes when the tab closes.
  useEffect(() => {
    const onHide = () => void flushSave(true)
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [flushSave])

  const openDoc = useCallback(
    async (id: string) => {
      if (id === docIdRef.current) return
      await flushSave()
      try {
        const full = await api.getCV(id)
        loadIntoEditor(full.id, full.name, full.data)
      } catch (e) {
        toast((e as Error).message, 'error')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flushSave, toast],
  )

  const createDoc = useCallback(
    async (how: 'blank' | 'duplicate' | 'example' | { data: CV }, name: string) => {
      await flushSave()
      try {
        const src =
          how === 'duplicate' && docIdRef.current
            ? { sourceId: docIdRef.current }
            : { data: how === 'blank' ? emptyCV() : how === 'example' ? exampleCV() : typeof how === 'object' ? how.data : emptyCV() }
        const rec = await api.createCV(name, src)
        upsertMeta(rec)
        loadIntoEditor(rec.id, rec.name, rec.data)
        return rec.id
      } catch (e) {
        toast((e as Error).message, 'error')
        return null
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flushSave, toast],
  )

  const renameDoc = useCallback(
    async (id: string, name: string) => {
      try {
        const meta = await api.updateCV(id, { name })
        upsertMeta(meta)
        if (id === docIdRef.current) setDocName(meta.name)
      } catch (e) {
        toast((e as Error).message, 'error')
      }
    },
    [toast],
  )

  const deleteDoc = useCallback(
    async (id: string) => {
      try {
        await api.deleteCV(id)
        const rest = library.filter((m) => m.id !== id)
        setLibrary(rest)
        if (id === docIdRef.current) {
          docIdRef.current = null
          if (rest.length) await openDoc(rest[0].id)
          else await createDoc('blank', 'My CV')
        }
      } catch (e) {
        toast((e as Error).message, 'error')
      }
    },
    [library, openDoc, createDoc, toast],
  )

  const pushHistory = (prev: CV) => {
    historyRef.current = [...historyRef.current.slice(-HISTORY_LIMIT + 1), prev]
    setHistoryLen(historyRef.current.length)
  }

  const commit = (next: CV) => {
    cvRef.current = next
    setCv(next)
  }

  const mutate = useCallback((fn: (draft: CV) => void) => {
    const prev = cvRef.current
    // group rapid keystrokes into one undo step
    const now = Date.now()
    if (now - lastSnapshot.current > 1200) pushHistory(prev)
    lastSnapshot.current = now
    const next = structuredClone(prev)
    fn(next)
    commit(next)
  }, [])

  const replaceCV = useCallback((next: CV) => {
    pushHistory(cvRef.current)
    lastSnapshot.current = 0
    commit(next)
  }, [])

  const undo = useCallback(() => {
    const h = historyRef.current
    if (!h.length) return
    historyRef.current = h.slice(0, -1)
    setHistoryLen(historyRef.current.length)
    lastSnapshot.current = 0
    commit(h[h.length - 1])
  }, [])

  const setAI = useCallback((s: AISettings) => {
    setAIState(s)
    saveAISettings(s)
  }, [])

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const headingFor = useCallback(
    (s: Section) => {
      const tpl = templates.find((t) => t.key === cv.design.template)
      return s.title.trim() || tpl?.headings[s.type] || s.type
    },
    [templates, cv.design.template],
  )

  const active = ai.providers[ai.active]
  const info = aiConfig?.providers.find((p) => p.type === ai.active)
  const hasModel = !!(active.model || info?.defaultModel)
  const selfHosted = ai.active === 'ollama' || (ai.active === 'openai' && !!active.baseUrl && !CLOUD_HOSTS.test(active.baseUrl))
  const aiReady = hasModel && (selfHosted || !!active.apiKey || !!savedKeyFor(savedKeys, ai.active, active, info) || !!info?.serverKey)

  const value = useMemo<Store>(
    () => ({
      cv,
      mutate,
      replaceCV,
      undo,
      canUndo: historyLen > 0,
      saveState,
      storageMode,
      library,
      docId,
      docName,
      openDoc,
      createDoc,
      renameDoc,
      deleteDoc,
      saveNow: () => flushSave(),
      templates,
      headingFor,
      ai,
      setAI,
      aiConfig,
      savedKeys,
      setSavedKeys,
      aiReady,
      aiModalOpen,
      openAISettings: (open = true) => setAIModalOpen(open),
      toasts,
      toast,
      dismissToast,
    }),
    [cv, mutate, replaceCV, undo, historyLen, saveState, storageMode, library, docId, docName, openDoc, createDoc, renameDoc, deleteDoc, flushSave, templates, headingFor, ai, setAI, aiConfig, savedKeys, aiReady, aiModalOpen, toasts, toast, dismissToast],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
