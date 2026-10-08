import { ChevronDown, ChevronRight, Crosshair, Globe, ImageUp, Plus, Trash2, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { newSection } from '../defaults'
import { photoFromFile } from '../photo'
import { ADDABLE_ORDER, SECTION_TYPES } from '../sectionTypes'
import { useStore } from '../store'
import type { Personal, SectionType } from '../types'
import { AutoTextArea, Field, TextInput } from './fields'
import { PhoneInput } from './PhoneInput'
import { Spinner } from './ui'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function PersonalCard() {
  const { cv, mutate } = useStore()
  const p = cv.personal
  const [showEU, setShowEU] = useState(cv.design.template === 'europass')
  useEffect(() => {
    if (cv.design.template === 'europass') setShowEU(true)
  }, [cv.design.template])
  const set = (k: keyof Personal) => (v: string) => mutate((d) => void (d.personal[k] = v))

  return (
    <section className="card" id="section-personal">
      <header className="card-head static">
        <span className="section-icon">
          <UserRound size={16} />
        </span>
        <h3>Personal details</h3>
      </header>
      <div className="card-body">
        <div className="grid">
          <Field label="Full name">
            <TextInput value={p.fullName} onChange={set('fullName')} placeholder="Alex Morgan" autoFocus={!p.fullName} />
          </Field>
          <Field label="Headline / target title">
            <TextInput value={p.headline} onChange={set('headline')} placeholder="Senior Network Engineer" />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={p.email} onChange={set('email')} placeholder="name@example.com" />
          </Field>
          <Field label="Phone">
            <PhoneInput value={p.phone} onChange={set('phone')} />
          </Field>
          <Field label="Location">
            <TextInput value={p.location} onChange={set('location')} placeholder="Baghdad, Iraq" />
          </Field>
          <Field label="LinkedIn">
            <TextInput value={p.linkedin} onChange={set('linkedin')} placeholder="linkedin.com/in/yourname" />
          </Field>
          <Field label="GitHub / portfolio">
            <TextInput value={p.github} onChange={set('github')} placeholder="github.com/yourname" />
          </Field>
          <Field label="Website (optional)">
            <TextInput value={p.website} onChange={set('website')} placeholder="yourname.dev" />
          </Field>
          <PhotoField />
        </div>
        <button type="button" className="disclosure" onClick={() => setShowEU(!showEU)} aria-expanded={showEU}>
          {showEU ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <Globe size={14} /> EU / UK personal details
          <span className="muted small"> — shown only in the EU layout</span>
        </button>
        {showEU && (
          <div className="grid">
            <Field label="Work permit / relocation" span={2}>
              <TextInput value={p.workPermit} onChange={set('workPermit')} placeholder="e.g. Requires visa sponsorship · Open to relocation to Germany" />
            </Field>
            <Field label="Nationality">
              <TextInput value={p.nationality} onChange={set('nationality')} placeholder="Iraqi" />
            </Field>
            <Field label="Driving licence">
              <TextInput value={p.drivingLicence} onChange={set('drivingLicence')} placeholder="B" />
            </Field>
            <Field
              label="Date of birth (optional)"
              hint={
                p.dateOfBirth && !ISO_DAY.test(p.dateOfBirth)
                  ? `Saved as “${p.dateOfBirth}”. Pick the date to replace it.`
                  : 'Printed as DD/MM/YYYY. Not recommended for UK/Ireland; still common in some EU countries.'
              }
            >
              <input
                className="input"
                type="date"
                value={ISO_DAY.test(p.dateOfBirth) ? p.dateOfBirth : ''}
                min="1900-01-01"
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => set('dateOfBirth')(e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>
    </section>
  )
}

/** Optional photo: printed top right in both layouts; cropped to passport shape before it's stored. */
function PhotoField() {
  const { cv, mutate, toast } = useStore()
  const photo = cv.personal.photo
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const upload = async (file: File) => {
    if (fileRef.current) fileRef.current.value = '' // let the same file be picked again
    setBusy(true)
    try {
      const url = await photoFromFile(file)
      mutate((d) => void (d.personal.photo = url))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field span-2">
      <span className="field-label">Photo (optional)</span>
      <div className="photo-field">
        <div className="photo-thumb">{photo ? <img src={photo} alt="Your CV photo" /> : <UserRound size={28} aria-hidden />}</div>
        <div className="photo-actions">
          <div className="input-with-btn">
            <button type="button" className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Spinner /> : <ImageUp size={14} />} {photo ? 'Change photo' : 'Upload photo'}
            </button>
            {photo && (
              <button type="button" className="btn sm ghost" onClick={() => mutate((d) => void (d.personal.photo = ''))}>
                <Trash2 size={14} /> Remove
              </button>
            )}
          </div>
          <span className="field-hint">
            Printed at the top right of the CV, cropped to passport shape: use a head-and-shoulders photo. Expected in some countries (e.g. Germany, Austria,
            Switzerland, much of the Middle East and Asia); leave it out for the UK, Ireland, the US and Canada.
          </span>
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      </div>
    </div>
  )
}

export function TargetCard() {
  const { cv, mutate } = useStore()
  const [open, setOpen] = useState(!!(cv.target.role || cv.target.jobDescription))
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const handler = () => {
      setOpen(true)
      setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        ref.current?.querySelector('input')?.focus()
      }, 50)
    }
    window.addEventListener('cv:open-target', handler)
    return () => window.removeEventListener('cv:open-target', handler)
  }, [])

  return (
    <section className="card target-card" id="target-card" ref={ref}>
      <header className="card-head clickable" onClick={() => setOpen(!open)}>
        <button type="button" className="icon-btn" aria-label={open ? 'Collapse' : 'Expand'}>
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <span className="section-icon accent">
          <Crosshair size={16} />
        </span>
        <h3>Target job</h3>
        <span className="muted small head-note">{cv.target.role ? cv.target.role : 'optional · used by AI to tailor wording'}</span>
      </header>
      {open && (
        <div className="card-body">
          <div className="grid">
            <Field label="Target role" span={2}>
              <TextInput value={cv.target.role} onChange={(v) => mutate((d) => void (d.target.role = v))} placeholder="e.g. Network Automation Engineer" />
            </Field>
            <Field label="Job description" span={2} hint="Paste the posting. The AI mirrors its keywords only where your CV supports them. Not printed on the CV.">
              <AutoTextArea value={cv.target.jobDescription} minRows={4} onChange={(v) => mutate((d) => void (d.target.jobDescription = v))} placeholder="Paste the job ad here…" />
            </Field>
          </div>
        </div>
      )}
    </section>
  )
}

export function AddSection() {
  const { cv, mutate } = useStore()
  const [open, setOpen] = useState(false)
  const present = new Set(cv.sections.map((s) => s.type))

  const add = (type: SectionType) => {
    const s = newSection(type)
    mutate((d) => void d.sections.push(s))
    setOpen(false)
    setTimeout(() => {
      const el = document.getElementById(`section-${s.id}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      ;(el?.querySelector('.card-body input, .card-body textarea') as HTMLElement | null)?.focus({ preventScroll: true })
    }, 60)
  }

  return (
    <div className="add-section">
      <button type="button" className="btn primary block" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Plus size={16} /> Add section
      </button>
      {open && (
        <div className="section-picker" role="menu">
          {ADDABLE_ORDER.map((t) => {
            const def = SECTION_TYPES[t]
            const Icon = def.icon
            const used = present.has(t) && !def.multiple
            return (
              <button type="button" role="menuitem" key={t} className="picker-item" disabled={used} onClick={() => add(t)} title={used ? 'Already added' : def.description}>
                <span className="section-icon">
                  <Icon size={16} />
                </span>
                <span>
                  <strong>{def.label}</strong>
                  <small>{used ? 'Already in your CV' : def.description}</small>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
