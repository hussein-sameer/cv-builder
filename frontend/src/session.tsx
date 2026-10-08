import { Eye, EyeOff, LogIn, UserPlus } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError } from './api'
import { Spinner } from './components/ui'
import { clearUserLocalData, setStorageUser } from './storage'
import type { AuthConfig, SessionUser } from './types'

interface Session {
  user: SessionUser
  authEnabled: boolean
  /** Call after the server session is gone (logout, account deleted, expiry). */
  signedOut: (opts?: { wipeLocal?: boolean; message?: string }) => void
}

const SessionCtx = createContext<Session | null>(null)

export function useSession(): Session {
  const s = useContext(SessionCtx)
  if (!s) throw new Error('useSession outside AuthGate')
  return s
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'anon'; config: AuthConfig; notice?: string }
  | { kind: 'in'; user: SessionUser; authEnabled: boolean }

/** Shows the login / sign-up screen until there is a session, then renders the app for that user. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  const toAnon = useCallback(async (notice?: string) => {
    try {
      setState({ kind: 'anon', config: await api.authConfig(), notice })
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message })
    }
  }, [])

  const enter = (user: SessionUser, authEnabled: boolean) => {
    setStorageUser(user.id)
    setState({ kind: 'in', user, authEnabled })
  }

  useEffect(() => {
    api
      .me()
      .then((r) => enter(r.user, r.authEnabled))
      .catch((e) => (e instanceof ApiError && e.status === 401 ? toAnon() : setState({ kind: 'error', message: (e as Error).message })))
  }, [toAnon])

  const signedOut = useCallback(
    (opts: { wipeLocal?: boolean; message?: string } = {}) => {
      clearUserLocalData(opts.wipeLocal)
      void toAnon(opts.message)
    },
    [toAnon],
  )

  useEffect(() => {
    const onUnauthorized = () => {
      setState((s) => (s.kind === 'in' && s.authEnabled ? { kind: 'loading' } : s))
      void toAnon('Your session ended. Please log in again.')
    }
    window.addEventListener('cv:unauthorized', onUnauthorized)
    return () => window.removeEventListener('cv:unauthorized', onUnauthorized)
  }, [toAnon])

  if (state.kind === 'loading') return <div className="auth-shell"><Spinner size={22} /></div>
  if (state.kind === 'error')
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>CV Builder</h1>
          <p className="status err">{state.message}</p>
          <button type="button" className="btn primary" onClick={() => location.reload()}>
            Retry
          </button>
        </div>
      </div>
    )
  if (state.kind === 'anon') return <AuthScreen config={state.config} notice={state.notice} onIn={(u) => enter(u, true)} />
  return (
    <SessionCtx.Provider value={{ user: state.user, authEnabled: state.authEnabled, signedOut }}>
      <div key={state.user.id} style={{ display: 'contents' }}>
        {children}
      </div>
    </SessionCtx.Provider>
  )
}

function AuthScreen({ config, notice, onIn }: { config: AuthConfig; notice?: string; onIn: (u: SessionUser) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (mode === 'signup' && password.length < 8) return setError('Password must be at least 8 characters.')
    setBusy(true)
    try {
      onIn(mode === 'login' ? await api.login(email, password) : await api.signup(email, password, name))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const switchTo = (m: 'login' | 'signup') => {
    setMode(m)
    setError('')
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="auth-brand">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <div>
            <h1>
              <span className="brand-cv">CV</span> Builder
            </h1>
            <p className="muted small">ATS-friendly CVs in DOCX and PDF, with an AI writing helper</p>
          </div>
        </div>

        {config.signupEnabled && (
          <div className="segmented auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchTo('login')}>
              Log in
            </button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => switchTo('signup')}>
              Create account
            </button>
          </div>
        )}

        {notice && !error && <p className="status info">{notice}</p>}

        {mode === 'signup' && (
          <label className="field">
            <span className="field-label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" maxLength={100} />
          </label>
        )}
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <div className="input-with-btn">
            <input
              className="input"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
              required
            />
            <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        {error && <p className="status err" role="alert">{error}</p>}

        <button type="submit" className="btn primary block" disabled={busy || !email || !password}>
          {busy ? <Spinner /> : mode === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>

        {mode === 'login' && <p className="muted small center">Forgot your password? Ask the site admin to reset it.</p>}
        {!config.signupEnabled && <p className="muted small center">New accounts are created by the admin.</p>}
      </form>
    </div>
  )
}
