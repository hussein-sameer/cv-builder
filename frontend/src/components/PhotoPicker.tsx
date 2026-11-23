import { Check, ImageOff, ImageUp, Settings2, Trash2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api'
import { photoFromFile } from '../photo'
import { useStore } from '../store'
import type { SavedPhoto } from '../types'
import { Modal, Spinner } from './ui'

export const MAX_PHOTOS = 3 // mirrors backend photos.MAX_PHOTOS

/**
 * Optional CV photo, chosen from the account's saved photos (up to MAX_PHOTOS, shared by all CVs) or "No photo".
 * The CV embeds a copy of the chosen one, so deleting a saved photo never changes a CV. Without server storage
 * (browser-only mode) there's no library: an upload goes straight into the CV, as before.
 */
export function PhotoField() {
  const { cv, mutate, toast, savedPhotos, setSavedPhotos } = useStore()
  const current = cv.personal.photo
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // the library dialog: `pending` is a new photo waiting for room ("full"), or none ("manage")
  const [dialog, setDialog] = useState<{ pending: string | null } | null>(null)

  const library = savedPhotos ?? []
  const unsaved = !!current && savedPhotos !== null && !library.some((ph) => ph.data === current)
  const use = (data: string) => mutate((d) => void (d.personal.photo = data))

  /** Save to the library (deleting replaceIds first) and use it on this CV. */
  const save = async (data: string, replaceIds: string[] = []) => {
    setBusy(true)
    try {
      const saved = await api.savePhoto(data, replaceIds)
      setSavedPhotos([...library.filter((ph) => ph.id !== saved.id && !replaceIds.includes(ph.id)), saved])
      use(saved.data)
      setDialog(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // filled up in another tab: show what's there now and let the user pick what to delete
        setSavedPhotos(await api.photos().catch(() => library))
        setDialog({ pending: data })
      } else toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** Put a photo on this CV, saving it to the library when there's room (else ask what to delete). */
  const keep = async (data: string) => {
    if (savedPhotos === null || library.some((ph) => ph.data === data)) use(data) // no library here, or already saved
    else if (library.length >= MAX_PHOTOS) setDialog({ pending: data })
    else await save(data)
  }

  const upload = async (file: File) => {
    if (fileRef.current) fileRef.current.value = '' // let the same file be picked again
    setBusy(true)
    try {
      await keep(await photoFromFile(file))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeSaved = async (ids: string[]) => {
    setBusy(true)
    const results = await Promise.allSettled(ids.map((id) => api.deletePhoto(id)))
    const gone = ids.filter((_, i) => {
      const r = results[i]
      return r.status === 'fulfilled' || (r.reason instanceof ApiError && r.reason.status === 404) // 404: already gone
    })
    setSavedPhotos(library.filter((ph) => !gone.includes(ph.id)))
    if (gone.length < ids.length) toast("Couldn't delete every photo. Try again.", 'error')
    setBusy(false)
    if (gone.length === ids.length) setDialog(null)
  }

  return (
    <div className="field span-2">
      <span className="field-label" id="photo-label">
        Photo (optional)
      </span>
      <div className="photo-picker" role="radiogroup" aria-labelledby="photo-label">
        <PhotoTile selected={!current} onClick={() => use('')} label="No photo">
          <ImageOff size={20} aria-hidden />
          <span className="photo-tile-caption">No photo</span>
        </PhotoTile>
        {library.map((ph, i) => (
          <PhotoTile key={ph.id} selected={ph.data === current} onClick={() => use(ph.data)} label={`Saved photo ${i + 1}`}>
            <img src={ph.data} alt="" />
          </PhotoTile>
        ))}
        {(unsaved || (savedPhotos === null && current)) && (
          <PhotoTile selected onClick={() => undefined} label="Photo on this CV">
            <img src={current} alt="" />
            {unsaved && <span className="photo-tile-badge">Not saved</span>}
          </PhotoTile>
        )}
        <button type="button" className="photo-tile add" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Upload a photo">
          {busy ? <Spinner size={18} /> : <ImageUp size={20} aria-hidden />}
          <span className="photo-tile-caption">Upload</span>
        </button>
      </div>
      <span className="field-hint">
        Printed at the top right of the CV, cropped to passport shape: use a head-and-shoulders photo.
        {savedPhotos !== null && ` Up to ${MAX_PHOTOS} photos are kept in your account for all your CVs; pick one for this CV or No photo.`}
      </span>
      {(unsaved || library.length > 0) && (
        <div className="photo-links">
          {unsaved && (
            <button type="button" className="btn sm ghost" onClick={() => void keep(current)} disabled={busy}>
              <ImageUp size={14} /> Save this photo to my photos
            </button>
          )}
          {library.length > 0 && (
            <button type="button" className="btn sm ghost" onClick={() => setDialog({ pending: null })} disabled={busy}>
              <Settings2 size={14} /> Manage photos
            </button>
          )}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      {dialog && (
        <PhotoLibraryModal
          photos={library}
          current={current}
          pending={dialog.pending}
          busy={busy}
          onClose={() => setDialog(null)}
          onDelete={(ids) => void removeSaved(ids)}
          onReplace={(ids) => dialog.pending && void save(dialog.pending, ids)}
          onUseOnce={() => {
            if (dialog.pending) use(dialog.pending)
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}

function PhotoTile({ selected, onClick, label, children }: { selected: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={label} className={`photo-tile${selected ? ' selected' : ''}`} onClick={onClick}>
      {children}
      {selected && (
        <span className="photo-tile-check" aria-hidden>
          <Check size={12} strokeWidth={3} />
        </span>
      )}
    </button>
  )
}

/**
 * Delete one or more saved photos. With `pending` (a new upload and a full library) it's the "make room"
 * step: delete the ticked ones and save the new photo in one request, or use the new photo on this CV only.
 */
function PhotoLibraryModal(props: {
  photos: SavedPhoto[]
  current: string
  pending: string | null
  busy: boolean
  onClose: () => void
  onDelete: (ids: string[]) => void
  onReplace: (ids: string[]) => void
  onUseOnce: () => void
}) {
  const { photos, current, pending, busy } = props
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const n = picked.length

  return (
    <Modal
      open
      onClose={props.onClose}
      title={pending ? 'Your photo library is full' : 'Manage photos'}
      footer={
        pending ? (
          <>
            <button type="button" className="btn ghost" onClick={props.onUseOnce} disabled={busy}>
              Use on this CV without saving
            </button>
            <button type="button" className="btn primary" onClick={() => props.onReplace(picked)} disabled={!n || busy}>
              {busy ? <Spinner /> : <Trash2 size={15} />} Delete {n || ''} and save new photo
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={props.onClose}>
              Close
            </button>
            <button type="button" className="btn danger" onClick={() => props.onDelete(picked)} disabled={!n || busy}>
              {busy ? <Spinner /> : <Trash2 size={15} />} Delete {n ? `${n} photo${n > 1 ? 's' : ''}` : ''}
            </button>
          </>
        )
      }
    >
      <p className="muted small">
        {pending
          ? `You can keep up to ${MAX_PHOTOS} photos. Tick the ones to delete to make room for the new one.`
          : 'Tick the photos to delete.'}{' '}
        CVs that already use a deleted photo keep it until you change it.
      </p>
      {pending && (
        <div className="photo-new">
          <img src={pending} alt="The new photo" />
          <span className="muted small">New photo</span>
        </div>
      )}
      <div className="photo-library">
        {photos.map((ph, i) => (
          <label key={ph.id} className={`photo-choice${picked.includes(ph.id) ? ' picked' : ''}`}>
            <input type="checkbox" checked={picked.includes(ph.id)} onChange={() => toggle(ph.id)} aria-label={`Delete saved photo ${i + 1}`} />
            <img src={ph.data} alt="" />
            {ph.data === current && <span className="photo-tile-badge">On this CV</span>}
          </label>
        ))}
      </div>
    </Modal>
  )
}
