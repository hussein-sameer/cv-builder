import { SECTION_TYPES } from './sectionTypes'
import type { CV } from './types'

export type IssueLevel = 'error' | 'warn' | 'info'
export interface Issue {
  level: IssueLevel
  message: string
  sectionId?: string
}

const WEAK_STARTS = /^(responsible for|worked on|helped|assisted|duties included|tasked with|involved in|in charge of)\b/i
const PLACEHOLDER = /\[[^\]]{0,25}\]/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PRONOUN = /(^|\s)(I|my|me)\s/

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/**
 * A LinkedIn / GitHub value that only names the site ("LinkedIn", "github.com"): it would link to the site's
 * home page, so the CV leaves it out. Mirrors backend layout.profile_url.
 */
export function siteOnly(site: 'linkedin' | 'github', value: string): boolean {
  const v = value.trim().replace(/^(https?:\/\/)?(www\.)?/i, '').replace(/\/+$/, '')
  return (site === 'linkedin' ? /^linkedin(\.com)?(\/in)?$/i : /^github(\.com)?$/i).test(v)
}
export const PROFILE_EXAMPLE = { linkedin: 'linkedin.com/in/yourname', github: 'github.com/yourname' }

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
  if (cv.design.template === 'international' && p.photo) {
    add('info', 'Your photo is printed. Leave it out for UK, Irish, US and Canadian employers; keep it where photos are expected (e.g. Germany, Austria, the Gulf).', 'personal')
  }
  if (cv.design.template === 'international' && (p.dateOfBirth || p.nationality)) {
    add('info', 'Date of birth / nationality are hidden in the International layout (good practice for US/global roles).', 'personal')
  }

  const visible = cv.sections.filter((s) => s.visible)
  const has = (t: string) => visible.some((s) => s.type === t)
  if (!has('experience') && !has('projects')) add('warn', 'Add a Work experience or Projects section.')
  if (!has('skills')) add('warn', 'Add a Skills section — ATS keyword matching relies on it.')
  if (!has('education')) add('info', 'Most ATS expect an Education section.')

  const allText: string[] = []
  for (const s of visible) {
    const def = SECTION_TYPES[s.type]
    if (def.kind === 'text') {
      allText.push(s.content)
      if (s.type === 'summary') {
        const n = words(s.content)
        if (n === 0) add('warn', 'Your summary is empty — try “Generate with AI”.', s.id)
        else if (n < 25) add('info', `Summary is short (${n} words). Aim for 40–100.`, s.id)
        else if (n > 130) add('warn', `Summary is long (${n} words). Keep it under ~100 words / 6 lines.`, s.id)
      }
      continue
    }
    s.items.forEach((it, i) => {
      const label = it.title || `${def.label} #${i + 1}`
      allText.push(it.title, it.organization, it.description, ...it.bullets)
      if (def.kind === 'entries') {
        const isEmpty = !it.title && !it.organization && !it.bullets.some(Boolean) && !it.description
        if (isEmpty) return
        if (!it.title) add('warn', `${def.label}: an entry is missing its title.`, s.id)
        if ((s.type === 'experience' || s.type === 'education') && !it.organization) add('warn', `“${label}” is missing the organisation.`, s.id)
        if ((s.type === 'experience' || s.type === 'education') && !it.startDate && !it.endDate && !it.current)
          add('warn', `“${label}” has no dates — ATS calculates experience from them.`, s.id)
        if (it.startDate && it.endDate && !it.current && it.endDate < it.startDate) add('error', `“${label}”: end date is before start date.`, s.id)
        if (s.type === 'experience' && it.bullets.filter((b) => b.trim()).length === 0 && !it.description.trim())
          add('warn', `“${label}” has no bullet points.`, s.id)
        it.bullets.forEach((b) => {
          if (WEAK_STARTS.test(b.trim())) add('info', `“${b.trim().slice(0, 40)}…” — start with an action verb instead.`, s.id)
          if (words(b) > 40) add('info', `A bullet in “${label}” is over 40 words — split or tighten it.`, s.id)
          if (PRONOUN.test(' ' + b)) add('info', `Avoid “I/my” in bullets (“${b.trim().slice(0, 30)}…”).`, s.id)
        })
      }
    })
  }

  const placeholders = allText.filter((t) => t && PLACEHOLDER.test(t))
  if (placeholders.length) add('error', `${placeholders.length} unfilled placeholder(s) like “${placeholders[0].match(PLACEHOLDER)?.[0]}” — replace with real numbers or remove.`)

  if (/[☀-➿\u{1F300}-\u{1FAFF}]/u.test(allText.join(' ') + p.headline)) add('warn', 'Remove emoji/icons — many ATS drop or garble them.')

  if (pages !== null) {
    if (pages > 2) add('warn', `Your CV is ${pages} pages. Aim for 1–2 pages.`)
    else if (pages === 2 && words(allText.join(' ')) < 350) add('info', 'Content barely spills onto page 2 — trim to fit one page.')
  }
  return issues
}
