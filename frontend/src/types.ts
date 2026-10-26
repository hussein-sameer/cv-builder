export type SectionType =
  | 'summary'
  | 'experience'
  | 'education'
  | 'skills'
  | 'languages'
  | 'certifications'
  | 'projects'
  | 'volunteering'
  | 'awards'
  | 'publications'
  | 'courses'
  | 'interests'
  | 'references'
  | 'custom'
  | 'customText'

export type TemplateKey = 'international' | 'europass'

export interface Item {
  id: string
  title: string
  organization: string
  location: string
  startDate: string
  endDate: string
  current: boolean
  date: string
  description: string
  bullets: string[]
  tags: string[]
  grade: string
  link: string
  level: string
}

export interface Section {
  id: string
  type: SectionType
  title: string
  visible: boolean
  content: string
  items: Item[]
}

export interface Personal {
  fullName: string
  headline: string
  email: string
  phone: string
  location: string
  linkedin: string
  github: string
  website: string
  nationality: string
  dateOfBirth: string
  workPermit: string
  drivingLicence: string
  /** optional photo as a JPEG data URL ("" = none); printed top right in both layouts */
  photo: string
}

export interface Design {
  template: TemplateKey
  fontFamily: string | null
  fontSize: number
  accentColor: string
  pageSize: 'A4' | 'Letter'
}

export interface Keyword {
  /** the posting's exact wording */
  term: string
  kind: 'must' | 'nice'
}

export interface Requirement {
  text: string
  kind: 'must' | 'nice'
  /** where the CV shows it; '' = it doesn't */
  evidence: string
}

/** The AI's recruiter read of the CV against the target job (backend models.JobReport). Never printed. */
export interface JobReport {
  estimate: number | null
  keywords: Keyword[]
  requirements: Requirement[]
  strengths: string[]
  gaps: string[]
  questions: string[]
  nextSteps: string[]
  model: string
  createdAt: string
  /** fingerprint of the role + job description it was made for (atsCheck.jobKey) */
  jobKey: string
}

export interface Target {
  role: string
  jobDescription: string
  report: JobReport | null
}

export interface CV {
  personal: Personal
  sections: Section[]
  design: Design
  target: Target
}

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'ollama'

export interface ProviderSettings {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number | null
}

export interface AISettings {
  active: ProviderType
  /** keep typed keys in localStorage (only offered when the server can't save keys to accounts) */
  remember: boolean
  /** save typed keys to the account on the server (encrypted) instead of this browser */
  keysInAccount: boolean
  providers: Record<ProviderType, ProviderSettings>
}

export interface ProviderInfo {
  type: ProviderType
  label: string
  hint: string
  needsKey: boolean
  presets: { name: string; baseUrl: string }[]
  defaultBaseUrl: string
  defaultModel: string
  serverKey: boolean
}

export interface AIConfig {
  defaultProvider: ProviderType
  allowCustomBaseUrls: boolean
  allowPrivateBaseUrls: boolean
  dailyLimit: number
  /** the server can save keys to accounts (SECRET_KEY set, or SQLite) */
  keyStorage: boolean
  providers: ProviderInfo[]
}

/** A key saved to the user's account. The key itself never comes back, only a hint. */
export interface SavedKey {
  id: string
  provider: ProviderType
  baseUrl: string
  hint: string
  updatedAt: string
}

export interface TemplateInfo {
  key: TemplateKey
  name: string
  description: string
  defaultFont: string
  headings: Record<string, string>
}

export type AiTask = 'summary' | 'bullets' | 'tailor' | 'skills'

export interface SkillGroup {
  title: string
  tags: string[]
}

/** What /api/ai/generate returns per task, plus the model used and the shared key's remaining count. */
export interface AiResults {
  summary: { text: string }
  bullets: { bullets: string[] }
  tailor: { report: JobReport }
  /** dropped: skills the model suggested that the CV doesn't show */
  skills: { groups: SkillGroup[]; dropped: string[] }
}
export type AiResult<T extends AiTask> = AiResults[T] & { model: string; remaining: number | null }

export interface GenerateOptions {
  length: 'short' | 'medium' | 'long'
  tone: 'professional' | 'confident' | 'warm' | 'technical'
  language: string
  instructions: string
  sectionId?: string
  itemId?: string
  allowPlaceholders?: boolean
}

export interface CvMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  headline: string
  targetRole: string
  template: TemplateKey
}

export interface CvRecord extends CvMeta {
  data: CV
}

export interface SessionUser {
  id: string
  email: string
  name: string
  isAdmin: boolean
  /** new account that hasn't finished or skipped the guided tour (stored on the account) */
  tourPending: boolean
}

export interface AuthConfig {
  authEnabled: boolean
  signupEnabled: boolean
}
