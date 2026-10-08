import { SECTION_TYPES } from './sectionTypes'
import type { AISettings, CV, Item, Section, SectionType } from './types'

export function uid(): string {
  // crypto.randomUUID needs a secure context; fall back for plain-http LAN use.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && window.isSecureContext) {
    return crypto.randomUUID().slice(0, 8)
  }
  return Math.random().toString(36).slice(2, 10)
}

export function emptyItem(partial: Partial<Item> = {}): Item {
  return {
    id: uid(),
    title: '',
    organization: '',
    location: '',
    startDate: '',
    endDate: '',
    current: false,
    date: '',
    description: '',
    bullets: [],
    tags: [],
    grade: '',
    link: '',
    level: '',
    ...partial,
  }
}

export function newSection(type: SectionType, withItem = true): Section {
  const def = SECTION_TYPES[type]
  return {
    id: uid(),
    type,
    title: '',
    visible: true,
    content: def.defaultContent ?? '',
    items: def.kind !== 'text' && withItem ? [emptyItem(type === 'experience' || type === 'projects' ? { bullets: [''] } : {})] : [],
  }
}

export function emptyCV(): CV {
  return {
    personal: {
      fullName: '',
      headline: '',
      email: '',
      phone: '',
      location: '',
      linkedin: '',
      github: '',
      website: '',
      nationality: '',
      dateOfBirth: '',
      workPermit: '',
      drivingLicence: '',
    },
    sections: (['summary', 'experience', 'education', 'skills'] as SectionType[]).map((t) => newSection(t)),
    design: { template: 'international', fontFamily: null, fontSize: 10.5, accentColor: '#1F3864', pageSize: 'A4' },
    target: { role: '', jobDescription: '' },
  }
}

/** Fill in any missing keys so older saves / imported JSON keep working. */
export function normalizeCV(raw: unknown): CV {
  const base = emptyCV()
  const r = (raw ?? {}) as Partial<CV>
  const sections = Array.isArray(r.sections)
    ? r.sections
        .filter((s): s is Section => !!s && typeof s === 'object' && (s as Section).type in SECTION_TYPES)
        .map((s) => ({
          ...newSection(s.type, false),
          ...s,
          id: s.id || uid(),
          items: Array.isArray(s.items) ? s.items.map((it) => emptyItem({ ...it, id: it?.id || uid() })) : [],
        }))
    : base.sections
  return {
    personal: { ...base.personal, ...(r.personal ?? {}) },
    sections,
    design: { ...base.design, ...(r.design ?? {}) },
    target: { ...base.target, ...(r.target ?? {}) },
  }
}

export function defaultAISettings(): AISettings {
  return {
    active: 'openai',
    remember: false,
    keysInAccount: true,
    providers: {
      openai: { baseUrl: '', apiKey: '', model: '', temperature: null }, // '' = server default endpoint
      anthropic: { baseUrl: '', apiKey: '', model: '', temperature: null },
      gemini: { baseUrl: '', apiKey: '', model: '', temperature: null },
      ollama: { baseUrl: '', apiKey: '', model: '', temperature: null },
    },
  }
}

export function exampleCV(): CV {
  const s = (type: SectionType, patch: Partial<Section>): Section => ({ ...newSection(type, false), ...patch })
  return {
    personal: {
      fullName: 'Alex Morgan',
      headline: 'Senior Network Engineer',
      email: 'alex.morgan@example.com',
      phone: '+44 7700 900123',
      location: 'Manchester, UK',
      linkedin: 'linkedin.com/in/alexmorgan',
      github: 'github.com/alexmorgan',
      website: '',
      nationality: 'British',
      dateOfBirth: '',
      workPermit: 'Eligible to work in the UK; open to relocation within the EU',
      drivingLicence: 'B',
    },
    sections: [
      s('summary', {
        content:
          'Network engineer with 8 years of experience maintaining and automating fibre access networks for over 200,000 subscribers. Cut mean time to repair by 30% by building Python tooling for OTDR fault localisation, and led a six-person maintenance team through two network migrations. Looking to move into a network automation role.',
      }),
      s('experience', {
        items: [
          emptyItem({
            title: 'Senior Network Engineer',
            organization: 'Northwind Fibre',
            location: 'Manchester, UK',
            startDate: '2021-03',
            current: true,
            bullets: [
              'Lead a team of 6 engineers maintaining 4,000 km of FTTH network across the North West.',
              'Automated OTDR fault localisation with Python and Kafka, cutting mean time to repair by 30%.',
              'Coordinate vendors and field teams during major outages, keeping stakeholders updated through incident channels.',
            ],
            tags: ['Python', 'Kafka', 'PostgreSQL', 'Grafana'],
          }),
          emptyItem({
            title: 'Network Engineer',
            organization: 'Contoso Telecom',
            location: 'Leeds, UK',
            startDate: '2018-01',
            endDate: '2021-02',
            description: 'Field and NOC engineering for metro Ethernet and GPON networks.',
            bullets: ['Built Grafana dashboards tracking fibre cuts and repair SLAs for 200k subscribers.', 'Responsible for weekly preventive maintenance reports.'],
            tags: ['Grafana', 'SQL'],
          }),
        ],
      }),
      s('education', {
        items: [
          emptyItem({
            title: 'BEng Electronic and Communications Engineering',
            organization: 'University of Leeds',
            location: 'Leeds, UK',
            startDate: '2013-09',
            endDate: '2017-06',
            grade: 'First Class Honours',
          }),
        ],
      }),
      s('skills', {
        items: [
          emptyItem({ title: 'Networking', tags: ['FTTH', 'GPON', 'OTDR', 'BGP', 'OSPF'] }),
          emptyItem({ title: 'Automation & data', tags: ['Python', 'Kafka', 'PostgreSQL', 'Grafana'] }),
          emptyItem({ title: 'Web', tags: ['Django', 'FastAPI', 'React'] }),
        ],
      }),
      s('certifications', {
        items: [emptyItem({ title: 'Certified Fiber Optic Technician (CFOT)', organization: 'Fiber Optic Association', date: '2021' })],
      }),
      s('languages', {
        items: [emptyItem({ title: 'English', level: 'Native' }), emptyItem({ title: 'German', level: 'B1 – Intermediate' })],
      }),
    ],
    design: { template: 'international', fontFamily: null, fontSize: 10.5, accentColor: '#1F3864', pageSize: 'A4' },
    target: { role: '', jobDescription: '' },
  }
}
