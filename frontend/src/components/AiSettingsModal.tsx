import { CheckCircle2, Eye, EyeOff, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { savedKeyFor, useStore } from '../store'
import type { AISettings, ProviderInfo, ProviderType, SavedKey } from '../types'
import { Field, TextInput } from './fields'
import { ConfirmDelete, Modal, Spinner } from './ui'

const FALLBACK: ProviderInfo[] = [
  { type: 'openai', label: 'OpenAI-compatible', hint: 'OpenAI, OpenRouter, Groq, DeepSeek, LM Studio…', needsKey: true, presets: [], defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: '', serverKey: false },
  { type: 'anthropic', label: 'Anthropic (Claude)', hint: '', needsKey: true, presets: [], defaultBaseUrl: 'https://api.anthropic.com', defaultModel: '', serverKey: false },
  { type: 'gemini', label: 'Google Gemini', hint: '', needsKey: true, presets: [], defaultBaseUrl: 'https://generativelanguage.googleapis.com', defaultModel: '', serverKey: false },
  { type: 'ollama', label: 'Ollama (local)', hint: '', needsKey: false, presets: [], defaultBaseUrl: 'http://localhost:11434', defaultModel: '', serverKey: false },
]

const MODEL_HINT = 'Type a model ID or click “Load models”'

export function AiSettingsModal() {
  const { ai, setAI, aiConfig, savedKeys, setSavedKeys, aiModalOpen, openAISettings, toast } = useStore()
  const [draft, setDraft] = useState<AISettings>(ai)
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [advanced, setAdvanced] = useState(false)

  useEffect(() => {
    if (aiModalOpen) {
      setDraft(ai)
      setStatus(null)
    }
  }, [aiModalOpen, ai])

  const providers = aiConfig?.providers ?? FALLBACK
  const info = providers.find((p) => p.type === draft.active) ?? FALLBACK[0]
  const p = draft.providers[draft.active]
  const setP = (patch: Partial<typeof p>) =>
    setDraft({ ...draft, providers: { ...draft.providers, [draft.active]: { ...p, ...patch } } })
  const accountKeys = !!aiConfig?.keyStorage
  const saved = savedKeyFor(savedKeys, draft.active, p, info)
  const infoFor = (t: ProviderType) => providers.find((x) => x.type === t)

  const loadModels = async () => {
    setLoading(true)
    setStatus(null)
    try {
      const list = await api.models(draft.active, p)
      setModels({ ...models, [draft.active]: list })
      setStatus({ ok: true, text: `Connected · ${list.length} model${list.length === 1 ? '' : 's'} available` })
      if (!p.model && list.length) setP({ model: list[0] })
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }

  const removeKey = async (k: SavedKey) => {
    try {
      await api.deleteAIKey(k.id)
      setSavedKeys(savedKeys.filter((x) => x.id !== k.id))
      toast('Saved key removed from your account', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const save = async () => {
    const next: AISettings = structuredClone(draft)
    if (accountKeys) {
      next.remember = false // keys live on the account or in this tab, never in localStorage
      if (next.keysInAccount) {
        // move every typed key to the account, bound to the endpoint it was typed for
        let keys = savedKeys
        setSaving(true)
        try {
          for (const t of Object.keys(next.providers) as ProviderType[]) {
            const pr = next.providers[t]
            if (!pr.apiKey.trim()) continue
            const rec = await api.saveAIKey(t, pr.baseUrl, pr.apiKey)
            keys = [...keys.filter((k) => k.id !== rec.id), rec]
            pr.apiKey = ''
          }
        } catch (e) {
          setStatus({ ok: false, text: `Couldn't save your key: ${(e as Error).message}` })
          return
        } finally {
          setSaving(false)
          setSavedKeys(keys)
        }
      }
    }
    setAI(next)
    openAISettings(false)
    toast(`AI provider set to ${info.label}${p.model ? ` · ${p.model}` : ''}`, 'success')
  }

  const showBaseUrl = draft.active === 'openai' || draft.active === 'ollama' || advanced
  const listId = `models-${draft.active}`

  return (
    <Modal
      open={aiModalOpen}
      onClose={() => openAISettings(false)}
      title="AI settings"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => openAISettings(false)}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner />} Save
          </button>
        </>
      }
    >
      <div className="provider-tabs" role="tablist">
        {providers.map((pr) => (
          <button
            type="button"
            role="tab"
            key={pr.type}
            aria-selected={draft.active === pr.type}
            className={`provider-tab ${draft.active === pr.type ? 'active' : ''}`}
            onClick={() => {
              setDraft({ ...draft, active: pr.type })
              setStatus(null)
              setAdvanced(false)
            }}
          >
            <strong>{pr.label}</strong>
            {(draft.providers[pr.type].apiKey || savedKeyFor(savedKeys, pr.type, draft.providers[pr.type], pr) || pr.serverKey || !pr.needsKey) &&
            (draft.providers[pr.type].model || pr.defaultModel) ? (
              <small className="ok">● configured</small>
            ) : (
              <small>not set</small>
            )}
          </button>
        ))}
      </div>

      {info.hint && <p className="muted small">{info.hint}</p>}
      {draft.active === 'ollama' && aiConfig && !aiConfig.allowPrivateBaseUrls && (
        <p className="status err">Local models aren't reachable from this hosted server. Run CV Builder on your own computer to use Ollama.</p>
      )}
      {info.serverKey && !!aiConfig?.dailyLimit && (
        <p className="status info">
          This server shares its {info.label} key: {aiConfig.dailyLimit} AI generations per person per day. Paste your own key for unlimited use.
        </p>
      )}

      <div className="grid">
        {draft.active === 'openai' && info.presets.length > 0 && (
          <Field label="Preset" span={2}>
            <select
              className="input"
              value={!p.baseUrl ? '__default' : (info.presets.find((x) => x.baseUrl === p.baseUrl)?.baseUrl ?? '__custom')}
              onChange={(e) => {
                const v = e.target.value
                if (v === '__default') setP({ baseUrl: '' })
                else if (v !== '__custom') setP({ baseUrl: v })
              }}
            >
              <option value="__default">Server default ({info.defaultBaseUrl.replace(/^https?:\/\//, '')}){info.serverKey ? ' – shared key' : ''}</option>
              {info.presets.map((x) => (
                <option key={x.baseUrl} value={x.baseUrl}>
                  {x.name}
                </option>
              ))}
              <option value="__custom">Custom URL…</option>
            </select>
          </Field>
        )}
        {showBaseUrl && (
          <Field label="Base URL" span={2} hint={draft.active === 'ollama' ? 'Running the app in Docker? Use http://host.docker.internal:11434' : undefined}>
            <TextInput value={p.baseUrl} onChange={(v) => setP({ baseUrl: v })} placeholder={info.defaultBaseUrl} />
          </Field>
        )}
        {info.needsKey && (
          <Field
            label="API key"
            span={2}
            hint={
              saved
                ? `Saved to your account (${saved.hint}). Leave empty to use it, or paste a new key to replace it.`
                : info.serverKey
                  ? 'A key is configured on the server — leave empty to use it.'
                  : undefined
            }
          >
            <div className="input-with-btn">
              <TextInput
                type={showKey ? 'text' : 'password'}
                value={p.apiKey}
                onChange={(v) => setP({ apiKey: v.trim() })}
                placeholder={saved ? `Using your saved key ${saved.hint}` : info.serverKey ? 'Using server key' : 'Paste your API key'}
              />
              <button type="button" className="icon-btn" aria-label={showKey ? 'Hide key' : 'Show key'} onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              {saved && <ConfirmDelete title="Remove saved key" onConfirm={() => void removeKey(saved)} />}
            </div>
          </Field>
        )}
        <Field label="Model" span={2}>
          <div className="input-with-btn">
            <TextInput value={p.model} onChange={(v) => setP({ model: v })} placeholder={info.defaultModel || MODEL_HINT} list={listId} />
            <button type="button" className="btn sm" onClick={loadModels} disabled={loading}>
              {loading ? <Spinner /> : <RefreshCw size={14} />} Load models
            </button>
          </div>
          <datalist id={listId}>
            {(models[draft.active] ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="Creativity">
          <select className="input" value={p.temperature ?? ''} onChange={(e) => setP({ temperature: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">Model default</option>
            <option value="0.2">Low (0.2) – most factual</option>
            <option value="0.5">Medium (0.5)</option>
            <option value="0.8">High (0.8)</option>
          </select>
        </Field>
        {!showBaseUrl && (
          <div className="field">
            <span className="field-label">&nbsp;</span>
            <button type="button" className="link-btn" onClick={() => setAdvanced(true)}>
              Custom base URL…
            </button>
          </div>
        )}
      </div>

      {status && (
        <p className={`status ${status.ok ? 'ok' : 'err'}`}>
          {status.ok && <CheckCircle2 size={15} />} {status.text}
        </p>
      )}

      {accountKeys ? (
        <label className="check">
          <input type="checkbox" checked={draft.keysInAccount} onChange={(e) => setDraft({ ...draft, keysInAccount: e.target.checked })} />
          Save API keys to my account, so they work on any device
        </label>
      ) : (
        <label className="check">
          <input type="checkbox" checked={draft.remember} onChange={(e) => setDraft({ ...draft, remember: e.target.checked })} />
          Remember API keys on this device
        </label>
      )}
      {savedKeys.length > 0 && (
        <div className="saved-keys">
          <span className="field-label">Keys saved to your account</span>
          <ul>
            {savedKeys.map((k) => (
              <li key={k.id}>
                <span>
                  {infoFor(k.provider)?.label ?? k.provider} · <span className="muted">{k.baseUrl.replace(/^https?:\/\//, '')}</span>
                </span>
                <code>{k.hint}</code>
                <ConfirmDelete title="Remove saved key" size={14} onConfirm={() => void removeKey(k)} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="privacy">
        <ShieldCheck size={15} />
        <span>
          {accountKeys && draft.keysInAccount
            ? 'Saved keys are encrypted on your CV Builder server and tied to your account. Each one is only ever sent to the endpoint it was saved for, and is never shown again (just its last 4 characters).'
            : accountKeys
              ? 'Keys go only to your own CV Builder server, which forwards them to the provider and never stores or logs them. They are kept for this browser tab only.'
              : 'Keys go only to your own CV Builder server, which forwards them to the provider and never stores or logs them. Unless “Remember” is ticked they are kept for this browser tab only.'}
        </span>
      </p>
    </Modal>
  )
}
