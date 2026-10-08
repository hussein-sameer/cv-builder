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

export interface Target {
  role: string
  jobDescription: string
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
