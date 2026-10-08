import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Copy, ListPlus, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { emptyItem, uid } from '../defaults'
import { CEFR_LEVELS, SECTION_TYPES, type FieldSpec } from '../sectionTypes'
import { findItem, findSection, moveInArray, useStore } from '../store'
import type { Item, Section } from '../types'
import { useAI } from '../useAI'
import { AutoTextArea, BulletsEditor, DateRange, Field, MonthYear, TagInput, TextInput } from './fields'
import { ConfirmDelete, Spinner } from './ui'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function shortDate(v: string) {
  const m = /^(\d{4})(?:-(\d{1,2}))?$/.exec(v)
  if (!m) return v
  return m[2] ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : m[1]
}

function useItemActions(section: Section, item: Item) {
  const { mutate } = useStore()
  return {
    update: (patch: Partial<Item>) => mutate((d) => Object.assign(findItem(d, section.id, item.id), patch)),
    move: (delta: number) =>
      mutate((d) => {
        const s = findSection(d, section.id)
        moveInArray(s.items, s.items.findIndex((x) => x.id === item.id), delta)
      }),
    remove: () =>
      mutate((d) => {
        const s = findSection(d, section.id)
        s.items = s.items.filter((x) => x.id !== item.id)
      }),
    duplicate: () =>
      mutate((d) => {
        const s = findSection(d, section.id)
        const i = s.items.findIndex((x) => x.id === item.id)
        s.items.splice(i + 1, 0, emptyItem({ ...structuredClone(item), id: uid() }))
      }),
  }
}

function MoveButtons({ index, count, move }: { index: number; count: number; move: (d: number) => void }) {
  return (
    <>
      <button type="button" className="icon-btn" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => move(-1)}>
        <ArrowUp size={15} />
      </button>
      <button type="button" className="icon-btn" title="Move down" aria-label="Move down" disabled={index === count - 1} onClick={() => move(1)}>
        <ArrowDown size={15} />
      </button>
    </>
  )
}

