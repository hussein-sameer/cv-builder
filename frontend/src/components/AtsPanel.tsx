import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import type { Issue } from '../atsCheck'

const ICON = { error: AlertCircle, warn: AlertTriangle, info: Info }

export function AtsPanel({ issues, onJump }: { issues: Issue[]; onJump: (sectionId: string) => void }) {
  if (!issues.length) {
    return (
      <div className="ats-panel">
        <p className="ats-ok">
          <CheckCircle2 size={16} /> No issues found. Your CV is single-column, text-based and uses standard headings.
        </p>
      </div>
    )
  }
  return (
    <div className="ats-panel">
      <ul>
        {issues.map((it, i) => {
          const Icon = ICON[it.level]
          return (
            <li key={i} className={`ats-${it.level}`}>
              <Icon size={15} />
              {it.sectionId ? (
                <button type="button" className="ats-link" onClick={() => onJump(it.sectionId!)}>
                  {it.message}
                </button>
              ) : (
                <span>{it.message}</span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="muted small">Always ATS-safe here: one column, no tables/text boxes/images, real text layer, standard headings, contact details in the body.</p>
    </div>
  )
}
