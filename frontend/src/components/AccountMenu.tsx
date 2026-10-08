import { KeyRound, LogOut, Trash2, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { useSession } from '../session'
import { useStore } from '../store'
import { Modal, Popover, Spinner } from './ui'

/** Avatar button with account actions (hidden when the server runs without accounts). */
export function AccountMenu() {
  const { user, authEnabled, signedOut } = useSession()
  const { saveNow, toast } = useStore()
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'password' | 'delete' | null>(null)
  if (!authEnabled) return null

  const initials = (user.name || user.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

  const logout = async () => {
    setOpen(false)
    await saveNow() // don't lose the last keystrokes
    try {
      await api.logout()
    } finally {
      signedOut()
    }
  }

  return (
    <div className="popover-anchor account-anchor">
      <button type="button" className="avatar-btn" data-popover-trigger aria-label="Account" title={user.email} onClick={() => setOpen(!open)}>
        {initials || <UserRound size={16} />}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="menu account-pop">
        <div className="account-head">
          <strong>{user.name || 'Your account'}</strong>
          <span className="muted small">{user.email}</span>
        </div>
        <hr />
        <button type="button" className="menu-item" onClick={() => (setOpen(false), setDialog('password'))}>
          <KeyRound size={15} /> Change password
        </button>
        <button type="button" className="menu-item" onClick={logout}>
          <LogOut size={15} /> Log out
        </button>
        <hr />
        <button type="button" className="menu-item danger" onClick={() => (setOpen(false), setDialog('delete'))}>
          <Trash2 size={15} /> Delete account…
        </button>
      </Popover>

      <PasswordDialog open={dialog === 'password'} onClose={() => setDialog(null)} onDone={() => (setDialog(null), toast('Password changed. Other devices were signed out.', 'success'))} />
      <DeleteDialog open={dialog === 'delete'} onClose={() => setDialog(null)} onDone={() => signedOut({ wipeLocal: true, message: 'Your account and all its CVs were deleted.' })} />
    </div>
  )
}

function PasswordDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (next.length < 8) return setError('New password must be at least 8 characters.')
    setBusy(true)
    try {
      await api.changePassword(current, next)
      setCurrent('')
      setNext('')
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Change password">
      <form className="dialog-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Current password</span>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">New password</span>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" />
        </label>
        {error && <p className="status err">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !current || !next}>
            {busy && <Spinner />} Change password
          </button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.deleteAccount(password)
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Delete account">
      <form className="dialog-form" onSubmit={submit}>
        <p>This permanently deletes your account and <strong>all your saved CVs</strong>. Export any CV you want to keep first (⋯ → Export this CV as JSON).</p>
        <label className="field">
          <span className="field-label">Confirm with your password</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        {error && <p className="status err">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn danger" disabled={busy || !password}>
            {busy && <Spinner />} Delete my account
          </button>
        </div>
      </form>
    </Modal>
  )
}
