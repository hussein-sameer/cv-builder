import { ChevronDown, ChevronRight, Crosshair, Globe, Plus, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { newSection } from '../defaults'
import { ADDABLE_ORDER, SECTION_TYPES } from '../sectionTypes'
import { useStore } from '../store'
import type { Personal, SectionType } from '../types'
import { AutoTextArea, Field, TextInput } from './fields'

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
            <TextInput type="tel" value={p.phone} onChange={set('phone')} placeholder="+964 770 000 0000" />
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
            <Field label="Date of birth (optional)" hint="Not recommended for UK/Ireland; still common in some EU countries.">
              <TextInput value={p.dateOfBirth} onChange={set('dateOfBirth')} placeholder="DD/MM/YYYY" />
            </Field>
          </div>
        )}
      </div>
    </section>
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
