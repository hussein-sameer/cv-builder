import { Check, ChevronDown, CloudOff, Copy, FilePlus2, Files, Pencil, Sparkle, TriangleAlert, WandSparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { CvMeta } from '../types'
import { ConfirmDelete, Popover, Spinner } from './ui'

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString()
}

/** Dropdown to switch between saved CVs (e.g. "Software Engineer", "DevOps") and create tailored copies. */
export function CvSwitcher() {
  const { storageMode, library, docId, docName, openDoc, createDoc, renameDoc, deleteDoc, saveState, openImport } = useStore()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (storageMode === 'local') {
    return (
      <span className="save-state warn" title="The server database is unreachable. Your CV is saved in this browser; export JSON to back it up.">
        <CloudOff size={12} /> Browser only
      </span>
    )
  }

  const create = async (how: 'blank' | 'duplicate' | 'example') => {
    setBusy(true)
    const name = how === 'duplicate' ? `${docName} (copy)` : how === 'example' ? 'Example CV' : 'New CV'
    const id = await createDoc(how, name)
    setBusy(false)
    if (id) setEditing(id) // let the user name the new version right away
  }

  return (
    <div className="popover-anchor cv-switcher">
      <button type="button" className="switcher-btn" data-popover-trigger onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Your CVs" disabled={storageMode === 'loading'}>
        <Files size={15} />
        <span className="switcher-name">{storageMode === 'loading' ? 'Loading…' : docName || 'Untitled CV'}</span>
        <ChevronDown size={14} />
      </button>
      <SaveIndicator state={saveState} />
      <Popover open={open} onClose={() => (setOpen(false), setEditing(null))} align="left" className="switcher-pop">
        <div className="switcher-head">
          <strong>Your CVs</strong>
          <span className="muted small">{library.length} saved</span>
        </div>
        <ul className="cv-list">
          {library.map((m) => (
            <CvRow
              key={m.id}
              meta={m}
              active={m.id === docId}
              editing={editing === m.id}
              onOpen={async () => {
                await openDoc(m.id)
                setOpen(false)
              }}
              onEdit={() => setEditing(m.id)}
              onRename={async (name) => {
                setEditing(null)
                if (name.trim() && name.trim() !== m.name) await renameDoc(m.id, name.trim())
              }}
              onCancel={() => setEditing(null)}
              onDelete={() => deleteDoc(m.id)}
            />
          ))}
        </ul>
        <div className="switcher-actions">
          <button type="button" className="btn sm primary" onClick={() => create('duplicate')} disabled={busy} title="Copy this CV to tailor it for another role">
            {busy ? <Spinner /> : <Copy size={14} />} Duplicate to tailor
          </button>
          <button type="button" className="btn sm" onClick={() => create('blank')} disabled={busy}>
            <FilePlus2 size={14} /> New blank
          </button>
          <button type="button" className="btn sm ghost" onClick={() => create('example')} disabled={busy}>
            <Sparkle size={14} /> Example
          </button>
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => {
              setOpen(false)
              openImport(true)
            }}
            disabled={busy}
          >
            <WandSparkles size={14} /> Upload CV with AI
          </button>
        </div>
        <p className="muted small">Tip: duplicate your main CV for each role (e.g. Software, DevOps), then set its Target job so the AI tailors the summary and bullets.</p>
      </Popover>
    </div>
  )
}

function CvRow(props: {
  meta: CvMeta
  active: boolean
  editing: boolean
  onOpen: () => void
  onEdit: () => void
  onRename: (name: string) => void
  onCancel: () => void
  onDelete: () => void
}) {
  const { meta, active, editing } = props
  const [name, setName] = useState(meta.name)
  const ref = useRef<HTMLInputElement>(null)
  const submitted = useRef(false)
  const submit = () => {
    if (submitted.current) return
    submitted.current = true
    props.onRename(name)
  }
  useEffect(() => {
    if (editing) {
      submitted.current = false
      setName(meta.name)
      setTimeout(() => ref.current?.select(), 0)
    }
  }, [editing, meta.name])

  const sub = [meta.targetRole || meta.headline, meta.template === 'europass' ? 'EU' : 'Intl', ago(meta.updatedAt)].filter(Boolean).join(' · ')

  return (
    <li className={`cv-row ${active ? 'active' : ''}`}>
      {editing ? (
        <form
          className="cv-rename"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            ref={ref}
            className="input"
            value={name}
            aria-label="CV name"
            maxLength={120}
            placeholder="e.g. DevOps Engineer"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}
            onBlur={submit}
          />
          <button type="submit" className="icon-btn" aria-label="Save name">
            <Check size={15} />
          </button>
        </form>
      ) : (
        <>
          <button type="button" className="cv-open" onClick={props.onOpen}>
            <span className="cv-name">
              {meta.name}
              {active && <span className="badge">editing</span>}
            </span>
            <span className="cv-sub">{sub}</span>
          </button>
          <div className="cv-row-actions">
            <button type="button" className="icon-btn" aria-label={`Rename ${meta.name}`} title="Rename" onClick={props.onEdit}>
              <Pencil size={14} />
            </button>
            <ConfirmDelete onConfirm={props.onDelete} title={`Delete ${meta.name}`} size={14} />
          </div>
        </>
      )}
    </li>
  )
}

function SaveIndicator({ state }: { state: 'saved' | 'saving' | 'error' }) {
  if (state === 'error')
    return (
      <span className="save-state err" title="Last save failed — kept in this browser, will retry">
        <TriangleAlert size={12} /> Not saved
      </span>
    )
  return (
    <span className={`save-state ${state === 'saved' ? 'ok' : ''}`} title="Changes are saved automatically">
      {state === 'saved' ? <Check size={12} /> : <Spinner size={10} />} {state === 'saved' ? 'Saved' : 'Saving'}
    </span>
  )
}
