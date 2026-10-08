import { AlertCircle, CheckCircle2, Compass, Eye, PencilLine, ShieldCheck, Sparkle, WandSparkles, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { atsCheck } from './atsCheck'
import { AiSettingsModal } from './components/AiSettingsModal'
import { AtsPanel } from './components/AtsPanel'
import { AddSection, PersonalCard, TargetCard } from './components/EditorCards'
import { ImportCvModal } from './components/ImportCvModal'
import { SectionCard } from './components/SectionCard'
import { TopBar } from './components/TopBar'
import { Tour } from './components/Tour'
import { exampleCV } from './defaults'
import { AuthGate, useSession } from './session'
import { tourState } from './storage'
import { StoreProvider, useStore } from './store'

// pdf.js is large – load it after the editor is interactive
const PdfPreview = lazy(() => import('./components/PdfPreview').then((m) => ({ default: m.PdfPreview })))

export default function App() {
  return (
    <AuthGate>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </AuthGate>
  )
}

function Shell() {
  const { cv, replaceCV, undo, toasts, dismissToast, storageMode, createDoc, docId, openImport, tourOpen, openTour } = useStore()
  const { authEnabled } = useSession()
  const [pages, setPages] = useState<number | null>(null)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [atsOpen, setAtsOpen] = useState(false)
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  const onPages = useCallback((n: number | null) => setPages(n), [])
  const issues = useMemo(() => atsCheck(cv, pages), [cv, pages])
  const errors = issues.filter((i) => i.level === 'error').length
  const warns = issues.filter((i) => i.level === 'warn').length

  const isBlank =
    !cv.personal.fullName && cv.sections.every((s) => !s.content.trim() && s.items.every((it) => !it.title && !it.tags.length))

  // Guided tour once after sign-up (or on first use without accounts), when the editor has loaded.
  useEffect(() => {
    if (storageMode === 'loading') return
    const state = tourState.get()
    if (state !== 'pending' && !(state === null && !authEnabled)) return
    const t = setTimeout(() => openTour(true), 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageMode])

  // the tour points at the editor, so show it on phones
  useEffect(() => {
    if (tourOpen) setTab('edit')
  }, [tourOpen])

  // Ctrl/Cmd+Z outside text fields = app-level undo (inside fields, the browser's own undo applies)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !el.closest('input, textarea, select')) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  const jump = (sectionId: string) => {
    setTab('edit')
    setTimeout(() => {
      const el = document.getElementById(`section-${sectionId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el?.classList.add('flash')
      setTimeout(() => el?.classList.remove('flash'), 1200)
    }, 50)
  }

  return (
    <div className="app">
      <TopBar />
      <nav className="mobile-tabs" aria-label="View">
        <button type="button" className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>
          <PencilLine size={15} /> Edit
        </button>
        <button type="button" className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')} data-tour="preview-tab">
          <Eye size={15} /> Preview {pages ? `· ${pages}p` : ''}
        </button>
      </nav>

      <main className={`workspace show-${tab}`}>
        <div className="editor">
          {storageMode === 'loading' && <div className="loading-cvs muted">Loading your CVs…</div>}
          {storageMode !== 'loading' && isBlank && !welcomeDismissed && (
            <div className="welcome">
              <div>
                <h2>Build an ATS-friendly CV</h2>
                <p>
                  Fill in the cards below — the preview on the right is the exact PDF you'll download. Add sections with <strong>Add section</strong>, reorder them with
                  the arrows, and use <strong>✨ Generate with AI</strong> to draft your summary. Already have a CV? <strong>Upload CV with AI</strong> fills it in
                  for you.
                </p>
                <div className="welcome-actions">
                  <button type="button" className="btn ai" onClick={() => openImport(true)} data-tour="import">
                    <WandSparkles size={15} /> Upload CV with AI
                  </button>
                  <button type="button" className="btn" onClick={() => (storageMode === 'server' ? void createDoc('example', 'Example CV') : replaceCV(exampleCV()))}>
                    <Sparkle size={15} /> Load example
                  </button>
                  <button type="button" className="btn ghost" onClick={() => openTour(true)}>
                    <Compass size={15} /> Take the tour
                  </button>
                </div>
              </div>
              <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setWelcomeDismissed(true)}>
                <X size={16} />
              </button>
            </div>
          )}
          {storageMode !== 'loading' && (
            <EditorBody key={docId ?? 'local'} />
          )}
        </div>

        <aside className="preview" data-tour="preview">
          <div className="preview-head">
            <span className="preview-title">Live preview</span>
            {pages !== null && <span className={`badge ${pages > 2 ? 'warn' : ''}`}>{pages} page{pages === 1 ? '' : 's'}</span>}
            <button type="button" className={`ats-toggle ${errors ? 'err' : warns ? 'warn' : 'ok'}`} onClick={() => setAtsOpen(!atsOpen)} aria-expanded={atsOpen} data-tour="ats">
              {errors || warns ? <AlertCircle size={15} /> : issues.length ? <ShieldCheck size={15} /> : <CheckCircle2 size={15} />}
              ATS check
              {issues.length > 0 && <span className="count">{issues.length}</span>}
            </button>
          </div>
          {atsOpen && <AtsPanel issues={issues} onJump={jump} />}
          <Suspense fallback={<div className="pdf-preview muted">Loading preview…</div>}>
            <PdfPreview cv={cv} onPages={onPages} />
          </Suspense>
        </aside>
      </main>

      <AiSettingsModal />
      <ImportCvModal />
      <Tour />

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Keyed by CV id so per-card UI state (collapsed cards, AI suggestions) resets when switching CVs. */
function EditorBody() {
  const { cv, storageMode } = useStore()
  return (
    <>
      <PersonalCard />
      <TargetCard />
      {cv.sections.map((s, i) => (
        <SectionCard key={s.id} section={s} index={i} count={cv.sections.length} />
      ))}
      <AddSection />
      <footer className="editor-foot muted small">
        {storageMode === 'server'
          ? 'Changes save automatically to your CV library. Switch or duplicate CVs from the menu at the top left.'
          : 'Saved in this browser only. Use ⋯ → Export JSON to back it up.'}
      </footer>
    </>
  )
}
