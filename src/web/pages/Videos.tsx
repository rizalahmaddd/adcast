import { Link2, Pencil, Send, Sparkles, Trash2, Upload } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { directVideoLink, isYoutubeLink } from '../../shared/links'
import { PLANS } from '../../shared/plans'
import { isImageMime } from '../../shared/types'
import { calendarDay } from '../../shared/validity'
import { SendDialog, thumbUrl } from '../components'
import { SlideDialog } from '../SlideDialog'
import { api, can, useMe, useMedia, type Media } from '../lib/api'
import { CloudImport } from '../lib/cloud'
import { formatBytes, formatDate, formatDay, formatDuration } from '../lib/format'
import { isImageFile, probeImageLink, probeLink, uploadImage, uploadVideo, type UploadStage } from '../lib/upload'
import { Button, cx, Empty, Failed, FormError, Input, Loading, Modal, PageHeader, useAction, useToast } from '../ui'

type Job = { id: number; name: string; stage: UploadStage | { stage: 'fetching'; progress: number }; error?: string }
export type Incoming = { name: string; load: () => Promise<Blob> }

const STAGE_LABEL = {
  fetching: 'Mengambil file dari cloud',
  checking: 'Memeriksa file', converting: 'Menyesuaikan format', uploading: 'Mengunggah',
}
const SOURCE_LABEL: Record<string, string> = {
  upload: 'Upload',
  gdrive: 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  youtube: 'YouTube',
  link: 'Tautan',
}

