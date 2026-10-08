import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Eye, EyeOff, Lightbulb, Plus, SlidersHorizontal, Sparkles, Undo2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { emptyItem } from '../defaults'
import { SECTION_TYPES } from '../sectionTypes'
import { findSection, moveInArray, useStore } from '../store'
import type { GenerateOptions, Section } from '../types'
import { useAI } from '../useAI'
import { AutoTextArea, Field, TextInput } from './fields'
import { ItemCard, RowItem } from './ItemCard'
import { ConfirmDelete, Popover, Spinner } from './ui'

export function SectionCard({ section, index, count }: { section: Section; index: number; count: number }) {
  const { mutate, headingFor } = useStore()
  const def = SECTION_TYPES[section.type]
  const Icon = def.icon
  const [collapsed, setCollapsed] = useState(false)
  // explicit open/closed per entry; entries without a choice use the default (new/empty or only entry = open)
  const [itemOpen, setItemOpen] = useState<Record<string, boolean>>({})
  const hasEntries = (def.kind === 'entries' || def.kind === 'lines') && section.items.length > 0
  // default is decided once per entry (so typing a title into a new entry doesn't collapse it)
  const defaults = useRef<Record<string, boolean>>({})
  const isOpen = (id: string, title: string) => itemOpen[id] ?? (defaults.current[id] ??= !title || section.items.length === 1)
  const anyOpen = !collapsed && section.items.some((it) => isOpen(it.id, it.title))
  const setAll = (open: boolean) => {
    if (open) setCollapsed(false)
    setItemOpen(Object.fromEntries(section.items.map((it) => [it.id, open])))
  }
  const heading = headingFor({ ...section, title: '' })

  const set = (patch: Partial<Section>) => mutate((d) => Object.assign(findSection(d, section.id), patch))
  const move = (delta: number) => mutate((d) => moveInArray(d.sections, d.sections.findIndex((s) => s.id === section.id), delta))
  const remove = () => mutate((d) => void (d.sections = d.sections.filter((s) => s.id !== section.id)))
  const addItem = () =>
    mutate((d) => findSection(d, section.id).items.push(emptyItem(def.kind === 'entries' && section.type !== 'education' ? { bullets: [''] } : {})))

  return (
    <section className={`card section-card ${section.visible ? '' : 'hidden-section'}`} id={`section-${section.id}`}>
      <header className="card-head">
        <button type="button" className="icon-btn" aria-label={collapsed ? 'Expand section' : 'Collapse section'} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
        </button>
        <span className="section-icon">
          <Icon size={16} />
        </span>
        <input
          className="title-input"
          value={section.title}
          placeholder={heading}
          aria-label="Section heading"
          title="Click to rename this section's heading"
          onChange={(e) => set({ title: e.target.value })}
        />
        {!section.visible && <span className="badge">Hidden</span>}
        <div className="card-actions">
          {hasEntries && (
            <button
              type="button"
              className="btn ghost xs collapse-all"
              title={anyOpen ? 'Collapse all entries in this section' : 'Expand all entries in this section'}
              aria-label={anyOpen ? 'Collapse all' : 'Expand all'}
              onClick={() => setAll(!anyOpen)}
            >
              {anyOpen ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
              <span className="hide-sm">{anyOpen ? 'Collapse all' : 'Expand all'}</span>
            </button>
          )}
          <button type="button" className="icon-btn" title="Move section up" aria-label="Move section up" disabled={index === 0} onClick={() => move(-1)}>
            <ArrowUp size={16} />
          </button>
          <button type="button" className="icon-btn" title="Move section down" aria-label="Move section down" disabled={index === count - 1} onClick={() => move(1)}>
            <ArrowDown size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={section.visible ? 'Hide from CV' : 'Show in CV'}
            aria-label={section.visible ? 'Hide section' : 'Show section'}
            onClick={() => set({ visible: !section.visible })}
          >
            {section.visible ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          <ConfirmDelete onConfirm={remove} title="Delete section" />
        </div>
      </header>

      {!collapsed && (
        <div className="card-body">
          {def.tip && (
            <p className="tip">
              <Lightbulb size={14} /> {def.tip}
            </p>
          )}

          {def.kind === 'text' &&
            (section.type === 'summary' ? (
              <SummaryEditor section={section} onChange={(content) => set({ content })} />
            ) : (
              <AutoTextArea value={section.content} placeholder={def.textPlaceholder ?? 'Write here…'} minRows={3} onChange={(content) => set({ content })} ariaLabel={heading} />
            ))}

          {(def.kind === 'entries' || def.kind === 'lines') &&
            section.items.map((it, i) => (
              <ItemCard
                key={it.id}
                section={section}
                item={it}
                index={i}
                count={section.items.length}
                open={isOpen(it.id, it.title)}
                onOpenChange={(open) => setItemOpen((m) => ({ ...m, [it.id]: open }))}
              />
            ))}

          {(def.kind === 'groups' || def.kind === 'languages') && (
            <div className="rows">
              {section.items.map((it, i) => (
                <RowItem key={it.id} section={section} item={it} index={i} count={section.items.length} />
              ))}
            </div>
          )}

          {def.kind !== 'text' && (
            <button type="button" className="btn dashed" onClick={addItem}>
              <Plus size={15} /> Add {def.addLabel}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

const TONES: GenerateOptions['tone'][] = ['professional', 'confident', 'warm', 'technical']

function SummaryEditor({ section, onChange }: { section: Section; onChange: (v: string) => void }) {
  const { cv } = useStore()
  const ai = useAI()
  const [opts, setOpts] = useState<GenerateOptions>({ length: 'medium', tone: 'professional', language: 'English', instructions: '' })
  const [optsOpen, setOptsOpen] = useState(false)
  const [previous, setPrevious] = useState<string | null>(null)
  const [lastModel, setLastModel] = useState('')
  const words = section.content.trim() ? section.content.trim().split(/\s+/).length : 0

  const generate = async () => {
    const res = await ai.summary(opts)
    if (!res) return
    setPrevious(section.content)
    setLastModel(res.model)
    onChange(res.text)
  }

  return (
    <div className="summary-editor">
      <AutoTextArea
        value={section.content}
        minRows={4}
        placeholder={SECTION_TYPES.summary.textPlaceholder}
        ariaLabel="Summary"
        onChange={onChange}
        className={ai.busy ? 'shimmer' : ''}
      />
      <div className="ai-bar">
        <button type="button" className="btn ai" onClick={generate} disabled={ai.busy}>
          {ai.busy ? <Spinner /> : <Sparkles size={15} />} {section.content.trim() ? 'Regenerate with AI' : 'Generate with AI'}
        </button>
        <div className="popover-anchor">
          <button type="button" className="btn ghost sm" data-popover-trigger onClick={() => setOptsOpen(!optsOpen)} aria-expanded={optsOpen}>
            <SlidersHorizontal size={14} /> Options
          </button>
          <Popover open={optsOpen} onClose={() => setOptsOpen(false)} align="left" className="ai-options">
            <div className="field">
              <span className="field-label">Length</span>
              <div className="segmented">
                {(['short', 'medium', 'long'] as const).map((l) => (
                  <button type="button" key={l} className={opts.length === l ? 'active' : ''} onClick={() => setOpts({ ...opts, length: l })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Tone">
              <select className="input" value={opts.tone} onChange={(e) => setOpts({ ...opts, tone: e.target.value as GenerateOptions['tone'] })}>
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Output language">
              <TextInput value={opts.language} onChange={(v) => setOpts({ ...opts, language: v })} placeholder="English" />
            </Field>
            <Field label="Extra instructions">
              <AutoTextArea value={opts.instructions} onChange={(v) => setOpts({ ...opts, instructions: v })} placeholder="e.g. Mention I'm relocating to Berlin in 2027" />
            </Field>
            <p className="muted small">The AI uses your whole CV plus the target role / job description (above). It's told not to invent facts.</p>
          </Popover>
        </div>
        {previous !== null && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              onChange(previous)
              setPrevious(null)
            }}
          >
            <Undo2 size={14} /> Undo AI
          </button>
        )}
        <span className={`word-count ${words > 130 ? 'warn' : ''}`}>
          {words} words{lastModel && previous !== null ? ` · ${lastModel}` : ''}
        </span>
      </div>
      {!cv.target.role && !cv.target.jobDescription && (
        <button
          type="button"
          className="hint-link"
          onClick={() => window.dispatchEvent(new CustomEvent('cv:open-target'))}
        >
          Tip: add a target role or job description to tailor the summary →
        </button>
      )}
    </div>
  )
}
