export type SlideVertical = 'kuliner' | 'klinik' | 'salon' | 'bengkel' | 'umum'

export const SLIDE_VERTICALS: { id: SlideVertical; label: string }[] = [
  { id: 'kuliner', label: 'Kuliner' },
  { id: 'klinik', label: 'Klinik' },
  { id: 'salon', label: 'Salon' },
  { id: 'bengkel', label: 'Bengkel' },
  { id: 'umum', label: 'Umum' },
]

export type SlideTemplate = {
  id: string
  vertical: SlideVertical
  name: string
  layout: 'headline' | 'center' | 'band'
  bg: [string, string]
  accent: string
  ink: string
  hint: { title: string; subtitle: string; note: string }
}

export const SLIDE_TEMPLATES: SlideTemplate[] = [
  {
    id: 'promo-hangat',
    vertical: 'kuliner',
    name: 'Promo hangat',
    layout: 'headline',
    bg: ['#7f1d1d', '#b91c1c'],
    accent: '#fbbf24',
    ink: '#fff7ed',
    hint: { title: 'Promo hari ini', subtitle: 'Diskon 20% semua menu', note: 'Berlaku sampai pukul 21.00' },
  },
  {
    id: 'menu-papan',
    vertical: 'kuliner',
    name: 'Papan menu',
    layout: 'band',
    bg: ['#0f172a', '#1e293b'],
    accent: '#f59e0b',
    ink: '#f8fafc',
    hint: { title: 'Menu hari ini', subtitle: 'Nasi goreng spesial · Es teh manis', note: 'Pesan di kasir' },
  },
  {
    id: 'klinik-jadwal',
    vertical: 'klinik',
    name: 'Jadwal dokter',
    layout: 'headline',
    bg: ['#0e7490', '#155e75'],
    accent: '#a7f3d0',
    ink: '#ecfeff',
    hint: { title: 'Dokter hari ini', subtitle: 'dr. Ayu, 09.00–14.00', note: 'Pendaftaran di meja depan' },
  },
  {
    id: 'klinik-info',
    vertical: 'klinik',
    name: 'Info layanan',
    layout: 'center',
    bg: ['#134e4a', '#0f766e'],
    accent: '#99f6e4',
    ink: '#f0fdfa',
    hint: { title: 'Protokol kesehatan', subtitle: 'Cuci tangan sebelum masuk', note: 'Terima kasih' },
  },
  {
    id: 'salon-promo',
    vertical: 'salon',
    name: 'Promo perawatan',
    layout: 'center',
    bg: ['#4c1d95', '#7c3aed'],
    accent: '#f9a8d4',
    ink: '#faf5ff',
    hint: { title: 'Paket hemat', subtitle: 'Creambath + potong, hemat 30%', note: 'Senin sampai Kamis' },
  },
  {
    id: 'bengkel-servis',
    vertical: 'bengkel',
    name: 'Servis cepat',
    layout: 'headline',
    bg: ['#1f2937', '#374151'],
    accent: '#f97316',
    ink: '#f9fafb',
    hint: { title: 'Servis ringan', subtitle: 'Ganti oli 30 menit', note: 'Garansi pengerjaan 3 hari' },
  },
  {
    id: 'umum-promo',
    vertical: 'umum',
    name: 'Promo toko',
    layout: 'headline',
    bg: ['#0f766e', '#115e59'],
    accent: '#fde68a',
    ink: '#f0fdfa',
    hint: { title: 'Promo minggu ini', subtitle: 'Diskon 15% semua produk', note: 'Syarat dan ketentuan berlaku' },
  },
  {
    id: 'umum-info',
    vertical: 'umum',
    name: 'Papan informasi',
    layout: 'center',
    bg: ['#111827', '#1f2937'],
    accent: '#60a5fa',
    ink: '#f9fafb',
    hint: { title: 'Selamat datang', subtitle: 'Jam operasional 08.00–21.00', note: 'Layanan pelanggan di lantai 1' },
  },
]

export type SlideInput = { title: string; subtitle: string; note: string; accent: string }
export type SlideBrand = { name: string; color: string }

const W = 1920
const H = 1080
const FONT = '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif'

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Shrinks the font until the text fits the width and line budget. */
function fit(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: { maxWidth: number; maxLines: number; start: number; min: number; weight?: number },
) {
  const weight = opts.weight ?? 700
  let size = opts.start
  while (size > opts.min) {
    ctx.font = `${weight} ${size}px ${FONT}`
    if (wrap(ctx, text, opts.maxWidth).length <= opts.maxLines) break
    size -= 8
  }
  ctx.font = `${weight} ${size}px ${FONT}`
  return { size, lines: wrap(ctx, text, opts.maxWidth).slice(0, opts.maxLines) }
}

