import { useCallback, useState } from 'react'
import { api } from './api'
import { useStore } from './store'
import type { AiResult, AiTask, GenerateOptions } from './types'

const DEFAULTS: GenerateOptions = { length: 'medium', tone: 'professional', language: 'English', instructions: '' }

/** Wraps an AI call with readiness checks, a busy flag and error toasts. */
export function useAI() {
  const { ai, aiReady, openAISettings, toast, cv } = useStore()
  const [busy, setBusy] = useState(false)
  const provider = ai.providers[ai.active]

  const ensureReady = useCallback(() => {
    if (!aiReady) {
      toast('Connect an AI provider first (API key + model).', 'info')
      openAISettings(true)
      return false
    }
    return true
  }, [aiReady, openAISettings, toast])

  const run = useCallback(
    async <T extends AiTask>(task: T, options: Partial<GenerateOptions> = {}): Promise<AiResult<T> | null> => {
      if (!ensureReady()) return null
      setBusy(true)
      try {
        return lowQuotaNotice(await api.generate(task, ai.active, provider, cv, { ...DEFAULTS, ...options }))
      } catch (e) {
        toast((e as Error).message, 'error')
        return null
      } finally {
        setBusy(false)
      }
    },
    [ensureReady, ai.active, provider, cv, toast],
  )

  function lowQuotaNotice<T extends { remaining: number | null }>(res: T): T {
    if (res.remaining !== null && res.remaining <= 5) {
      toast(
        res.remaining === 0
          ? 'That was your last AI generation on the shared key today. Add your own key in AI settings to keep going.'
          : `${res.remaining} AI generation${res.remaining === 1 ? '' : 's'} left today on the shared key.`,
        'info',
      )
    }
    return res
  }

  return {
    busy,
    summary: (o: GenerateOptions) => run('summary', o),
    bullets: (o: GenerateOptions) => run('bullets', o),
    tailor: (o?: Partial<GenerateOptions>) => run('tailor', o),
    skills: (o?: Partial<GenerateOptions>) => run('skills', o),
    letter: (o?: Partial<GenerateOptions>) => run('letter', o),
    linkedin: (o?: Partial<GenerateOptions>) => run('linkedin', o),
  }
}
