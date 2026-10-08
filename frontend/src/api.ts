import type { AIConfig, AuthConfig, CV, CvMeta, CvRecord, GenerateOptions, ProviderSettings, ProviderType, SavedKey, SessionUser, TemplateInfo } from './types'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  let msg = `${res.status} ${res.statusText}`
  try {
    const data = await res.json()
    if (typeof data.detail === 'string') msg = data.detail
    else if (Array.isArray(data.detail)) msg = data.detail.map((d: { msg: string }) => d.msg).join('; ')
  } catch {
    /* not JSON */
  }
  return new ApiError(msg, res.status)
}

async function request(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...init,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('Cannot reach the CV Builder server. Is the backend running?', 0)
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    // session expired or revoked: let the app show the login screen
    window.dispatchEvent(new CustomEvent('cv:unauthorized'))
  }
  if (!res.ok) throw await errorFrom(res)
  return res
}

const post = (path: string, body: unknown, signal?: AbortSignal) => request('POST', path, body, { signal })

async function getJSON<T>(path: string): Promise<T> {
  return (await request('GET', path)).json() as Promise<T>
}

export const api = {
  // ---- accounts
  authConfig: () => getJSON<AuthConfig>('/api/auth/config'),
  me: () => getJSON<{ user: SessionUser; authEnabled: boolean }>('/api/auth/me'),
  async signup(email: string, password: string, name: string): Promise<SessionUser> {
    return (await (await post('/api/auth/signup', { email, password, name })).json()).user
  },
  async login(email: string, password: string): Promise<SessionUser> {
    return (await (await post('/api/auth/login', { email, password })).json()).user
  },
  async logout(): Promise<void> {
    await post('/api/auth/logout', {})
  },
  async changePassword(current: string, next: string): Promise<void> {
    await post('/api/auth/password', { current, new: next })
  },
  async deleteAccount(password: string): Promise<void> {
    await post('/api/auth/delete-account', { password })
  },

  // ---- CV library
  listCVs: () => getJSON<CvMeta[]>('/api/cvs'),
  getCV: (id: string) => getJSON<CvRecord>(`/api/cvs/${encodeURIComponent(id)}`),
  async createCV(name: string, src: { data?: CV; sourceId?: string }): Promise<CvRecord> {
    return (await post('/api/cvs', { name, ...src })).json()
  },
  async updateCV(id: string, patch: { name?: string; data?: CV }, keepalive = false): Promise<CvMeta> {
    return (await request('PUT', `/api/cvs/${encodeURIComponent(id)}`, patch, { keepalive })).json()
  },
  async deleteCV(id: string): Promise<void> {
    await request('DELETE', `/api/cvs/${encodeURIComponent(id)}`)
  },

  // ---- meta / export / AI
  meta: () => getJSON<{ templates: TemplateInfo[]; pdfFonts: Record<string, string> }>('/api/meta'),
  aiConfig: () => getJSON<AIConfig>('/api/ai/config'),
  aiKeys: () => getJSON<SavedKey[]>('/api/ai/keys'),
  async saveAIKey(type: ProviderType, baseUrl: string, apiKey: string): Promise<SavedKey> {
    return (await request('PUT', '/api/ai/keys', { provider: { type, baseUrl, apiKey } })).json()
  },
  async deleteAIKey(id: string): Promise<void> {
    await request('DELETE', `/api/ai/keys/${encodeURIComponent(id)}`)
  },

  async previewPdf(cv: CV, signal?: AbortSignal): Promise<{ data: ArrayBuffer; pages: number }> {
    const res = await post('/api/export/pdf?inline=true', cv, signal)
    return { data: await res.arrayBuffer(), pages: Number(res.headers.get('X-Page-Count') ?? 0) }
  },

  async download(cv: CV, format: 'pdf' | 'docx', filename: string): Promise<void> {
    const res = await post(`/api/export/${format}`, cv)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  },

  async models(type: ProviderType, p: ProviderSettings): Promise<string[]> {
    const res = await post('/api/ai/models', { provider: { type, ...p } })
    return (await res.json()).models as string[]
  },

  async generateSummary(type: ProviderType, p: ProviderSettings, cv: CV, options: GenerateOptions) {
    const res = await post('/api/ai/generate', { provider: { type, ...p }, task: 'summary', cv, options })
    return (await res.json()) as { text: string; model: string; remaining: number | null }
  },

  async generateBullets(type: ProviderType, p: ProviderSettings, cv: CV, options: GenerateOptions) {
    const res = await post('/api/ai/generate', { provider: { type, ...p }, task: 'bullets', cv, options })
    return (await res.json()) as { bullets: string[]; model: string; remaining: number | null }
  },
}

export function fileName(cv: CV, ext: string): string {
  const name = cv.personal.fullName.trim().replace(/[^\p{L}\p{N}\- ]/gu, '').replace(/\s+/g, '_')
  return `${name ? name + '_CV' : 'CV'}.${ext}`
}
