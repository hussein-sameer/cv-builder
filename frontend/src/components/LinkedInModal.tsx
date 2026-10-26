import { Check, Copy, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useAI } from '../useAI'
import { AutoTextArea, Field } from './fields'
import { Modal, Spinner } from './ui'

const LIMITS = { headline: 220, about: 2600 }
const FOLD = 265 // roughly what LinkedIn shows of the About section before "See more"

const CHECKLIST = [
  'Custom profile URL based on your name, and the same job titles and dates as your CV.',
  'Open to Work (Recruiters only for a quiet search) with job preferences: titles, locations, start date.',
  'Location set to a major city, a precise industry, and public profile visibility on.',
  '20–50 skills that match your target postings; pin the top 3–5.',
  'A professional photo (at least 400 × 400 px) and 3–5 written recommendations that name the skills your next role needs.',
]

function CopyButton({ text }: { text: string }) {
  const { toast } = useStore()
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 2000)
    } catch {
      toast("Couldn't copy here. Select the text and press Ctrl+C.", 'info')
    }
  }
  return (
    <button type="button" className="btn ghost xs" onClick={copy} disabled={!text.trim()}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : 'Copy'}
    </button>
  )
}

/** LinkedIn headline and About drafted from the CV. Not saved: they live on LinkedIn once pasted. */
export function LinkedInModal() {
  const { linkedinOpen, openLinkedin, docId } = useStore()
  const ai = useAI()
  const [draft, setDraft] = useState({ headline: '', about: '', model: '' })
  useEffect(() => setDraft({ headline: '', about: '', model: '' }), [docId]) // another CV, another profile

  const write = async () => {
    const res = await ai.linkedin()
    if (res) setDraft({ headline: res.headline, about: res.about, model: res.model })
  }

  const counter = (key: keyof typeof LIMITS) => (
    <span className={`word-count ${draft[key].length > LIMITS[key] ? 'warn' : ''}`}>
      {draft[key].length.toLocaleString()} / {LIMITS[key].toLocaleString()}
    </span>
  )

  return (
    <Modal open={linkedinOpen} onClose={() => openLinkedin(false)} title="LinkedIn headline and About">
      <p className="lead">
        Recruiters search LinkedIn by keywords and job titles. The AI drafts both from your CV (and the target job, if set), using only facts already in it.
      </p>
      <div className="ai-bar">
        <button type="button" className="btn ai" onClick={write} disabled={ai.busy}>
          {ai.busy ? <Spinner /> : <Sparkles size={15} />} {draft.headline || draft.about ? 'Rewrite with AI' : 'Write with AI'}
        </button>
        {draft.model && <span className="muted small">{draft.model}</span>}
      </div>
      <Field label="Headline" hint="Job title + specialisation + top skills + location, with 3–5 keywords.">
        <AutoTextArea value={draft.headline} minRows={2} onChange={(headline) => setDraft({ ...draft, headline })} placeholder="Senior Network Engineer | FTTH access networks | Network automation with Python | Manchester" ariaLabel="Headline" />
      </Field>
      <div className="letter-meta">
        <CopyButton text={draft.headline} />
        {counter('headline')}
      </div>
      <Field label="About" hint={`First person. Keywords and who you are in the first 2–3 lines: only about ${FOLD} characters show before “See more”.`}>
        <AutoTextArea value={draft.about} minRows={8} onChange={(about) => setDraft({ ...draft, about })} placeholder="Who you are and the problem you solve…" className={ai.busy ? 'shimmer' : ''} ariaLabel="About" />
      </Field>
      <div className="letter-meta">
        <CopyButton text={draft.about} />
        {/\[[^\]]{0,40}\]/.test(draft.about) && <span className="hint-warn small">Fill in or delete the [placeholders].</span>}
        {counter('about')}
      </div>
      <details className="checklist">
        <summary>Profile checklist</summary>
        <ul>
          {CHECKLIST.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </details>
    </Modal>
  )
}
