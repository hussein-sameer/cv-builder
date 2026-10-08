import { Bot, FileDown, Monitor, Moon, Sun, FileJson, FileText, FileUp, MoreHorizontal, Palette, RotateCcw, Sparkle, Undo2, WandSparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, fileName } from '../api'
import { parseCvText } from '../cvImport'
import { emptyCV, exampleCV } from '../defaults'
import { useStore } from '../store'
import type { TemplateKey } from '../types'
import { useTheme, type ThemePref } from '../theme'
import { AccountMenu } from './AccountMenu'
import { CvSwitcher } from './CvSwitcher'
import { Popover, Spinner } from './ui'

const THEME_NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon }

function ThemeToggle() {
  const [pref, setPref] = useTheme()
  const Icon = THEME_ICON[pref]
  const label = `Theme: ${pref[0].toUpperCase() + pref.slice(1)} — click for ${THEME_NEXT[pref]}`
  return (
    <button type="button" className="icon-btn" title={label} aria-label={label} onClick={() => setPref(THEME_NEXT[pref])}>
      <Icon size={17} />
    </button>
  )
}

const FONTS = ['Calibri', 'Arial', 'Cambria', 'Times New Roman', 'Georgia']
const ACCENTS = ['#1F3864', '#000000', '#1D4E89', '#0F5257', '#7A1F2B', '#4B3F72']