export default function Videos() {
  const me = useMe()
  const media = useMedia()
  const toast = useToast()
  const { run } = useAction()
  const fileInput = useRef<HTMLInputElement>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [youtubeOpen, setYoutubeOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [slideOpen, setSlideOpen] = useState(false)
  const [sending, setSending] = useState<Media | null>(null)
  const [renaming, setRenaming] = useState<Media | null>(null)
  const [preview, setPreview] = useState<Media | null>(null)

  const mayManage = can(me.data, 'media')
  const mayBroadcast = can(me.data, 'broadcast')

  const addFiles = async (files: Incoming[], source: Parameters<typeof uploadVideo>[2]) => {
    // One at a time: parallel conversions would exhaust browser memory.
    for (const { load, name } of files) {
      const id = Date.now() + Math.random()
      const patch = (change: Partial<Job>) => setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...change } : j)))
      setJobs((list) => [...list, { id, name, stage: { stage: source === 'upload' ? 'checking' : 'fetching', progress: 0 } }])
      try {
        const blob = await load()
        const title = name.replace(/\.[^.]+$/, '').slice(0, 200)
        if (isImageFile(blob, name)) {
          patch({ stage: { stage: 'uploading', progress: 0.5 } })
          await uploadImage(blob, title || 'Foto')
        } else {
          await uploadVideo(blob, title || 'Video', source, (stage) => patch({ stage }))
        }
        setJobs((list) => list.filter((j) => j.id !== id))
        toast(`"${name}" siap ditayangkan`)
      } catch (err) {
        patch({ error: err instanceof Error ? err.message : 'Gagal mengunggah' })
      }
      await media.refetch()
    }
  }

  const remove = (m: Media) => {
    if (!confirm(`Hapus "${m.title}"? Media ini akan hilang dari semua playlist.`)) return
    run(() => api('DELETE', `/api/media/${m.id}`), 'Media dihapus')
  }

  if (media.isPending) return <Loading what="daftar media" />
  if (media.error) return <Failed error={media.error} retry={() => media.refetch()} />

  const rules = me.data?.tenant.limits ?? PLANS.free
  const stores = rules.maxStorage > 0
  const items = media.data.items.filter((m) => m.status !== 'uploading')
  const count = media.data.items.filter((m) => m.status !== 'failed').length
  const today = calendarDay(Date.now())

  return (
    <>
      <PageHeader
        title="Media"
        lead={
          stores
            ? `${count} dari ${rules.maxMedia} media, upload terpakai ${formatBytes(media.data.used)} dari ${formatBytes(rules.maxStorage)}. Tautan dan YouTube tidak memakai kuota.`
            : `${count} dari ${rules.maxMedia} media terpakai di paket ${rules.label}. Paket ini menayangkan video dan foto dari tautan, serta YouTube.`
        }
        action={
          mayManage && (
            <>
              {stores && <CloudImport onFiles={addFiles} />}
              <Button onClick={() => setYoutubeOpen(true)}>Tambah dari YouTube</Button>
              <Button variant={stores ? 'plain' : 'primary'} onClick={() => setLinkOpen(true)}>
                <Link2 className="size-4" aria-hidden /> Tambah dari tautan
              </Button>
              {stores && (
                <>
                  <Button onClick={() => setSlideOpen(true)}>
                    <Sparkles className="size-4" aria-hidden /> Buat slide
                  </Button>
                  <Button variant="primary" onClick={() => fileInput.current?.click()}>
                    <Upload className="size-4" aria-hidden /> Upload video atau foto
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="video/*,image/jpeg,image/png,image/webp,.mkv,.avi,.mov,.flv,.wmv,.ts,.m4v,.3gp"
                    multiple
                    hidden
                    onChange={(e) => {
                      const files = [...(e.target.files ?? [])].map((f) => ({ name: f.name, load: async () => f as Blob }))
                      e.target.value = ''
                      void addFiles(files, 'upload')
                    }}
                  />
                </>
              )}
            </>
          )
        }
      />

      {!stores && (
        <p className="mb-6 rounded-md border border-line bg-surface px-4 py-3">
          Upload video dan foto dari komputer, Google Drive, Dropbox, dan OneDrive tersedia mulai paket Pro.{' '}
          <Link to="/paket" className="font-semibold underline">
            Lihat paket
          </Link>
          {me.data?.tenant.purgeAt && items.some((m) => m.kind === 'file' && m.status === 'ready') && (
            <span className="mt-1 block font-semibold text-warn">
              File hasil upload yang masih tersimpan dihapus pada {formatDate(me.data.tenant.purgeAt)} kalau paket tidak diperpanjang.
            </span>
          )}
        </p>
      )}

      {jobs.length > 0 && (
        <ul className="mb-6 grid gap-2" aria-label="Unggahan berjalan">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-md border border-line bg-surface px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <p className="min-w-0 truncate font-semibold">{job.name}</p>
                {job.error && (
                  <Button small onClick={() => setJobs((list) => list.filter((j) => j.id !== job.id))}>
                    Tutup
                  </Button>
                )}
              </div>
              {job.error ? (
                <p role="alert" className="mt-1 text-sm font-medium text-bad">
                  {job.error}
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-muted">
                    {STAGE_LABEL[job.stage.stage]}
                    {(job.stage.stage === 'converting' || job.stage.stage === 'uploading') && ` ${Math.round(job.stage.progress * 100)}%`}
                  </p>
                  <progress
                    className="mt-2 h-1.5 w-full accent-(--ink)"
                    value={job.stage.stage === 'converting' || job.stage.stage === 'uploading' ? job.stage.progress : undefined}
                    max={1}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 && jobs.length === 0 ? (
        <Empty title="Belum ada media">
          {!mayManage
            ? 'Peran Anda belum punya akses untuk menambah video.'
            : stores
              ? 'Upload video atau foto dari komputer, atau tempel tautan file maupun YouTube. MP4, MOV, MKV, AVI, JPG, PNG, dan format umum lain diterima.'
              : 'Tempel tautan YouTube, atau tautan langsung ke file MP4, WebM, JPG, atau PNG yang sudah Anda simpan di tempat lain.'}
        </Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((m) => {
            const thumb = thumbUrl(m)
            const failed = m.status === 'failed'
            const locked = m.kind === 'file' && !stores
            const image = isImageMime(m.mime)
            return (
              <li key={m.id} className="grid content-start gap-2">
                <button
                  type="button"
                  disabled={failed}
                  onClick={() => setPreview(m)}
                  aria-label={`Pratinjau ${m.title}`}
                  className="relative aspect-video overflow-hidden rounded-md bg-screen"
                >
                  {thumb && <img src={thumb} alt="" loading="lazy" className="size-full object-cover" />}
                  {m.kind === 'link' && image && <img src={m.url!} alt="" loading="lazy" className="size-full object-cover" />}
                  {m.kind === 'link' && !image && (
                    // The first frame stands in for a thumbnail, since nothing from a linked video is stored.
                    <video src={`${m.url}#t=1`} preload="metadata" muted playsInline tabIndex={-1} className="size-full object-cover" />
                  )}
                  {m.duration && (
                    <span className="absolute right-1.5 bottom-1.5 rounded bg-black/80 px-1.5 py-0.5 text-xs font-semibold text-white">
                      {image ? `Foto, ${Math.round(m.duration)} detik` : formatDuration(m.duration)}
                    </span>
                  )}
                </button>
                <div className="min-w-0">
                  <p className="line-clamp-2 font-semibold leading-snug">{m.title}</p>
                  {failed ? (
                    <p className="text-sm font-medium text-bad">{m.error}</p>
                  ) : locked ? (
                    <p className="text-sm font-medium text-warn">Hasil upload, tayang lagi setelah paket diperpanjang</p>
                  ) : (
                    <p className="text-sm text-muted">
                      {SOURCE_LABEL[m.source] ?? m.source}
                      {m.kind === 'file' && `, ${formatBytes(m.size)}`}
                      {m.height ? `, ${m.height}p` : ''}
                    </p>
                  )}
                  {!failed && (m.startDate || m.endDate) && (
                    <p className={cx('text-sm', m.endDate && m.endDate < today ? 'font-medium text-warn' : 'text-muted')}>
                      {m.endDate && m.endDate < today
                        ? `Masa tayang berakhir ${formatDay(m.endDate)}`
                        : `Tayang ${m.startDate ? formatDay(m.startDate) : 'sekarang'} – ${m.endDate ? formatDay(m.endDate) : 'seterusnya'}`}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {mayBroadcast && !failed && !locked && (
                    <Button small onClick={() => setSending(m)}>
                      <Send className="size-4" aria-hidden /> Kirim
                    </Button>
                  )}
                  {mayManage && !failed && (
                    <Button small onClick={() => setRenaming(m)} aria-label={`Ubah ${m.title}`}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                  )}
                  {mayManage && (
                    <Button small variant="danger" onClick={() => remove(m)} aria-label={`Hapus ${m.title}`}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {youtubeOpen && <YoutubeDialog onClose={() => setYoutubeOpen(false)} />}
      {slideOpen && (
        <SlideDialog
          onSaved={() => {
            void media.refetch()
          }}
          onClose={() => setSlideOpen(false)}
        />
      )}
      {linkOpen && <LinkDialog onClose={() => setLinkOpen(false)} />}
      {sending && <SendDialog preset={{ value: `media:${sending.id}`, name: sending.title }} onClose={() => setSending(null)} />}
      {renaming && <RenameDialog media={renaming} onClose={() => setRenaming(null)} />}
      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(null)} wide>
          {preview.kind === 'youtube' ? (
            <iframe
              title={preview.title}
              className="aspect-video w-full rounded-md"
              src={`https://www.youtube.com/embed/${preview.youtubeId}`}
              allow="autoplay; encrypted-media"
              allowFullScreen
            />
          ) : isImageMime(preview.mime) ? (
            <img className="aspect-video w-full rounded-md bg-black object-contain" src={preview.url ?? `/media/${preview.id}`} alt={preview.title} />
          ) : (
            <video className="aspect-video w-full rounded-md bg-black" src={preview.url ?? `/media/${preview.id}`} controls autoPlay />
          )}
        </Modal>
      )}
    </>
  )
}

function YoutubeDialog({ onClose }: { onClose: () => void }) {
  const { run, busy } = useAction()
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const url = new FormData(e.currentTarget).get('url')
    if (await run(() => api('POST', '/api/media/youtube', { url }), 'Video YouTube ditambahkan')) onClose()
  }
  return (
    <Modal title="Tambah dari YouTube" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Input
          label="Tautan video YouTube"
          name="url"
          required
          autoFocus
          placeholder="https://www.youtube.com/watch?v=..."
          hint="Diputar lewat pemutar resmi YouTube, jadi TV perlu tersambung internet saat menayangkannya."
        />
        <Button type="submit" variant="primary" busy={busy}>
          Tambahkan
        </Button>
      </form>
    </Modal>
  )
}

function LinkDialog({ onClose }: { onClose: () => void }) {
  const { run, busy } = useAction()
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const raw = String(form.get('url')).trim()
    if (isYoutubeLink(raw)) return setError('Ini tautan YouTube. Tambahkan lewat tombol "Tambah dari YouTube".')
    const url = directVideoLink(raw)
    if (!url) return setError('Tautan harus berupa alamat https ke file video.')

    setError(null)
    setChecking(true)
    // Video first, since a video address never loads as a photo but the reverse fails fast too.
    const probe = await probeLink(url)
      .then((video) => ({ ...video, image: false }))
      .catch(() => probeImageLink(url).then((photo) => ({ ...photo, image: true })))
      .catch(() => {
        setError('Tautan ini tidak bisa dibuka sebagai video atau foto. Pastikan alamatnya langsung ke file MP4, WebM, JPG, atau PNG dan bisa dibuka siapa saja.')
        return null
      })
    setChecking(false)
    if (!probe) return

    const title = String(form.get('title')).trim() || decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
    const added = await run(
      () => api('POST', '/api/media/link', { url, title: title.slice(0, 200) || 'Video', ...probe }),
      'Media dari tautan ditambahkan',
    )
    if (added) onClose()
  }

  return (
    <Modal title="Tambah dari tautan" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Input
          label="Tautan file video atau foto"
          name="url"
          type="url"
          required
          autoFocus
          placeholder="https://contoh.com/promo.mp4"
          hint="Alamat https yang langsung membuka file MP4, WebM, JPG, atau PNG, misalnya tautan berbagi Dropbox atau file di hosting Anda. TV mengambilnya langsung dari alamat ini, jadi perlu internet saat tayang."
        />
        <Input label="Judul" name="title" maxLength={200} hint="Boleh dikosongkan, nama file dipakai sebagai judul." />
        <FormError message={error} />
        <Button type="submit" variant="primary" busy={checking || busy}>
          {checking ? 'Memeriksa tautan' : 'Tambahkan'}
        </Button>
      </form>
    </Modal>
  )
}

function RenameDialog({ media, onClose }: { media: Media; onClose: () => void }) {
  const { run, busy } = useAction()
  const image = isImageMime(media.mime)
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const body = {
      title: form.get('title'),
      duration: image ? Number(form.get('duration')) : undefined,
      startDate: String(form.get('startDate') ?? '') || null,
      endDate: String(form.get('endDate') ?? '') || null,
    }
    if (await run(() => api('PATCH', `/api/media/${media.id}`, body), 'Perubahan disimpan')) onClose()
  }
  return (
    <Modal title={image ? 'Ubah foto' : 'Ubah media'} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Input label="Judul" name="title" defaultValue={media.title} required maxLength={200} autoFocus />
        {image && (
          <Input
            label="Lama tampil (detik)"
            name="duration"
            type="number"
            min={3}
            max={3600}
            defaultValue={Math.round(media.duration ?? 10)}
            required
            hint="Berapa lama foto ini di layar sebelum pindah ke item berikutnya."
          />
        )}
        <div className="grid gap-3 border-t border-line pt-3">
          <p className="text-sm font-semibold">Masa berlaku</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Mulai tayang" name="startDate" type="date" defaultValue={media.startDate ?? ''} />
            <Input label="Berhenti tayang" name="endDate" type="date" defaultValue={media.endDate ?? ''} />
          </div>
          <p className="text-sm text-muted">
            Boleh dikosongkan. Di luar tanggal ini media dilewati saat playlist disusun, jadi promo berhenti sendiri.
          </p>
        </div>
        <Button type="submit" variant="primary" busy={busy}>
          Simpan
        </Button>
      </form>
    </Modal>
  )
}
