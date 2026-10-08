import { emptyItem, normalizeCV } from './defaults'
import { SECTION_TYPES } from './sectionTypes'
import type { CV, Design, Item, SectionType } from './types'

/**
 * The instruction people paste into an external AI chat (ChatGPT, Claude, Gemini…) together with their
 * old CV file, so it returns JSON that `parseCvText` can import. Same rule as our own prompts:
 * copy the CV's facts verbatim, never invent or "improve" them.
 */
export const AI_IMPORT_PROMPT = `I'm moving my CV into an app called CV Builder. Read the CV I attached (or pasted) and convert it into JSON in the exact format below.

How to reply
- Give me the result as a downloadable file named cv.json.
- If you can't create files, reply with only the JSON inside one \`\`\`json code block, with nothing before or after it.

Rules
1. Copy my wording exactly. Don't rewrite, summarise, shorten, translate, correct or improve anything, and don't add anything that isn't in my CV: no invented dates, numbers, skills, links or job titles. Only rejoin words that the file split across lines.
2. Read every page, column, sidebar, header and footer, so nothing is left out.
3. Keep sections and entries in the same order as in my CV.
4. If something isn't in my CV, use "" (or [] for a list). Never write "N/A", "Unknown" or a guess.
5. Dates: "YYYY-MM" if the month is given, otherwise "YYYY". If an entry is ongoing ("Present", "Current", "to date"), use "endDate": "" and "current": true; otherwise "current": false.
6. Bullets: one array item per bullet point or line, without the bullet symbol.
7. Section "title": use "" for the standard types below. For "custom" and "customText" sections, use the heading from my CV.
8. Output valid JSON only: double quotes, no comments, no trailing commas.

Section types (pick the closest; anything that fits none goes into "custom" if it has entries, or "customText" if it is a paragraph):
- "summary": profile, summary or objective. The text goes in "content".
- "experience": jobs and internships. Each item: title (job title), organization (employer), location, startDate, endDate, current, description (a one-line intro, if there is one), bullets, tags (tools or technologies listed for that job).
- "education": title (degree or qualification), organization (school or university), location, startDate, endDate, current, grade, bullets (thesis, honours, modules).
- "skills": one item per group: title (the group name, e.g. "Programming", or "" if the skills aren't grouped), tags (the individual skills).
- "languages": title (the language), level (as written, e.g. "Native", "C1", "Fluent").
- "certifications": title, organization (issuer), date, link.
- "courses": title, organization (provider), date, link.
- "projects": title, organization (role or context), link, startDate, endDate, current, description, bullets, tags (technologies).
- "volunteering": title (role), organization, location, startDate, endDate, current, bullets.
- "awards": title, organization (awarded by), date, description.
- "publications": title, organization (publisher or venue), date, link, description.
- "interests", "references", "customText": the text goes in "content".
- "custom": items like experience: title, organization, location, startDate, endDate, current, description, bullets.

Personal details: "headline" is the job title under my name, if there is one. Copy LinkedIn, GitHub and website addresses as written. Fill "nationality", "dateOfBirth", "workPermit" and "drivingLicence" only if my CV states them. Leave out any photo.

Format (fill in my details; include only the sections my CV has, with as many items as needed):
{
  "personal": {
    "fullName": "", "headline": "", "email": "", "phone": "", "location": "",
    "linkedin": "", "github": "", "website": "",
    "nationality": "", "dateOfBirth": "", "workPermit": "", "drivingLicence": ""
  },
  "sections": [
    { "type": "summary", "title": "", "content": "" },
    { "type": "experience", "title": "", "items": [
      { "title": "", "organization": "", "location": "", "startDate": "YYYY-MM", "endDate": "YYYY-MM", "current": false,
        "description": "", "bullets": [], "tags": [] }
    ] },
    { "type": "education", "title": "", "items": [
      { "title": "", "organization": "", "location": "", "startDate": "YYYY", "endDate": "YYYY", "current": false, "grade": "", "bullets": [] }
    ] },
    { "type": "skills", "title": "", "items": [ { "title": "", "tags": [] } ] },
    { "type": "languages", "title": "", "items": [ { "title": "", "level": "" } ] },
    { "type": "certifications", "title": "", "items": [ { "title": "", "organization": "", "date": "YYYY-MM", "link": "" } ] }
  ]
}`

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
function list(v: unknown, sep: RegExp): string[] {
  const raw = Array.isArray(v) ? v.map(str) : typeof v === 'string' ? v.split(sep) : []
  return raw.map((s) => s.replace(/^[•●▪◦\-–*]\s+/, '').trim()).filter(Boolean)
}

