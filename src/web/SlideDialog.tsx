import { useEffect, useRef, useState } from 'react'
import { useMe } from './lib/api'
import { drawSlide, SLIDE_TEMPLATES, SLIDE_VERTICALS, type SlideTemplate, type SlideVertical } from './lib/slides'
import { uploadImage } from './lib/upload'
import { Button, cx, Input, Modal, useToast } from './ui'

/** Ready-made promo slides per business type; the text is editable, the layout is not. */
export function SlideDialog({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const me = useMe()
  const toast = useToast()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [templateId, setTemplateId] = useState(SLIDE_TEMPLATES[0]!.id)
  const template = SLIDE_TEMPLATES.find((t) => t.id === templateId) ?? SLIDE_TEMPLATES[0]!
  const [title, setTitle] = useState(template.hint.title)
  const [subtitle, setSubtitle] = useState(template.hint.subtitle)
  const [note, setNote] = useState(template.hint.note)
  const [accent, setAccent] = useState(template.accent)
  const [busy, setBusy] = useState(false)

  const pick = (next: SlideTemplate) => {
    setTemplateId(next.id)
    setTitle(next.hint.title)
    setSubtitle(next.hint.subtitle)
    setNote(next.hint.note)
    setAccent(next.accent)
  }

  const pickVertical = (vertical: SlideVertical) => {
    const first = SLIDE_TEMPLATES.find((t) => t.vertical === vertical)
    if (first) pick(first)
  }

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const draw = () =>
      drawSlide(
        element,
        template,
        { title, subtitle, note, accent },
        { name: me.data?.tenant.name ?? 'AdCast', color: me.data?.tenant.brandColor ?? '#0f766e' },
      )
    draw()
    // The webfont may arrive after the first paint; redraw once it is ready.
    document.fonts?.ready.then(draw).catch(() => {})
  }, [template, title, subtitle, note, accent, me.data?.tenant.name, me.data?.tenant.brandColor])

  const save = async () => {
    const element = canvas.current
    if (!element) return
    setBusy(true)
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        element.toBlob((result) => (result ? resolve(result) : reject(new Error('Slide tidak bisa dibuat'))), 'image/png'),
      )
      await uploadImage(blob, title.trim() || template.name)
      toast('Slide siap ditayangkan')
      onSaved()
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan slide', true)
    } finally {
      setBusy(false)
    }
  }

  const vertical = template.vertical

  return (
    <Modal title="Buat slide" onClose={onClose} wide>
      <div className="grid gap-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Jenis usaha">
          {SLIDE_VERTICALS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pickVertical(item.id)}
              className={cx(
                'min-h-9 rounded-full px-3 text-sm font-semibold',
                item.id === vertical ? 'bg-ink text-bg' : 'border border-line text-muted hover:bg-sunken',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {SLIDE_TEMPLATES.filter((t) => t.vertical === vertical).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pick(item)}
              className={cx(
                'flex items-center gap-3 rounded-md border p-2 text-left',
                item.id === template.id ? 'border-ink ring-1 ring-ink' : 'border-line hover:bg-sunken',
              )}
            >
              <span
                aria-hidden
                className="size-9 shrink-0 rounded"
                style={{ background: `linear-gradient(135deg, ${item.bg[0]}, ${item.bg[1]})` }}
              />
              <span className="text-sm font-semibold">{item.name}</span>
            </button>
          ))}
        </div>

        <canvas
          ref={canvas}
          aria-label="Pratinjau slide"
          className="aspect-video w-full rounded-md border border-line bg-screen"
        />

        <Input label="Judul" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} required />
        <Input label="Keterangan" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={120} />
        <Input label="Info kecil di bawah" value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} />
        <div className="grid content-start gap-1.5">
          <label htmlFor="slide-accent" className="text-sm font-semibold">
            Warna aksen
          </label>
          <input
            id="slide-accent"
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            className="h-11 w-16 cursor-pointer rounded-md border border-line bg-surface p-1"
          />
        </div>

        <p className="text-sm text-muted">
          Slide disimpan sebagai foto di Media, jadi bisa dipakai di playlist, jadwal, maupun panel bagi layar. Susunannya
          sudah pas untuk layar 16:9, tidak perlu aplikasi desain.
        </p>

        <Button variant="primary" busy={busy} disabled={!title.trim()} onClick={save}>
          Simpan ke Media
        </Button>
      </div>
    </Modal>
  )
}
