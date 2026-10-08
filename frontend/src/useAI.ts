import { useCallback, useState } from 'react'
import { api } from './api'
import { useStore } from './store'
import type { GenerateOptions } from './types'

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

  const summary = useCallback(
    async (options: GenerateOptions) => {
      if (!ensureReady()) return null
      setBusy(true)
      try {
        return lowQuotaNotice(await api.generateSummary(ai.active, provider, cv, options))
      } catch (e) {
        toast((e as Error).message, 'error')
        return null
      } finally {
        setBusy(false)
      }
    },
    [ensureReady, ai.active, provider, cv, toast],
  )

  const bullets = useCallback(
    async (options: GenerateOptions) => {
      if (!ensureReady()) return null
      setBusy(true)
      try {
        return lowQuotaNotice(await api.generateBullets(ai.active, provider, cv, options))
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

  return { busy, summary, bullets }
}
