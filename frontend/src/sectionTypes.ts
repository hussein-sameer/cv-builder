import {
  Award,
  BookOpen,
  Briefcase,
  FileText,
  FolderGit2,
  GraduationCap,
  HandHeart,
  Heart,
  Languages,
  LayoutList,
  Library,
  type LucideIcon,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Wrench,
} from 'lucide-react'
import type { Item, SectionType } from './types'

export type FieldKind = 'text' | 'textarea' | 'dateRange' | 'date' | 'bullets' | 'tags' | 'level' | 'url'

export interface FieldSpec {
  key: keyof Item | 'dateRange'
  label: string
  kind: FieldKind
  placeholder?: string
  span?: 1 | 2
  currentLabel?: string
}

export type SectionKind = 'text' | 'entries' | 'groups' | 'languages' | 'lines'

export interface SectionTypeDef {
  type: SectionType
  label: string
  description: string
  icon: LucideIcon
  kind: SectionKind
  fields: FieldSpec[]
  addLabel: string
  multiple: boolean
  aiBullets?: boolean
  tip?: string
  textPlaceholder?: string
  defaultContent?: string
}

const range = (currentLabel: string): FieldSpec => ({ key: 'dateRange', label: 'Dates', kind: 'dateRange', span: 2, currentLabel })

