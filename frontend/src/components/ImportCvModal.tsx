import { Check, Copy, ExternalLink, FileUp, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AI_IMPORT_PROMPT, parseCvText } from '../cvImport'
import { useStore } from '../store'
import { Modal, Spinner } from './ui'

const CHATS = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
  { name: 'Copilot', url: 'https://copilot.microsoft.com/' },
]
const STEPS = ['Attach your CV', 'Paste the instruction', 'Import the result']

/** "Upload CV with AI": an external AI chat turns an old PDF/Word CV into JSON, which we then import. */
export function ImportCvModal() {
  const { importOpen, openImport, importCV, storageMode, toast } = useStore()
  const [step, setStep] = useState(0)
  const [copied, setCopied] = useState<'yes' | 'manual' | null>(null)
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (importOpen) {
      setStep(0)
      setCopied(null)
      setPasted('')
      setError(null)
    }
  }, [importOpen])

  const close = () => openImport(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AI_IMPORT_PROMPT)
      setCopied('yes')
      setTimeout(() => setCopied((c) => (c === 'yes' ? null : c)), 2500)
    } catch {
      // clipboard API needs HTTPS (or localhost): select the text so Ctrl+C works
      promptRef.current?.focus()
      promptRef.current?.select()
      setCopied('manual')
    }
  }

  const finish = async (text: string) => {
    setError(null)
    let cv
    try {
      cv = parseCvText(text)
    } catch (e) {
      setError((e as Error).message)
      return
    }
    setBusy(true)
    const ok = await importCV(cv, cv.personal.headline || (cv.personal.fullName ? `${cv.personal.fullName} (imported)` : 'Imported CV'))
    setBusy(false)
    if (ok) {
      close()
      toast('Your CV was imported. Compare it with the original, especially the dates, before you send it.', 'success')
    }
  }

  const onFile = async (file: File) => {
    if (fileRef.current) fileRef.current.value = '' // let the same file be picked again
    await finish(await file.text())
  }

  return (
    <Modal
      open={importOpen}
      onClose={close}
      title="Upload CV with AI"
      footer={
        <>
          {step > 0 ? (
            <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : (
            <button type="button" className="btn ghost" onClick={close}>
              Cancel
            </button>
          )}
          {step < STEPS.length - 1 && (
            <button type="button" className="btn primary" onClick={() => setStep(step + 1)}>
              Next
            </button>
          )}
        </>
      }
    >
      <ol className="steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button type="button" className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)}>
              <span className="step-num">{i < step ? <Check size={12} /> : i + 1}</span>
              <span className="step-label">{label}</span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <>
          <p className="lead">
            Already have a CV as a PDF or Word file? An AI chat can read it and turn it into a file CV Builder imports, so you don't have to type it again.
          </p>
          <p>
            <strong>1.</strong> Open an AI chat that accepts file uploads, start a new chat and <strong>attach your CV file</strong>.
          </p>
          <div className="chat-links">
            {CHATS.map((c) => (
              <a key={c.name} className="btn sm" href={c.url} target="_blank" rel="noopener noreferrer">
                {c.name} <ExternalLink size={13} />
              </a>
            ))}
          </div>
          <p className="muted small">Can't attach files? Open your CV, select all the text, and paste it into the chat instead.</p>
          <p className="privacy">
            <ShieldCheck size={15} />
            <span>The AI provider receives your CV under its own privacy terms. CV Builder never sees the file, only the JSON you import in step 3.</span>
          </p>
        </>
      )}

      {step === 1 && (
        <>
          <p>
            <strong>2.</strong> Copy this instruction and <strong>send it in the same chat</strong>, with your CV attached.
          </p>
          <textarea ref={promptRef} className="input textarea prompt-box" readOnly rows={11} value={AI_IMPORT_PROMPT} aria-label="Instruction for the AI" onFocus={(e) => e.currentTarget.select()} />
          <div className="import-row">
            <button type="button" className="btn primary" onClick={() => void copy()}>
              {copied === 'yes' ? <Check size={15} /> : <Copy size={15} />} {copied === 'yes' ? 'Copied' : 'Copy instruction'}
            </button>
            {copied === 'manual' && <span className="muted small">Text selected: press Ctrl+C (⌘C on a Mac) to copy it.</span>}
          </div>
          <p className="muted small">The AI replies with a file called cv.json. Some chats show the JSON as text instead; that works too.</p>
        </>
      )}

      {step === 2 && (
        <>
          <p>
            <strong>3.</strong> Download <strong>cv.json</strong> from the chat and upload it here.{' '}
            {storageMode === 'server' ? 'It becomes a new CV in your library; your current CV stays as it is.' : 'It replaces the CV in this browser (Undo brings the old one back).'}
          </p>
          <div className="import-row">
            <button type="button" className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Spinner /> : <FileUp size={15} />} Upload JSON file
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json,text/plain,.txt" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          </div>
          <div className="field">
            <span className="field-label">Or paste the AI's JSON reply</span>
            <textarea className="input textarea prompt-box" rows={6} value={pasted} onChange={(e) => (setPasted(e.target.value), setError(null))} placeholder='{ "personal": { … }, "sections": [ … ] }' aria-label="JSON from the AI" />
          </div>
          <div className="import-row">
            <button type="button" className="btn" onClick={() => void finish(pasted)} disabled={busy || !pasted.trim()}>
              Import pasted JSON
            </button>
          </div>
          {error && <p className="status err">{error}</p>}
        </>
      )}
    </Modal>
  )
}