/** Pull the JSON object out of a file or an AI chat reply (code fences, text around it, trailing commas). */
export function extractJson(text: string): unknown {
  const t = text.replace(/^﻿/, '').trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)
  const body = fenced ? fenced[1] : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)
  for (const candidate of [t, body, body.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      return JSON.parse(candidate)
    } catch {
      /* try the next, more forgiving candidate */
    }
  }
  throw new Error("That isn't valid JSON. Make sure you copied the AI's whole reply, from the first { to the last }.")
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const PRESENT = /^(present|current|currently|now|today|ongoing|to date|till date|until now)$/i

/** "2021-03", "03/2021", "Mar 2021", "March 2021", "2021" -> "YYYY[-MM]"; "Present" -> present. Unknown -> "". */
export function toYearMonth(value: unknown): { date: string; present: boolean } {
  const s = str(value)
  if (PRESENT.test(s)) return { date: '', present: true }
  const ym = (y: string, m: number) => ({ date: m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, '0')}` : y, present: false })
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(s)
  if (m) return ym(m[1], Number(m[2]))
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m) return ym(m[2], Number(m[1]))
  m = /^([a-z]+)\.?,?\s+(\d{4})$/i.exec(s)
  if (m) return ym(m[2], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1)
  m = /\b((?:19|20)\d{2})\b/.exec(s) // "2019", "Summer 2019": keep the year at least
  return { date: m ? m[1] : '', present: false }
}

// Section names AIs (or other tools) use instead of ours.
const TYPE_ALIASES: Record<string, SectionType> = {
  profile: 'summary', about: 'summary', aboutme: 'summary', objective: 'summary', professionalsummary: 'summary',
  work: 'experience', workexperience: 'experience', employment: 'experience', employmenthistory: 'experience',
  workhistory: 'experience', professionalexperience: 'experience', career: 'experience',
  educationandtraining: 'education', qualifications: 'education',
  skill: 'skills', technicalskills: 'skills', keyskills: 'skills', competencies: 'skills',
  language: 'languages', languageskills: 'languages',
  certification: 'certifications', certificates: 'certifications', certificate: 'certifications', licenses: 'certifications', licences: 'certifications',
  project: 'projects',
  volunteer: 'volunteering', volunteerexperience: 'volunteering',
  award: 'awards', honors: 'awards', honours: 'awards', achievements: 'awards',
  publication: 'publications',
  course: 'courses', training: 'courses', coursesandtraining: 'courses',
  hobbies: 'interests', interest: 'interests',
  reference: 'references',
}

function sectionType(raw: string): SectionType | null {
  if (raw in SECTION_TYPES) return raw as SectionType
  const key = raw.toLowerCase().replace(/[^a-z]/g, '')
  return key === 'customtext' ? 'customText' : TYPE_ALIASES[key] ?? (key in SECTION_TYPES ? (key as SectionType) : null)
}

function coerceItem(it: Rec): Item {
  const start = toYearMonth(it.startDate)
  const end = toYearMonth(it.endDate)
  return emptyItem({
    ...(str(it.id) ? { id: str(it.id) } : {}),
    title: str(it.title),
    organization: str(it.organization),
    location: str(it.location),
    startDate: start.date,
    endDate: end.date,
    current: it.current === true || it.current === 'true' || end.present,
    date: toYearMonth(it.date).date,
    description: str(it.description),
    bullets: list(it.bullets, /\r?\n/),
    tags: list(it.tags, /[,;\n]/),
    grade: str(it.grade),
    link: str(it.link),
    level: str(it.level),
  })
}

function coerceDesign(d: unknown): Partial<Design> {
  if (!isRec(d)) return {}
  const out: Partial<Design> = {}
  if (d.template === 'international' || d.template === 'europass') out.template = d.template
  if (d.fontFamily === null || ['Calibri', 'Arial', 'Cambria', 'Times New Roman', 'Georgia'].includes(str(d.fontFamily))) {
    out.fontFamily = d.fontFamily as Design['fontFamily']
  }
  if (typeof d.fontSize === 'number' && d.fontSize >= 8 && d.fontSize <= 13) out.fontSize = d.fontSize
  if (/^#[0-9a-f]{6}$/i.test(str(d.accentColor))) out.accentColor = str(d.accentColor)
  if (d.pageSize === 'A4' || d.pageSize === 'Letter') out.pageSize = d.pageSize
  return out
}

/**
 * Turn JSON text — a CV Builder export, or an AI chat's reply to AI_IMPORT_PROMPT — into a valid CV.
 * Lenient on purpose: AIs mix up types, date formats and section names, and it's better to import
 * everything and let the editor + ATS check point out gaps than to reject the file.
 */
export function parseCvText(text: string): CV {
  let raw = extractJson(text)
  if (isRec(raw) && !raw.sections && isRec(raw.cv)) raw = raw.cv // {"cv": {...}}
  if (!isRec(raw)) throw new Error("This JSON doesn't contain a CV.")

  const p = isRec(raw.personal) ? raw.personal : {}
  const personal = Object.fromEntries(
    ['fullName', 'headline', 'email', 'phone', 'location', 'linkedin', 'github', 'website', 'nationality', 'dateOfBirth', 'workPermit', 'drivingLicence'].map(
      (k) => [k, str(p[k])],
    ),
  )
  personal.fullName ||= str(p.name)

  const sections = (Array.isArray(raw.sections) ? raw.sections : []).filter(isRec).flatMap((s) => {
    const heading = str(s.title)
    let type = sectionType(str(s.type)) ?? sectionType(heading)
    let items = (Array.isArray(s.items) ? s.items : []).filter(isRec).map(coerceItem)
    let content = str(s.content)
    if (!type) type = items.length ? 'custom' : 'customText' // unknown section: keep it, under its own heading
    const kind = SECTION_TYPES[type].kind
    if (kind === 'text' && !content && items.length) {
      content = items.map((it) => it.title || it.description || it.bullets.join('; ')).filter(Boolean).join(type === 'interests' ? ', ' : '\n')
      items = []
    } else if (kind !== 'text' && !items.length && content) {
      if (type === 'skills') [items, content] = [[emptyItem({ tags: list(content, /[,;\n]/) })], '']
      else type = 'customText' // a paragraph where entries were expected: keep the text
    }
    if (kind === 'entries') {
      // entries print a date range only, so a single date becomes the end date
      items = items.map((it) => (it.date && !it.startDate && !it.endDate ? { ...it, endDate: it.date, date: '' } : it))
    }
    if (!content && !items.length) return []
    const custom = type === 'custom' || type === 'customText'
    return [{ id: str(s.id), type, title: custom ? heading || str(s.type) : heading, visible: s.visible !== false, content, items }]
  })

  const cv = normalizeCV({
    personal,
    sections,
    design: coerceDesign(raw.design),
    target: isRec(raw.target) ? { role: str(raw.target.role), jobDescription: str(raw.target.jobDescription) } : undefined,
  })
  if (!cv.personal.fullName && !cv.sections.length) throw new Error('No CV details found in this JSON.')
  return cv
}
