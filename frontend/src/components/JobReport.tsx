import { Check, X } from 'lucide-react'
import { jobKey, keywordMatch, type KeywordHit } from '../atsCheck'
import type { CV } from '../types'

const level = (n: number) => (n >= 70 ? 'ok' : n >= 50 ? 'warn' : 'low')

/** "[X%]"-style placeholders highlighted, without dangerouslySetInnerHTML. */
function Marked({ text }: { text: string }) {
  return <>{text.split(/(\[[^\]]{0,25}\])/).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>
}

function Score({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className={`score ${level(value)}`}>
      <span className="score-label">{label}</span>
      <strong>{value}%</strong>
      <span className="meter" aria-hidden>
        <span style={{ width: `${value}%` }} />
      </span>
      <span className="muted small">{note}</span>
    </div>
  )
}

function Keywords({ title, hits }: { title: string; hits: KeywordHit[] }) {
  if (!hits.length) return null
  return (
    <div className="report-group">
      <h4>{title}</h4>
      <ul className="keyword-list">
        {hits.map((k) => (
          <li key={k.term} className={k.found ? 'found' : 'missing'} title={k.found ? 'In your CV' : "Not in your CV with this wording. Add it where it's true."}>
            {k.found ? <Check size={12} /> : <X size={12} />} {k.term}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Notes({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div className="report-group">
      <h4>{title}</h4>
      <ul className="report-notes">
        {items.map((t, i) => (
          <li key={i}>
            <Marked text={t} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The recruiter check against the target job: live keyword match, must-haves vs nice-to-haves, evidence, gaps. */
export function JobReportView({ cv, onClear }: { cv: CV; onClear: () => void }) {
  const r = cv.target.report
  if (!r) return null
  const match = keywordMatch(cv)
  const stale = r.jobKey !== jobKey(cv.target)
  const checked = r.createdAt ? new Date(r.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  return (
    <div className="job-report">
      {stale && <p className="hint-warn small">The role or job description changed since this check. Check again for an up-to-date report.</p>}
      <div className="scores">
        {match && <Score label="Keyword match" value={match.score} note="aim for 70–80%; updates as you edit" />}
        {r.estimate !== null && <Score label="Recruiter estimate" value={r.estimate} note="the AI's overall read" />}
      </div>
      {match && (
        <>
          <Keywords title="Must-have keywords" hits={match.hits.filter((k) => k.kind === 'must')} />
          <Keywords title="Nice to have" hits={match.hits.filter((k) => k.kind === 'nice')} />
          <p className="muted small">
            Ticked terms appear in your CV with the posting's exact wording. Add a missing one only where it's true, inside a bullet that shows it rather than as a list.
          </p>
        </>
      )}
      {r.requirements.length > 0 && (
        <div className="report-group">
          <h4>Requirements and your evidence</h4>
          <ul className="requirements">
            {r.requirements.map((q, i) => (
              <li key={i} className={q.evidence ? 'found' : 'missing'}>
                {q.evidence ? <Check size={14} /> : <X size={14} />}
                <span>
                  <span className={`kind ${q.kind}`}>{q.kind === 'must' ? 'Must' : 'Nice'}</span> <strong>{q.text}</strong>
                  {q.evidence ? <span className="muted"> — {q.evidence}</span> : <span className="muted"> — not shown in your CV</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Notes title="Strongest selling points" items={r.strengths} />
      <Notes title="Biggest gaps" items={r.gaps} />
      <Notes title="Confirm before you add anything" items={r.questions} />
      <Notes title="Next steps for this application" items={r.nextSteps} />
      <div className="report-foot muted small">
        <span>
          {checked && `Checked ${checked}`}
          {r.model && ` · ${r.model}`}
        </span>
        <button type="button" className="btn ghost xs" onClick={onClear}>
          <X size={13} /> Clear report
        </button>
      </div>
    </div>
  )
}