function block(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, size: number, lineHeight: number) {
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * size * lineHeight))
  return y + (lines.length - 1) * size * lineHeight
}

function background(ctx: CanvasRenderingContext2D, template: SlideTemplate) {
  const fill = ctx.createLinearGradient(0, 0, W, H)
  fill.addColorStop(0, template.bg[0])
  fill.addColorStop(1, template.bg[1])
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, W, H)

  ctx.save()
  ctx.globalAlpha = 0.12
  ctx.fillStyle = template.accent
  ctx.beginPath()
  ctx.arc(W - 140, 120, 340, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(90, H - 40, 220, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function footer(ctx: CanvasRenderingContext2D, template: SlideTemplate, brand: SlideBrand) {
  ctx.save()
  ctx.globalAlpha = 0.75
  ctx.font = `600 34px ${FONT}`
  ctx.fillStyle = template.ink
  ctx.textAlign = 'left'
  ctx.fillText(brand.name.toUpperCase(), 140, H - 80)
  ctx.fillStyle = template.accent
  ctx.fillRect(140, H - 62, 90, 6)
  ctx.restore()
}

export function drawSlide(canvas: HTMLCanvasElement, template: SlideTemplate, input: SlideInput, brand: SlideBrand) {
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.textBaseline = 'alphabetic'
  background(ctx, template)
  ctx.fillStyle = template.ink

  const title = input.title.trim() || template.hint.title
  const subtitle = input.subtitle.trim() || template.hint.subtitle
  const note = input.note.trim() || template.hint.note
  const accent = input.accent || template.accent
  const maxWidth = W - 280

  if (template.layout === 'center') {
    ctx.textAlign = 'center'
    const head = fit(ctx, title, { maxWidth, maxLines: 2, start: 150, min: 84 })
    const lines = head.lines
    let y = 420
    lines.forEach((line, index) => ctx.fillText(line, W / 2, y + index * head.size * 1.05))
    y += (lines.length - 1) * head.size * 1.05
    ctx.fillStyle = accent
    ctx.fillRect(W / 2 - 110, y + 54, 220, 14)
    ctx.fillStyle = template.ink
    const sub = fit(ctx, subtitle, { maxWidth, maxLines: 2, start: 68, min: 40, weight: 500 })
    let sy = y + 170
    sub.lines.forEach((line) => {
      ctx.fillText(line, W / 2, sy)
      sy += sub.size * 1.3
    })
    if (note) {
      ctx.font = `600 36px ${FONT}`
      ctx.fillStyle = accent
      ctx.fillText(note, W / 2, H - 170)
    }
  } else if (template.layout === 'band') {
    ctx.textAlign = 'left'
    const head = fit(ctx, title, { maxWidth: maxWidth - 60, maxLines: 2, start: 96, min: 60 })
    ctx.fillStyle = accent
    ctx.fillRect(0, 300, W, head.lines.length * head.size * 1.18 + 150)
    ctx.fillStyle = '#111827'
    block(ctx, head.lines, 140, 300 + 100 + head.size * 0.7, head.size, 1.18)
    ctx.fillStyle = template.ink
    const sub = fit(ctx, subtitle, { maxWidth: maxWidth - 60, maxLines: 2, start: 56, min: 38, weight: 500 })
    block(ctx, sub.lines, 140, 300 + head.lines.length * head.size * 1.18 + 230, sub.size, 1.3)
    if (note) {
      ctx.font = `600 34px ${FONT}`
      ctx.fillStyle = accent
      ctx.fillText(note, 140, H - 170)
    }
  } else {
    ctx.textAlign = 'left'
    ctx.fillStyle = accent
    ctx.fillRect(140, 170, 120, 14)
    ctx.fillStyle = template.ink
    const head = fit(ctx, title, { maxWidth, maxLines: 3, start: 132, min: 72 })
    const end = block(ctx, head.lines, 140, 360, head.size, 1.06)
    ctx.fillStyle = accent
    ctx.fillRect(140, end + 60, 260, 12)
    ctx.fillStyle = template.ink
    const sub = fit(ctx, subtitle, { maxWidth, maxLines: 2, start: 60, min: 40, weight: 500 })
    block(ctx, sub.lines, 140, end + 170, sub.size, 1.35)
    if (note) {
      ctx.font = `600 34px ${FONT}`
      ctx.fillStyle = accent
      ctx.fillText(note, 140, end + 170 + sub.lines.length * sub.size * 1.35 + 50)
    }
  }

  footer(ctx, template, brand)
}