export function TopBar() {
  const { cv, mutate, replaceCV, undo, canUndo, templates, ai, aiReady, aiConfig, openAISettings, openImport, importCV, toast, storageMode, createDoc } = useStore()
  const [designOpen, setDesignOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState<'pdf' | 'docx' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const tpl = templates.find((t) => t.key === cv.design.template)
  const aiLabel = aiConfig?.providers.find((p) => p.type === ai.active)?.label ?? 'AI'

  const download = async (format: 'pdf' | 'docx') => {
    setBusy(format)
    try {
      await api.download(cv, format, fileName(cv, format))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(cv, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fileName(cv, 'json')
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    setMenuOpen(false)
  }

  const importJSON = async (file: File) => {
    if (fileRef.current) fileRef.current.value = '' // let the same file be picked again
    setMenuOpen(false)
    try {
      // also accepts the JSON an AI chat produced from "Upload CV with AI"
      if (await importCV(parseCvText(await file.text()), file.name.replace(/\.(json|txt)$/i, '').replace(/_/g, ' '))) {
        toast(`Imported ${file.name}`, 'success')
      }
    } catch (e) {
      toast(`Couldn't import ${file.name}: ${(e as Error).message}`, 'error')
    }
  }

  const setTemplate = (t: TemplateKey) => mutate((d) => void (d.design.template = t))

  return (
    <header className="topbar">
      <div className="brand">
        <img src="/favicon.svg" alt="" width={26} height={26} />
        <span className="brand-name">
          <span className="brand-cv">CV</span> Builder
        </span>
      </div>
      <CvSwitcher />

      <div className="segmented template-switch" role="radiogroup" aria-label="Layout">
        {(['international', 'europass'] as TemplateKey[]).map((k) => (
          <button
            type="button"
            role="radio"
            aria-checked={cv.design.template === k}
            key={k}
            className={cv.design.template === k ? 'active' : ''}
            onClick={() => setTemplate(k)}
            title={templates.find((t) => t.key === k)?.description}
          >
            {k === 'international' ? 'International' : 'EU / UK'}
          </button>
        ))}
      </div>

      <div className="topbar-actions">
        <ThemeToggle />
        <button type="button" className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={undo}>
          <Undo2 size={17} />
        </button>

        <div className="popover-anchor">
          <button type="button" className="btn ghost" data-popover-trigger onClick={() => setDesignOpen(!designOpen)} aria-expanded={designOpen} aria-label="Design" title="Design">
            <Palette size={16} /> <span className="hide-lg">Design</span>
          </button>
          <Popover open={designOpen} onClose={() => setDesignOpen(false)} className="design-pop">
            <label className="field">
              <span className="field-label">Font</span>
              <select className="input" value={cv.design.fontFamily ?? ''} onChange={(e) => mutate((d) => void (d.design.fontFamily = e.target.value || null))}>
                <option value="">Template default ({tpl?.defaultFont ?? '…'})</option>
                {FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Font size</span>
              <select className="input" value={cv.design.fontSize} onChange={(e) => mutate((d) => void (d.design.fontSize = Number(e.target.value)))}>
                {[9.5, 10, 10.5, 11, 11.5, 12].map((s) => (
                  <option key={s} value={s}>
                    {s} pt
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span className="field-label">Accent colour</span>
              <div className="swatches">
                {ACCENTS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`swatch ${cv.design.accentColor.toLowerCase() === c.toLowerCase() ? 'active' : ''}`}
                    style={{ background: c }}
                    aria-label={`Accent ${c}`}
                    onClick={() => mutate((d) => void (d.design.accentColor = c))}
                  />
                ))}
                <input type="color" aria-label="Custom accent colour" value={cv.design.accentColor} onChange={(e) => mutate((d) => void (d.design.accentColor = e.target.value.toUpperCase()))} />
              </div>
            </div>
            <div className="field">
              <span className="field-label">Paper size</span>
              <div className="segmented">
                {(['A4', 'Letter'] as const).map((s) => (
                  <button type="button" key={s} className={cv.design.pageSize === s ? 'active' : ''} onClick={() => mutate((d) => void (d.design.pageSize = s))}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <p className="muted small">{tpl?.description}</p>
          </Popover>
        </div>

        <button
          type="button"
          className={`btn ghost ai-status ${aiReady ? 'ready' : ''}`}
          onClick={() => openAISettings(true)}
          aria-label={aiReady ? `AI settings (${aiLabel})` : 'Connect AI'}
          title={aiReady ? `AI: ${aiLabel}` : 'Connect an AI provider'}
        >
          <Bot size={16} /> <span className="hide-lg">{aiReady ? aiLabel : 'Connect AI'}</span>
          <span className="dot" />
        </button>

        <div className="popover-anchor">
          <button type="button" className="icon-btn" data-popover-trigger aria-label="More" title="More" onClick={() => setMenuOpen(!menuOpen)}>
            <MoreHorizontal size={18} />
          </button>
          <Popover open={menuOpen} onClose={() => setMenuOpen(false)} className="menu">
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setMenuOpen(false)
                openImport(true)
              }}
            >
              <WandSparkles size={15} /> Upload CV with AI…
            </button>
            <button type="button" className="menu-item" onClick={() => fileRef.current?.click()}>
              <FileUp size={15} /> Import JSON as new CV…
            </button>
            <button type="button" className="menu-item" onClick={exportJSON}>
              <FileJson size={15} /> Export this CV as JSON
            </button>
            <hr />
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                if (storageMode === 'server') void createDoc('example', 'Example CV')
                else replaceCV(exampleCV())
                setMenuOpen(false)
              }}
            >
              <Sparkle size={15} /> Open example CV
            </button>
            <button
              type="button"
              className="menu-item danger"
              onClick={() => {
                replaceCV(emptyCV())
                setMenuOpen(false)
                toast('Cleared this CV. Use Undo to go back.', 'info')
              }}
            >
              <RotateCcw size={15} /> Clear this CV
            </button>
          </Popover>
          <input ref={fileRef} type="file" accept="application/json,.json,text/plain,.txt" hidden onChange={(e) => e.target.files?.[0] && importJSON(e.target.files[0])} />
        </div>

        <div className="download-group">
          <button type="button" className="btn" onClick={() => download('docx')} disabled={!!busy}>
            {busy === 'docx' ? <Spinner /> : <FileText size={16} className="hide-sm" />} DOCX
          </button>
          <button type="button" className="btn primary" onClick={() => download('pdf')} disabled={!!busy}>
            {busy === 'pdf' ? <Spinner /> : <FileDown size={16} className="hide-sm" />} PDF
          </button>
        </div>
        <AccountMenu />
      </div>
    </header>
  )
}