export const SECTION_TYPES: Record<SectionType, SectionTypeDef> = {
  summary: {
    type: 'summary',
    label: 'Summary / Profile',
    description: '3–5 lines on who you are and what you bring',
    icon: Sparkles,
    kind: 'text',
    fields: [],
    addLabel: '',
    multiple: false,
    tip: 'Keep it to 3–6 lines: your role, years of experience, top skills and 1–2 proven achievements. Use the AI button to draft it from the rest of your CV.',
    textPlaceholder:
      'e.g. Network engineer with 6 years of experience running FTTH access networks. Cut mean time to repair by 30% by automating fault triage with Python…',
  },
  experience: {
    type: 'experience',
    label: 'Work experience',
    description: 'Jobs, internships, contracts',
    icon: Briefcase,
    kind: 'entries',
    addLabel: 'position',
    multiple: true,
    aiBullets: true,
    tip: 'Most recent first. Start bullets with an action verb and add numbers where you have them (team size, users, %, time saved).',
    fields: [
      { key: 'title', label: 'Job title', kind: 'text', placeholder: 'Senior Network Engineer' },
      { key: 'organization', label: 'Company', kind: 'text', placeholder: 'Acme Telecom' },
      { key: 'location', label: 'Location', kind: 'text', placeholder: 'Baghdad, Iraq', span: 2 },
      range('I currently work here'),
      { key: 'description', label: 'Short description (optional)', kind: 'textarea', placeholder: 'One line of context: team, scope, product…', span: 2 },
      { key: 'bullets', label: 'Achievements & responsibilities', kind: 'bullets', placeholder: 'Automated fault triage with Python, cutting repair time by 30%', span: 2 },
      { key: 'tags', label: 'Tools & technologies', kind: 'tags', placeholder: 'Python, Grafana… (Enter to add)', span: 2 },
    ],
  },
  education: {
    type: 'education',
    label: 'Education',
    description: 'Degrees, diplomas, schools',
    icon: GraduationCap,
    kind: 'entries',
    addLabel: 'education',
    multiple: true,
    fields: [
      { key: 'title', label: 'Degree / qualification', kind: 'text', placeholder: 'B.Sc. Electronics & Communications Engineering' },
      { key: 'organization', label: 'School / university', kind: 'text', placeholder: 'University name' },
      { key: 'location', label: 'Location', kind: 'text', placeholder: 'City, Country' },
      { key: 'grade', label: 'Grade / honours', kind: 'text', placeholder: 'GPA 3.8/4.0 · First in class' },
      range('Currently studying'),
      { key: 'bullets', label: 'Highlights (optional)', kind: 'bullets', placeholder: 'Thesis: …', span: 2 },
    ],
  },
  skills: {
    type: 'skills',
    label: 'Skills',
    description: 'Grouped skills and keywords',
    icon: Wrench,
    kind: 'groups',
    addLabel: 'skill group',
    multiple: true,
    tip: 'Group skills (e.g. Programming, Networking, Tools). Only list what you can talk about in an interview.',
    fields: [
      { key: 'title', label: 'Category', kind: 'text', placeholder: 'e.g. Programming' },
      { key: 'tags', label: 'Skills', kind: 'tags', placeholder: 'Type a skill and press Enter' },
    ],
  },
  languages: {
    type: 'languages',
    label: 'Languages',
    description: 'Spoken languages with level',
    icon: Languages,
    kind: 'languages',
    addLabel: 'language',
    multiple: false,
    tip: 'EU employers expect CEFR levels (A1–C2).',
    fields: [
      { key: 'title', label: 'Language', kind: 'text', placeholder: 'English' },
      { key: 'level', label: 'Level', kind: 'level', placeholder: 'C1 – Advanced' },
    ],
  },
  certifications: {
    type: 'certifications',
    label: 'Certifications',
    description: 'Licences and certificates',
    icon: ShieldCheck,
    kind: 'lines',
    addLabel: 'certification',
    multiple: false,
    fields: [
      { key: 'title', label: 'Certificate', kind: 'text', placeholder: 'AWS Certified Solutions Architect – Associate' },
      { key: 'organization', label: 'Issuer', kind: 'text', placeholder: 'Amazon Web Services' },
      { key: 'date', label: 'Date', kind: 'date' },
      { key: 'link', label: 'Credential URL (optional)', kind: 'url', placeholder: 'credly.com/…' },
    ],
  },
  projects: {
    type: 'projects',
    label: 'Projects',
    description: 'Personal, academic or open-source work',
    icon: FolderGit2,
    kind: 'entries',
    addLabel: 'project',
    multiple: false,
    aiBullets: true,
    fields: [
      { key: 'title', label: 'Project name', kind: 'text', placeholder: 'Outage analytics pipeline' },
      { key: 'organization', label: 'Role / context', kind: 'text', placeholder: 'Personal project · Lead developer' },
      { key: 'link', label: 'Link', kind: 'url', placeholder: 'github.com/you/project', span: 2 },
      range('Ongoing'),
      { key: 'description', label: 'Description', kind: 'textarea', placeholder: 'What it does and why', span: 2 },
      { key: 'bullets', label: 'Highlights', kind: 'bullets', placeholder: 'Processed 1M events/day with Kafka', span: 2 },
      { key: 'tags', label: 'Technologies', kind: 'tags', placeholder: 'FastAPI, React…', span: 2 },
    ],
  },
  volunteering: {
    type: 'volunteering',
    label: 'Volunteering',
    description: 'Unpaid roles and community work',
    icon: HandHeart,
    kind: 'entries',
    addLabel: 'role',
    multiple: false,
    aiBullets: true,
    fields: [
      { key: 'title', label: 'Role', kind: 'text', placeholder: 'Mentor' },
      { key: 'organization', label: 'Organisation', kind: 'text', placeholder: 'Code Club' },
      { key: 'location', label: 'Location', kind: 'text', span: 2 },
      range('Ongoing'),
      { key: 'bullets', label: 'What you did', kind: 'bullets', span: 2 },
    ],
  },
  awards: {
    type: 'awards',
    label: 'Awards',
    description: 'Honours, prizes, scholarships',
    icon: Award,
    kind: 'lines',
    addLabel: 'award',
    multiple: false,
    fields: [
      { key: 'title', label: 'Award', kind: 'text', placeholder: 'Employee of the Year' },
      { key: 'organization', label: 'Awarded by', kind: 'text' },
      { key: 'date', label: 'Date', kind: 'date' },
      { key: 'description', label: 'Note (optional)', kind: 'textarea', span: 2 },
    ],
  },
  publications: {
    type: 'publications',
    label: 'Publications',
    description: 'Papers, articles, talks',
    icon: BookOpen,
    kind: 'lines',
    addLabel: 'publication',
    multiple: false,
    fields: [
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'organization', label: 'Publisher / venue', kind: 'text' },
      { key: 'date', label: 'Date', kind: 'date' },
      { key: 'link', label: 'Link', kind: 'url' },
      { key: 'description', label: 'Note (optional)', kind: 'textarea', span: 2 },
    ],
  },
  courses: {
    type: 'courses',
    label: 'Courses & training',
    description: 'Online courses, bootcamps, workshops',
    icon: Library,
    kind: 'lines',
    addLabel: 'course',
    multiple: false,
    fields: [
      { key: 'title', label: 'Course', kind: 'text', placeholder: 'Deep Learning Specialization' },
      { key: 'organization', label: 'Provider', kind: 'text', placeholder: 'Coursera' },
      { key: 'date', label: 'Date', kind: 'date' },
      { key: 'link', label: 'Link (optional)', kind: 'url' },
    ],
  },
  interests: {
    type: 'interests',
    label: 'Interests',
    description: 'Hobbies that add to your story',
    icon: Heart,
    kind: 'text',
    fields: [],
    addLabel: '',
    multiple: false,
    textPlaceholder: 'Home automation (ESP8266, MQTT), long-distance running, chess',
  },
  references: {
    type: 'references',
    label: 'References',
    description: '"Available upon request" or contacts',
    icon: UserCheck,
    kind: 'text',
    fields: [],
    addLabel: '',
    multiple: false,
    defaultContent: 'Available upon request.',
  },
  custom: {
    type: 'custom',
    label: 'Custom (entries)',
    description: 'Your own section with dated entries',
    icon: LayoutList,
    kind: 'entries',
    addLabel: 'entry',
    multiple: true,
    aiBullets: true,
    fields: [
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'organization', label: 'Subtitle / organisation', kind: 'text' },
      { key: 'location', label: 'Location', kind: 'text', span: 2 },
      range('Ongoing'),
      { key: 'description', label: 'Description', kind: 'textarea', span: 2 },
      { key: 'bullets', label: 'Bullets', kind: 'bullets', span: 2 },
    ],
  },
  customText: {
    type: 'customText',
    label: 'Custom (free text)',
    description: 'A heading with a paragraph',
    icon: FileText,
    kind: 'text',
    fields: [],
    addLabel: '',
    multiple: true,
  },
}

export const ADDABLE_ORDER: SectionType[] = [
  'summary',
  'experience',
  'education',
  'skills',
  'languages',
  'certifications',
  'projects',
  'courses',
  'volunteering',
  'awards',
  'publications',
  'interests',
  'references',
  'custom',
  'customText',
]

export const CEFR_LEVELS = [
  'Native',
  'C2 – Proficient',
  'C1 – Advanced',
  'B2 – Upper intermediate',
  'B1 – Intermediate',
  'A2 – Elementary',
  'A1 – Beginner',
  'Fluent',
  'Professional working proficiency',
  'Basic',
]
