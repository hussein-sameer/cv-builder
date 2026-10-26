import { SECTION_TYPES } from './sectionTypes'
import type { CV, Item } from './types'

export type IssueLevel = 'error' | 'warn' | 'info'
export interface Issue {
  level: IssueLevel
  message: string
  sectionId?: string
}

const WEAK_STARTS = /^(responsible for|was responsible for|responsibilities included|worked on|helped|assisted|duties included|tasked with|involved in|in charge of|handled|participated in)\b/i
const PLACEHOLDER = /\[[^\]]{0,25}\]/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// "I" only as a capital, so "i.e." doesn't count; "My"/"my" either way
const PRONOUN = /(^|[\s(])(I|I['’](m|ve|d|ll)|[Mm]y|[Mm]e|[Mm]yself)(?=[\s,.;:!?)]|$)/
const CEFR = /\b[ABC][12]\b|^\s*(native|mother tongue|bilingual)\b/i
const YM = /^\s*(\d{4})(?:-(\d{1,2}))?\s*$/

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word, case-insensitive occurrences of a term ("C++" and "Node.js" included). No lookbehind, for older Safari. */
export function countTerm(text: string, term: string): number {
  if (!term.trim()) return 0
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(term.trim()).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu')
  return (text.match(re) ?? []).length
}

/**
 * A LinkedIn / GitHub value that only names the site ("LinkedIn", "github.com"): it would link to the site's
 * home page, so the CV leaves it out. Mirrors backend layout.profile_url.
 */
export function siteOnly(site: 'linkedin' | 'github', value: string): boolean {
  const v = value.trim().replace(/^(https?:\/\/)?(www\.)?/i, '').replace(/\/+$/, '')
  return (site === 'linkedin' ? /^linkedin(\.com)?(\/in)?$/i : /^github(\.com)?$/i).test(v)
}
export const PROFILE_EXAMPLE = { linkedin: 'linkedin.com/in/yourname', github: 'github.com/yourname' }

/** Merged span of all experience entries, in years (overlaps counted once). Mirrors backend layout.years_of_experience. */
export function yearsOfExperience(cv: CV, today = new Date()): number | null {
  const toDay = (v: string, end: boolean): number | null => {
    const m = YM.exec(v || '')
    if (!m) return null
    const mo = Math.min(Math.max(m[2] ? Number(m[2]) : end ? 12 : 1, 1), 12)
    return Date.UTC(Number(m[1]), mo - 1, end ? 28 : 1)
  }
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const spans: [number, number][] = []
  for (const s of cv.sections) {
    if (s.type !== 'experience') continue
    for (const it of s.items) {
      const start = toDay(it.startDate, false)
      if (start === null) continue
      const end = it.current ? now : (toDay(it.endDate, true) ?? now)
      if (end > start) spans.push([start, end])
    }
  }
  if (!spans.length) return null
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let total = 0
  let [curS, curE] = spans[0]
  for (const [s, e] of spans.slice(1)) {
    if (s <= curE) curE = Math.max(curE, e)
    else {
      total += curE - curS
      ;[curS, curE] = [s, e]
    }
  }
  total += curE - curS
  return Math.round((total / 86_400_000 / 365.25) * 10) / 10
}

/** Pages a recruiter expects: one up to 5 years of experience, two at most above that (or when the dates don't say). */
export function pageLimit(cv: CV): 1 | 2 {
  const yrs = yearsOfExperience(cv)
  return yrs !== null && yrs <= 5 ? 1 : 2
}

/** "YYYY-MM" to compare end dates; ongoing entries sort as the most recent. */
function endKey(it: Item): string {
  if (it.current) return '9999-12'
  const m = YM.exec(it.endDate || it.startDate)
  return m ? `${m[1]}-${(m[2] ?? '12').padStart(2, '0')}` : ''
}

/** Lightweight checks for things that hurt ATS parsing or recruiter skimming. */
export function atsCheck(cv: CV, pages: number | null): Issue[] {
  const issues: Issue[] = []
  const p = cv.personal
  const add = (level: IssueLevel, message: string, sectionId?: string) => issues.push({ level, message, sectionId })

  if (!p.fullName.trim()) add('error', 'Add your full name.', 'personal')
  if (!p.email.trim()) add('error', 'Add an email address — ATS uses it to identify you.', 'personal')
  else if (!EMAIL.test(p.email.trim())) add('error', 'Email address looks invalid.', 'personal')
  if (!p.phone.replace(/^\s*\+\d{1,4}\s*$/, '').trim()) add('warn', 'Add a phone number.', 'personal') // a code alone isn't printed
  if (!p.location.trim()) add('info', 'Add a location (city, country) — many ATS filter by it.', 'personal')
  for (const [site, name] of [['linkedin', 'LinkedIn'], ['github', 'GitHub']] as const) {
    if (siteOnly(site, p[site])) add('warn', `Your ${name} entry is just the site's name, so it isn't printed. Add your profile address (${PROFILE_EXAMPLE[site]}).`, 'personal')
  }
  if (p.photo) {
    add('info', 'Your photo is printed. Keep it where photos are expected (e.g. Germany, Austria, the Gulf); leave it out for UK, Irish, US and Canadian employers.', 'personal')
  }
  if (cv.design.template === 'international' && (p.dateOfBirth || p.nationality)) {
    add('info', 'Date of birth / nationality are hidden in the International layout (good practice for US/global roles).', 'personal')
  }
  if (cv.design.fontSize < 10 || cv.design.fontSize > 12) add('info', `Font size is ${cv.design.fontSize} pt. 10–12 pt reads best.`)

  const visible = cv.sections.filter((s) => s.visible)
  const has = (t: string) => visible.some((s) => s.type === t)
  if (!has('experience') && !has('projects')) add('warn', 'Add a Work experience or Projects section.')
  if (!has('skills')) add('warn', 'Add a Skills section — ATS keyword matching relies on it.')
  if (!has('education')) add('info', 'Most ATS expect an Education section.')

  const allText: string[] = []
  const prose: string[] = [] // summary and bullets: where repeated keywords read as stuffing
  for (const s of visible) {
    const def = SECTION_TYPES[s.type]
    if (def.kind === 'text') {
      allText.push(s.content)
      if (s.type === 'summary') {
        prose.push(s.content)
        const n = words(s.content)
        if (n === 0) add('warn', 'Your summary is empty — try “Generate with AI”.', s.id)
        else if (n < 40) add('info', `Summary is short (${n} words). Aim for 4–6 sentences, about 60–100 words.`, s.id)
        else if (n > 130) add('warn', `Summary is long (${n} words). Keep it to 4–6 sentences, under ~100 words / 6 lines.`, s.id)
      }
      continue
    }
    if (def.kind === 'languages') {
      for (const it of s.items) {
        const lang = it.title.trim()
        if (!lang) continue
        if (!it.level.trim()) add('info', `Add a level for ${lang}, e.g. “C1 – Advanced”.`, s.id)
        else if (!CEFR.test(it.level))
          add(cv.design.template === 'europass' ? 'warn' : 'info', `${lang}: “${it.level.trim()}” isn't a CEFR level. Use A1–C2 (e.g. “C1 – Advanced”); EU employers screen on it.`, s.id)
      }
    }
    if (s.type === 'skills') {
      const seen = new Set<string>()
      const dups = new Set<string>()
      for (const t of s.items.flatMap((it) => it.tags)) {
        const k = t.trim().toLowerCase()
        if (k && seen.has(k)) dups.add(t.trim())
        seen.add(k)
      }
      if (dups.size) add('info', `Listed more than once in Skills: ${[...dups].slice(0, 4).join(', ')}.`, s.id)
    }
    if ((s.type === 'experience' || s.type === 'education') && def.kind === 'entries') {
      const dated = s.items.filter((it) => endKey(it))
      const i = dated.findIndex((it, j) => j > 0 && endKey(it) > endKey(dated[j - 1]))
      if (i > 0) {
        const name = (it: Item) => it.title.trim() || it.organization.trim() || 'an entry'
        add(s.type === 'experience' ? 'warn' : 'info', `List ${def.label.toLowerCase()} most recent first: “${name(dated[i])}” should come before “${name(dated[i - 1])}”.`, s.id)
      }
    }
    s.items.forEach((it, i) => {
      const label = it.title || `${def.label} #${i + 1}`
      allText.push(it.title, it.organization, it.description, ...it.bullets)
      if (def.kind === 'entries') {
        prose.push(...it.bullets)
        const isEmpty = !it.title && !it.organization && !it.bullets.some(Boolean) && !it.description
        if (isEmpty) return
        if (!it.title) add('warn', `${def.label}: an entry is missing its title.`, s.id)
        if ((s.type === 'experience' || s.type === 'education') && !it.organization) add('warn', `“${label}” is missing the organisation.`, s.id)
        if ((s.type === 'experience' || s.type === 'education') && !it.startDate && !it.endDate && !it.current)
          add('warn', `“${label}” has no dates — ATS calculates experience from them.`, s.id)
        if (it.startDate && it.endDate && !it.current && it.endDate < it.startDate) add('error', `“${label}”: end date is before start date.`, s.id)
        const nBullets = it.bullets.filter((b) => b.trim()).length
        if (s.type === 'experience' && nBullets === 0 && !it.description.trim()) add('warn', `“${label}” has no bullet points.`, s.id)
        else if (s.type === 'experience' && nBullets > 6) add('warn', `“${label}” has ${nBullets} bullets. Keep the strongest 3–5 (6 at most).`, s.id)
        // only the two latest roles: recruiters read those closely, older ones can be shorter
        else if (s.type === 'experience' && i < 2 && nBullets > 0 && nBullets < 3)
          add('info', `“${label}” has ${nBullets === 1 ? 'one bullet' : 'two bullets'}. 3–5 achievements per recent role is typical.`, s.id)
        it.bullets.forEach((b) => {
          if (WEAK_STARTS.test(b.trim())) add('info', `“${b.trim().slice(0, 40)}…” — start with an action verb instead.`, s.id)
          if (words(b) > 40) add('info', `A bullet in “${label}” is over 40 words — split or tighten it.`, s.id)
          if (PRONOUN.test(b)) add('info', `Avoid “I/my” in bullets (“${b.trim().slice(0, 30)}…”).`, s.id)
        })
      }
    })
  }

  const placeholders = allText.filter((t) => t && PLACEHOLDER.test(t))
  if (placeholders.length) add('error', `${placeholders.length} unfilled placeholder(s) like “${placeholders[0].match(PLACEHOLDER)?.[0]}” — replace with real numbers or remove.`)

  if (/[☀-➿\u{1F300}-\u{1FAFF}]/u.test(allText.join(' ') + p.headline)) add('warn', 'Remove emoji/icons — many ATS drop or garble them.')

  // keyword stuffing: one of your own skills repeated across the summary and bullets
  const proseText = prose.join('\n')
  const skills = [...new Set(visible.filter((s) => s.type === 'skills').flatMap((s) => s.items.flatMap((it) => it.tags.map((t) => t.trim()))))]
  const repeated = skills
    .filter((t) => t.length >= 3)
    .map((t) => [t, countTerm(proseText, t)] as const)
    .filter(([, n]) => n > 3)
    .sort((a, b) => b[1] - a[1])
  if (repeated.length) {
    const [term, n] = repeated[0]
    add('info', `“${term}” appears ${n} times in your summary and bullets. Once or twice where it's true is enough; repetition reads as keyword stuffing.`)
  }

  if (pages !== null) {
    const limit = pageLimit(cv)
    if (pages > limit && limit === 1) {
      const yrs = Math.round(yearsOfExperience(cv) ?? 0)
      const span = yrs < 1 ? 'under a year' : `about ${yrs} year${yrs === 1 ? '' : 's'}`
      add('warn', `Your CV is ${pages} pages. With ${span} of experience, keep it to one page (two pages is for more than 5 years).`)
    } else if (pages > limit) add('warn', `Your CV is ${pages} pages. Keep it to two pages at most.`)
    else if (pages === 2 && words(allText.join(' ')) < 350) add('info', 'Content barely spills onto page 2 — trim to fit one page.')
  }
  return issues
}
