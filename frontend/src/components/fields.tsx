import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const THIS_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 70 }, (_, i) => String(THIS_YEAR + 6 - i))

export function Field({ label, children, span = 1, hint }: { label: string; children: ReactNode; span?: 1 | 2; hint?: ReactNode }) {
  return (
    <label className={`field ${span === 2 ? 'span-2' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function TextInput(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  list?: string
  autoFocus?: boolean
  ariaLabel?: string
}) {
  return (
    <input
      className="input"
      type={props.type ?? 'text'}
      value={props.value}
      placeholder={props.placeholder}
      list={props.list}
      autoFocus={props.autoFocus}
      aria-label={props.ariaLabel}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}

export function AutoTextArea(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  minRows?: number
  className?: string
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  inputRef?: (el: HTMLTextAreaElement | null) => void
  ariaLabel?: string
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [props.value])
  return (
    <textarea
      ref={(el) => {
        ref.current = el
        props.inputRef?.(el)
      }}
      className={`input textarea ${props.className ?? ''}`}
      rows={props.minRows ?? 2}
      value={props.value}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={props.onKeyDown}
      onPaste={props.onPaste}
    />
  )
}

/** Month + year picker. Value: "YYYY-MM", "YYYY" or "". */
export function MonthYear({ value, onChange, disabled, ariaLabel }: { value: string; onChange: (v: string) => void; disabled?: boolean; ariaLabel: string }) {
  const m = /^(\d{4})(?:-(\d{1,2}))?$/.exec(value || '')
  const [month, setMonth] = useState(m?.[2] ? String(Number(m[2])).padStart(2, '0') : '')
  const year = m?.[1] ?? ''
  useEffect(() => {
    const mm = /^(\d{4})(?:-(\d{1,2}))?$/.exec(value || '')
    if (mm) setMonth(mm[2] ? String(Number(mm[2])).padStart(2, '0') : '')
  }, [value])
  const emit = (y: string, mo: string) => onChange(y ? (mo ? `${y}-${mo}` : y) : '')
  return (
    <div className={`monthyear ${disabled ? 'disabled' : ''}`} aria-label={ariaLabel}>
      <select
        className="input"
        value={month}
        disabled={disabled}
        aria-label={`${ariaLabel} month`}
        onChange={(e) => {
          setMonth(e.target.value)
          emit(year, e.target.value)
        }}
      >
        <option value="">Month</option>
        {MONTHS.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, '0')}>
            {name}
          </option>
        ))}
      </select>
      <select className="input" value={year} disabled={disabled} aria-label={`${ariaLabel} year`} onChange={(e) => emit(e.target.value, month)}>
        <option value="">Year</option>
        {YEARS.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  )
}

export function DateRange(props: {
  start: string
  end: string
  current: boolean
  currentLabel: string
  onChange: (patch: { startDate?: string; endDate?: string; current?: boolean }) => void
}) {
  return (
    <div className="daterange">
      <div>
        <span className="mini-label">Start</span>
        <MonthYear ariaLabel="Start date" value={props.start} onChange={(v) => props.onChange({ startDate: v })} />
      </div>
      <div>
        <span className="mini-label">End</span>
        {props.current ? (
          <div className="present-pill">Present</div>
        ) : (
          <MonthYear ariaLabel="End date" value={props.end} onChange={(v) => props.onChange({ endDate: v })} />
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={props.current} onChange={(e) => props.onChange({ current: e.target.checked })} />
        {props.currentLabel}
      </label>
    </div>
  )
}

/** Bullet list: Enter adds a bullet, Backspace on empty removes it, multi-line paste splits. */
export function BulletsEditor({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const refs = useRef<(HTMLTextAreaElement | null)[]>([])
  const focusIdx = useRef<number | null>(null)
  const bullets = value.length ? value : ['']

  useEffect(() => {
    if (focusIdx.current !== null) {
      const el = refs.current[focusIdx.current]
      el?.focus()
      if (el) el.selectionStart = el.selectionEnd = el.value.length
      focusIdx.current = null
    }
  })

  const set = (i: number, text: string) => {
    const next = [...bullets]
    next[i] = text
    onChange(next)
  }

  return (
    <div className="bullets">
      {bullets.map((b, i) => (
        <div className="bullet-row" key={i}>
          <span className="bullet-dot">•</span>
          <AutoTextArea
            minRows={1}
            className="bullet-input"
            value={b}
            placeholder={i === 0 ? placeholder : 'Another achievement…'}
            ariaLabel={`Bullet ${i + 1}`}
            inputRef={(el) => (refs.current[i] = el)}
            onChange={(v) => set(i, v.replace(/\n/g, ' '))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                const next = [...bullets]
                next.splice(i + 1, 0, '')
                focusIdx.current = i + 1
                onChange(next)
              } else if (e.key === 'Backspace' && b === '' && bullets.length > 1) {
                e.preventDefault()
                const next = bullets.filter((_, j) => j !== i)
                focusIdx.current = Math.max(0, i - 1)
                onChange(next)
              }
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text')
              if (!text.includes('\n')) return
              e.preventDefault()
              const lines = text
                .split(/\r?\n/)
                .map((l) => l.replace(/^\s*(?:[-•*▪●◦–]|\d+[.)])\s*/, '').trim())
                .filter(Boolean)
              const next = [...bullets]
              if (b.trim()) next.splice(i + 1, 0, ...lines) // insert after the current bullet
              else next.splice(i, 1, ...lines) // replace the empty bullet
              focusIdx.current = (b.trim() ? i + 1 : i) + lines.length - 1
              onChange(next)
            }}
          />
          <div className="row-actions">
            <button type="button" className="icon-btn sm" title="Move up" disabled={i === 0} onClick={() => onChange(swap(bullets, i, i - 1))}>
              <ArrowUp size={14} />
            </button>
            <button type="button" className="icon-btn sm" title="Move down" disabled={i === bullets.length - 1} onClick={() => onChange(swap(bullets, i, i + 1))}>
              <ArrowDown size={14} />
            </button>
            <button type="button" className="icon-btn sm danger" title="Remove bullet" onClick={() => onChange(bullets.filter((_, j) => j !== i))}>
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          focusIdx.current = bullets.length
          onChange([...bullets, ''])
        }}
      >
        <Plus size={14} /> Add bullet <span className="kbd">Enter</span>
      </button>
    </div>
  )
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const next = [...arr]
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}

/** Chip input for skills/tools. Enter, comma or Tab adds; paste "a, b, c" splits. */
export function TagInput({ value, onChange, placeholder, ariaLabel }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; ariaLabel?: string }) {
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const parts = raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!parts.length) return
    const lower = value.map((v) => v.toLowerCase())
    onChange([...value, ...parts.filter((p, i) => !lower.includes(p.toLowerCase()) && parts.indexOf(p) === i)])
    setDraft('')
  }
  return (
    <div className="tags" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
      {value.map((t, i) => (
        <span className="tag" key={t + i}>
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        value={draft}
        aria-label={ariaLabel ?? 'Add tag'}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => {
          const v = e.target.value
          if (/[,;]/.test(v)) add(v)
          else setDraft(v)
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === 'Tab') && draft.trim()) {
            e.preventDefault()
            add(draft)
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (/[,;\n]/.test(text)) {
            e.preventDefault()
            add(draft + text)
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  )
}