/** Card for dated entries (experience, education, projects…) and simple lines (certifications…). */
export function ItemCard({ section, item, index, count, open, onOpenChange }: {
  section: Section
  item: Item
  index: number
  count: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const def = SECTION_TYPES[section.type]
  const { update, move, remove, duplicate } = useItemActions(section, item)
  const [suggestion, setSuggestion] = useState<{ bullets: string[]; model: string } | null>(null)
  const ai = useAI()

  const dates = item.current
    ? `${shortDate(item.startDate)} – Present`
    : [shortDate(item.startDate), shortDate(item.endDate || item.date)].filter(Boolean).join(' – ')
  const sub = [item.organization, dates].filter(Boolean).join(' · ')

  const improve = async () => {
    const res = await ai.bullets({ length: 'medium', tone: 'professional', language: 'English', instructions: '', sectionId: section.id, itemId: item.id, allowPlaceholders: true })
    if (res) setSuggestion(res)
  }

  const renderField = (f: FieldSpec) => {
    switch (f.kind) {
      case 'dateRange':
        return (
          <div className="field span-2" key="dates">
            <span className="field-label">{f.label}</span>
            <DateRange start={item.startDate} end={item.endDate} current={item.current} currentLabel={f.currentLabel ?? 'Current'} onChange={(p) => update(p)} />
          </div>
        )
      case 'date':
        return (
          <div className="field" key={f.key}>
            <span className="field-label">{f.label}</span>
            <MonthYear ariaLabel={f.label} value={item.date} onChange={(v) => update({ date: v })} />
          </div>
        )
      case 'textarea':
        return (
          <Field key={f.key} label={f.label} span={f.span}>
            <AutoTextArea value={item[f.key as 'description']} placeholder={f.placeholder} onChange={(v) => update({ [f.key]: v } as Partial<Item>)} />
          </Field>
        )
      case 'bullets':
        return (
          <div className="field span-2" key={f.key}>
            <div className="field-label-row">
              <span className="field-label">{f.label}</span>
              {def.aiBullets && (
                <button type="button" className="btn ai xs" onClick={improve} disabled={ai.busy || (!item.title && !item.bullets.some(Boolean) && !item.description)}>
                  {ai.busy ? <Spinner size={12} /> : <Sparkles size={13} />} {item.bullets.some(Boolean) ? 'Improve with AI' : 'Draft with AI'}
                </button>
              )}
            </div>
            <BulletsEditor value={item.bullets} placeholder={f.placeholder} onChange={(v) => update({ bullets: v })} />
            {suggestion && (
              <div className="suggestion">
                <div className="suggestion-head">
                  <Sparkles size={14} /> AI suggestion <span className="muted">· {suggestion.model}</span>
                </div>
                <ul>
                  {suggestion.bullets.map((b, i) => (
                    <li key={i} dangerouslySetInnerHTML={{ __html: escapeHtml(b).replace(/\[[^\]]{0,25}\]/g, (m) => `<mark>${m}</mark>`) }} />
                  ))}
                </ul>
                {suggestion.bullets.some((b) => /\[[^\]]{0,25}\]/.test(b)) && (
                  <p className="muted small">Highlighted [placeholders] are for numbers only you know — replace or delete them.</p>
                )}
                <div className="suggestion-actions">
                  <button type="button" className="btn primary xs" onClick={() => (update({ bullets: suggestion.bullets }), setSuggestion(null))}>
                    <Check size={13} /> Replace bullets
                  </button>
                  <button type="button" className="btn xs" onClick={() => (update({ bullets: [...item.bullets.filter(Boolean), ...suggestion.bullets] }), setSuggestion(null))}>
                    <ListPlus size={13} /> Add to mine
                  </button>
                  <button type="button" className="btn ghost xs" onClick={() => setSuggestion(null)}>
                    <X size={13} /> Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      case 'tags':
        return (
          <Field key={f.key} label={f.label} span={f.span ?? 2}>
            <TagInput value={item.tags} placeholder={f.placeholder} ariaLabel={f.label} onChange={(v) => update({ tags: v })} />
          </Field>
        )
      default:
        return (
          <Field key={f.key} label={f.label} span={f.span}>
            <TextInput value={String(item[f.key as keyof Item] ?? '')} placeholder={f.placeholder} type={f.kind === 'url' ? 'url' : 'text'} onChange={(v) => update({ [f.key]: v } as Partial<Item>)} />
          </Field>
        )
    }
  }

  return (
    <div className={`item-card ${open ? 'open' : ''}`}>
      <div className="item-head" onClick={() => onOpenChange(!open)}>
        <button type="button" className="icon-btn" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="item-summary">
          <div className={`item-title ${item.title ? '' : 'placeholder'}`}>{item.title || `New ${def.addLabel}`}</div>
          {sub && <div className="item-sub">{sub}</div>}
        </div>
        <div className="item-actions" onClick={(e) => e.stopPropagation()}>
          <MoveButtons index={index} count={count} move={move} />
          <button type="button" className="icon-btn" title="Duplicate" aria-label="Duplicate" onClick={duplicate}>
            <Copy size={15} />
          </button>
          <ConfirmDelete onConfirm={remove} title={`Delete ${def.addLabel}`} size={15} />
        </div>
      </div>
      {open && <div className="grid">{def.fields.map(renderField)}</div>}
    </div>
  )
}

/** Compact row for skill groups and languages. */
export function RowItem({ section, item, index, count }: { section: Section; item: Item; index: number; count: number }) {
  const def = SECTION_TYPES[section.type]
  const { update, move, remove } = useItemActions(section, item)
  const listId = `levels-${item.id}`
  return (
    <div className={`row-item ${def.kind}`}>
      {def.kind === 'groups' ? (
        <>
          <TextInput value={item.title} placeholder={def.fields[0].placeholder} ariaLabel="Category" onChange={(v) => update({ title: v })} />
          <TagInput value={item.tags} placeholder={def.fields[1].placeholder} ariaLabel="Skills" onChange={(v) => update({ tags: v })} />
        </>
      ) : (
        <>
          <TextInput value={item.title} placeholder="Language" ariaLabel="Language" onChange={(v) => update({ title: v })} />
          <TextInput value={item.level} placeholder="Level, e.g. C1 – Advanced" ariaLabel="Level" list={listId} onChange={(v) => update({ level: v })} />
          <datalist id={listId}>
            {CEFR_LEVELS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </>
      )}
      <div className="row-actions always">
        <MoveButtons index={index} count={count} move={move} />
        <ConfirmDelete onConfirm={remove} size={15} />
      </div>
    </div>
  )
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
