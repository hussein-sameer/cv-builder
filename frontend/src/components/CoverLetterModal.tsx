import { Check, Copy, FileDown, FileText, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { api, fileName } from '../api'
import { useStore } from '../store'
import { useAI } from '../useAI'
import { AutoTextArea, Field, TextInput } from './fields'
import { Modal, Spinner } from './ui'

const PLACEHOLDER = /\[[^\]]{0,40}\]/

/** Cover letter for the target job: written with AI or by hand, saved with the CV, exported with the CV's header. */
export function CoverLetterModal() {
  const { cv, mutate, letterOpen, openLetter, toast } = useStore()
  const ai = useAI()
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState<'pdf' | 'docx' | null>(null)
  const [copied, setCopied] = useState(false)
  const t = cv.target
  const words = t.coverLetter.trim() ? t.coverLetter.trim().split(/\s+/).length : 0
  const hasJob = !!(t.role.trim() || t.jobDescription.trim())

  const write = async () => {
    const res = await ai.letter({ instructions })
    if (res) mutate((d) => void (d.target.coverLetter = res.text))
  }

  const download = async (format: 'pdf' | 'docx') => {
    setBusy(format)
    try {
      await api.download(cv, format, fileName(cv, format, 'Cover_Letter'), 'letter')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(t.coverLetter)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast("Couldn't copy here. Select the text and press Ctrl+C.", 'info')
    }
  }

  return (
    <Modal
      open={letterOpen}
      onClose={() => openLetter(false)}
      title="Cover letter"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={copy} disabled={!t.coverLetter.trim()}>
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy text'}
          </button>
          <button type="button" className="btn" onClick={() => download('docx')} disabled={!t.coverLetter.trim() || !!busy}>
            {busy === 'docx' ? <Spinner /> : <FileText size={15} />} DOCX
          </button>
          <button type="button" className="btn primary" onClick={() => download('pdf')} disabled={!t.coverLetter.trim() || !!busy}>
            {busy === 'pdf' ? <Spinner /> : <FileDown size={15} />} PDF
          </button>
        </>
      }
    >
      <p className="lead">
        Three short paragraphs: why this role at this company, the experience and 1–2 results that prove you can do it, and an invitation to talk. It's saved with this CV
        and downloads with the same header.
      </p>
      {!hasJob && <p className="hint-warn small">Add a target role or job description first (in the Target job card), so the letter is about a real job.</p>}
      <Field label="Recipient (optional)" hint="One per line: hiring manager or team, company, address. Printed above the letter.">
        <AutoTextArea value={t.recipient} minRows={2} onChange={(v) => mutate((d) => void (d.target.recipient = v))} placeholder={'Hiring Team\nCompany name\nStreet, City'} />
      </Field>
      <div className="ai-bar">
        <button type="button" className="btn ai" onClick={write} disabled={ai.busy || !hasJob}>
          {ai.busy ? <Spinner /> : <Sparkles size={15} />} {t.coverLetter.trim() ? 'Rewrite with AI' : 'Write with AI'}
        </button>
        <div className="grow">
          <TextInput value={instructions} onChange={setInstructions} placeholder="Extra instructions, e.g. mention I can start in March" ariaLabel="Extra instructions" />
        </div>
      </div>
      <Field label="Letter">
        <AutoTextArea
          value={t.coverLetter}
          minRows={12}
          onChange={(v) => mutate((d) => void (d.target.coverLetter = v))}
          placeholder={'Dear Hiring Manager,\n\nWhy this role at this company…\n\nWhat you have done that proves you can do it…\n\nAn invitation to talk.\n\nKind regards,\nYour name'}
          className={ai.busy ? 'shimmer' : ''}
          ariaLabel="Cover letter"
        />
      </Field>
      <div className="letter-meta">
        {PLACEHOLDER.test(t.coverLetter) && <span className="hint-warn small">Fill in or delete the [placeholders] before you send it.</span>}
        <span className={`word-count ${words > 400 ? 'warn' : ''}`}>{words} words · aim for 250–350</span>
      </div>
    </Modal>
  )
}
