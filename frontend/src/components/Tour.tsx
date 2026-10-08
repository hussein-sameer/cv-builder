import { X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { tourState } from '../storage'

interface Step {
  title: string
  body: string
  /** `data-tour` names to highlight, first visible wins; none = a centred card */
  targets?: string[]
  /** leave the step out when none of its targets is on screen (e.g. hidden on phones) */
  optional?: boolean
}

// Targets are `data-tour="…"` attributes in TopBar, CvSwitcher, App and EditorCards: keep them when refactoring.
const STEPS: Step[] = [
  {
    title: 'Welcome to CV Builder 👋',
    body: "Here's a one-minute tour of the main parts. You can skip it now and replay it any time from the ⋯ menu.",
  },
  {
    title: 'Your CV library',
    body: 'Keep a version for each kind of job (for example Software Engineer and DevOps). Duplicate one to tailor it for an application. Everything saves automatically.',
    targets: ['cvs'],
    optional: true,
  },
  {
    title: 'Two layouts',
    body: 'International suits most global, ATS-screened applications. EU / UK adds nationality, work permit and dates-first entries. Switch any time; your content stays the same.',
    targets: ['layout'],
  },
  {
    title: 'Already have a CV?',
    body: "Upload CV with AI turns your old PDF or Word CV into an editable one, so you don't start from scratch. It's also in the ⋯ menu.",
    targets: ['import', 'more'],
  },
  {
    title: 'Start with your details',
    body: 'Name, contact details and, for countries that expect one, a photo. The EU / UK extras (nationality, work permit, date of birth) are just below.',
    targets: ['personal'],
  },
  {
    title: 'Add the sections you need',
    body: 'Experience, education and skills to begin with, plus certifications, projects, languages and more. Rename, reorder or hide any section.',
    targets: ['add-section'],
  },
  {
    title: 'AI writing help',
    body: 'Set up AI here, then use “Generate with AI” for your summary and “Improve with AI” for each job’s bullet points. It only uses facts from your CV.',
    targets: ['ai'],
  },
  {
    title: 'Live preview',
    body: "This is the exact PDF you'll download, updated as you type. On a phone, tap Preview to see it.",
    targets: ['preview', 'preview-tab'],
  },
  {
    title: 'ATS check',
    body: 'Flags what trips up applicant tracking systems: missing dates, weak bullet openers, placeholders left to fill in. Click an issue to jump to it.',
    targets: ['ats'],
    optional: true,
  },
  {
    title: 'Download',
    body: 'Get your CV as DOCX or PDF. Both are ATS-safe: real text, standard headings and one column.',
    targets: ['download'],
  },
  {
    title: "You're all set",
    body: 'Replay this tour any time from the ⋯ menu → Show tutorial. Good luck with your applications!',
    targets: ['more'],
  },
]

function findTarget(names?: string[]): HTMLElement | null {
  for (const name of names ?? []) {
    const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`)
    const r = el?.getBoundingClientRect()
    if (el && r && r.width > 0 && r.height > 0) return el // display:none (e.g. the other mobile tab) measures 0
  }
  return null
}

/** Guided tour: shown once after sign-up, replayed from the ⋯ menu or the welcome card. */
export function Tour() {
  const { tourOpen } = useStore()
  // wait a frame so the editor can switch to the Edit tab on phones before targets are measured
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!tourOpen) return setReady(false)
    const raf = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(raf)
  }, [tourOpen])
  return tourOpen && ready ? <TourRun /> : null
}

const MARGIN = 12
const GAP = 14
const PAD = 6

function TourRun() {
  const { openTour } = useStore()
  const [steps] = useState(() => STEPS.filter((s) => !s.optional || findTarget(s.targets)))
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const step = steps[index]
  const last = index === steps.length - 1

  const close = useCallback(() => {
    tourState.set('done')
    openTour(false)
  }, [openTour])
  const next = useCallback(() => (last ? close() : setIndex((i) => i + 1)), [last, close])
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // bring the target into view and keep the highlight on it while things scroll or resize
  useLayoutEffect(() => {
    const el = findTarget(step.targets)
    if (el) {
      const r = el.getBoundingClientRect()
      // instant: a long smooth scroll would leave the highlight chasing the target; the ring itself still glides
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: r.height > window.innerHeight * 0.6 ? 'start' : 'center', behavior: 'instant' })
    }
    const update = () => setRect(findTarget(step.targets)?.getBoundingClientRect() ?? null)
    update()
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true) // the editor and preview scroll inside their own panels
    return () => {
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
    }
  }, [step])

  // place the card next to the highlight: below, above, right, left; centred without one; on phones at the
  // bottom, or at the top when the highlight is in the lower half of the screen
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = card.offsetWidth
    const h = card.offsetHeight
    const clampX = (x: number) => Math.min(Math.max(x, MARGIN), vw - w - MARGIN)
    const clampY = (y: number) => Math.min(Math.max(y, MARGIN), vh - h - MARGIN)
    if (vw <= 720) return setPos({ left: (vw - w) / 2, top: rect && rect.top > vh / 2 ? MARGIN : vh - h - MARGIN })
    if (!rect) return setPos({ left: (vw - w) / 2, top: (vh - h) / 2 })
    const cx = clampX(rect.left + rect.width / 2 - w / 2)
    if (rect.bottom + GAP + h <= vh - MARGIN) setPos({ left: cx, top: rect.bottom + GAP })
    else if (rect.top - GAP - h >= MARGIN) setPos({ left: cx, top: rect.top - GAP - h })
    else if (rect.right + GAP + w <= vw - MARGIN) setPos({ left: rect.right + GAP, top: clampY(rect.top) })
    else if (rect.left - GAP - w >= MARGIN) setPos({ left: rect.left - GAP - w, top: clampY(rect.top) })
    else setPos({ left: cx, top: vh - h - MARGIN })
  }, [rect, index])

  useEffect(() => nextRef.current?.focus({ preventScroll: true }), [index])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close, next, back])

  // the highlight, clipped to the window so a tall card doesn't push it off screen
  const spot = rect && {
    top: Math.max(rect.top - PAD, 4),
    left: Math.max(rect.left - PAD, 4),
    width: Math.min(rect.right + PAD, window.innerWidth - 4) - Math.max(rect.left - PAD, 4),
    height: Math.min(rect.bottom + PAD, window.innerHeight - 4) - Math.max(rect.top - PAD, 4),
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <div className={`tour-backdrop ${spot ? '' : 'dim'}`} />
      {spot && <div className="tour-spot" style={spot} />}
      <div ref={cardRef} className="tour-card" style={pos ?? { visibility: 'hidden' }}>
        <div className="tour-head">
          <span className="tour-count">
            {index + 1} of {steps.length}
          </span>
          <button type="button" className="icon-btn" aria-label="Close tutorial" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        <div className="tour-dots" aria-hidden>
          {steps.map((s, k) => (
            <span key={s.title} className={k === index ? 'on' : ''} />
          ))}
        </div>
        <div className="tour-foot">
          {index === 0 ? (
            <button type="button" className="btn ghost" onClick={close}>
              Skip tour
            </button>
          ) : (
            <button type="button" className="btn ghost" onClick={back}>
              Back
            </button>
          )}
          <button ref={nextRef} type="button" className="btn primary" onClick={next}>
            {index === 0 ? "Let's go" : last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
