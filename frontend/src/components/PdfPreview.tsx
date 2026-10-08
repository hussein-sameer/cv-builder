// legacy build = polyfilled for browsers that lack the newest JS built-ins
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { CV } from '../types'
import { Spinner } from './ui'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Renders the *real* PDF produced by the backend (so the preview is exactly
 * what you download). Pages are drawn into fresh canvases and swapped in at
 * once to avoid flicker; scroll position is preserved.
 */
export function PdfPreview({ cv, onPages }: { cv: CV; onPages: (n: number | null) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const renderSeq = useRef(0)
  const [width, setWidth] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)

  // Only what is printed triggers a refresh (editing the job description doesn't).
  const printable = JSON.stringify({ personal: cv.personal, sections: cv.sections, design: cv.design })

  useEffect(() => {
    const ctrl = new AbortController()
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const { data, pages } = await api.previewPdf(JSON.parse(printable) as CV, ctrl.signal)
        const task = pdfjs.getDocument({ data: new Uint8Array(data) })
        const doc = await task.promise
        if (ctrl.signal.aborted) return void task.destroy()
        const oldTask = taskRef.current
        taskRef.current = task
        docRef.current = doc
        setVersion((v) => v + 1)
        // free the previous document once the new one has been drawn
        setTimeout(() => oldTask?.destroy(), 1500)
        onPages(pages)
        setError('')
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setError((e as Error).message)
        onPages(null)
        setBusy(false)
      }
    }, 450)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [printable, onPages])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let frame = 0
    const ro = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setWidth(Math.floor(entry.contentRect.width)))
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => () => void taskRef.current?.destroy(), [])

  useEffect(() => {
    const doc = docRef.current
    const host = pagesRef.current
    if (!doc || !host || width < 50) return
    const seq = ++renderSeq.current
    const pageWidth = Math.min(width - 32, 860)
    ;(async () => {
      const nodes: HTMLElement[] = []
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const base = page.getViewport({ scale: 1 })
        const cssScale = pageWidth / base.width
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
        const viewport = page.getViewport({ scale: cssScale * dpr })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(base.width * cssScale)}px`
        canvas.style.height = `${Math.floor(base.height * cssScale)}px`
        try {
          await page.render({ canvas, viewport }).promise
        } catch (e) {
          // a newer version may have destroyed this doc mid-render – only report current failures
          if (seq === renderSeq.current) {
            console.error('PDF preview render failed', e)
            setError(`Could not draw the preview: ${(e as Error).message}`)
            setBusy(false)
          }
          return
        }
        if (seq !== renderSeq.current) return
        const wrap = document.createElement('div')
        wrap.className = 'pdf-page'
        wrap.setAttribute('data-page', String(i))
        wrap.appendChild(canvas)
        nodes.push(wrap)
      }
      if (seq !== renderSeq.current) return
      host.replaceChildren(...nodes)
      setBusy(false)
    })()
  }, [version, width])

  return (
    <div className="pdf-preview" ref={wrapRef}>
      {busy && (
        <div className="preview-busy">
          <Spinner size={12} /> Updating…
        </div>
      )}
      {error && (
        <div className="preview-error">
          <AlertTriangle size={18} />
          <div>
            <strong>Preview unavailable</strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      <div className="pdf-pages" ref={pagesRef} aria-label="CV preview" />
    </div>
  )
}
