import { ChartNoAxesColumn, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { CITIES } from '../../shared/cities'
import { clockLabel, todaysPrayers } from '../../shared/prayer'
import { TICKER_SPEEDS, TIMEZONES, type Timezone } from '../../shared/types'
import { api, can, useBranches, useDevices, useMe, type Branch, type Device } from '../lib/api'
import { screenState, STATE_COLOR, STATE_LABEL } from '../lib/format'
import { Button, Check, Empty, Failed, Input, Loading, Modal, PageHeader, Select, useAction } from '../ui'

export default function Screens() {
  const me = useMe()
  const devices = useDevices()
  const branches = useBranches()
  const { run } = useAction()
  const [pairing, setPairing] = useState(false)
  const [editing, setEditing] = useState<Device | null>(null)
  const [branchForm, setBranchForm] = useState<Branch | 'new' | null>(null)

  const mayManage = can(me.data, 'device')

  if (devices.isPending || branches.isPending) return <Loading what="daftar layar" />
  if (devices.error || branches.error) {
    return <Failed error={devices.error ?? branches.error} retry={() => (devices.refetch(), branches.refetch())} />
  }

  const limit = me.data?.tenant.limits.maxDevices
  const playerUrl = `${location.origin}/player`

  const removeDevice = (d: Device) => {
    if (!confirm(`Lepas "${d.name}"? TV ini berhenti menerima tayangan dan harus dihubungkan ulang dengan kode baru.`)) return
    run(() => api('DELETE', `/api/devices/${d.id}`), 'Layar dilepas')
  }
  const removeBranch = (b: Branch) => {
    if (!confirm(`Hapus cabang "${b.name}"?`)) return
    run(() => api('DELETE', `/api/branches/${b.id}`), 'Cabang dihapus')
  }

  return (
    <>
      <PageHeader
        title="Layar"
        lead={`${devices.data.length} dari ${limit} layar terpakai di paket ${me.data?.tenant.limits.label}.`}
        action={
          mayManage && (
            <>
              <Button onClick={() => setBranchForm('new')}>Tambah cabang</Button>
              <Button variant="primary" onClick={() => setPairing(true)}>
                <Plus className="size-4" aria-hidden /> Hubungkan TV
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-8">
        {branches.data.map((branch) => {
          const list = devices.data.filter((d) => d.branchId === branch.id)
          return (
            <section key={branch.id} aria-labelledby={`layar-${branch.id}`}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                <h2 id={`layar-${branch.id}`} className="text-lg font-bold">
                  {branch.name}{' '}
                  <span className="text-base font-medium text-muted">
                    {TIMEZONES[branch.timezone].label}
                    {branch.prayer.enabled && `, jeda sholat ${branch.prayer.city ?? 'aktif'}`}
                  </span>
                </h2>
                {mayManage && (
                  <div className="flex gap-2">
                    <Button small onClick={() => setBranchForm(branch)}>
                      Ubah cabang
                    </Button>
                    {list.length === 0 && branches.data.length > 1 && (
                      <Button small variant="danger" onClick={() => removeBranch(branch)}>
                        Hapus
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {list.length === 0 ? (
                <p className="py-3 text-muted">Belum ada layar di cabang ini.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {list.map((d) => {
                    const state = screenState(d.live)
                    return (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="font-semibold">{d.name}</p>
                          <p className={`text-sm font-semibold ${STATE_COLOR[state]}`}>{STATE_LABEL[state]}</p>
                          {!d.covered && (
                            <p className="text-sm font-medium text-warn">
                              Melebihi batas {limit} layar paket {me.data?.tenant.limits.label}, tidak menerima tayangan baru
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            to={`/layar/${d.id}`}
                            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold hover:bg-sunken sm:min-h-9"
                          >
                            <ChartNoAxesColumn className="size-4" aria-hidden /> Statistik
                          </Link>
                          {mayManage && (
                            <>
                              <Button small onClick={() => setEditing(d)}>
                                Ubah
                              </Button>
                              <Button small variant="danger" onClick={() => removeDevice(d)}>
                                Lepas
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      {devices.data.length === 0 && (
        <div className="mt-8">
          <Empty title="Cara menghubungkan TV pertama">
            Di Android TV atau Android TV Box, buka browser lalu kunjungi {playerUrl}. TV akan menampilkan kode 6 karakter.
            Masukkan kode itu lewat tombol Hubungkan TV.
          </Empty>
        </div>
      )}

      {pairing && <PairDialog branches={branches.data} playerUrl={playerUrl} onClose={() => setPairing(false)} />}
      {editing && <DeviceDialog device={editing} branches={branches.data} onClose={() => setEditing(null)} />}
      {branchForm && <BranchDialog branch={branchForm === 'new' ? null : branchForm} onClose={() => setBranchForm(null)} />}
    </>
  )
}

function BranchOptions({ branches }: { branches: Branch[] }) {
  return branches.map((b) => (
    <option key={b.id} value={b.id}>
      {b.name}
    </option>
  ))
}

function PairDialog({ branches, playerUrl, onClose }: { branches: Branch[]; playerUrl: string; onClose: () => void }) {
  const { run, busy } = useAction()
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const body = Object.fromEntries(new FormData(e.currentTarget))
    if (await run(() => api('POST', '/api/devices/pair', body), 'TV terhubung')) onClose()
  }
  return (
    <Modal title="Hubungkan TV" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <ol className="grid list-decimal gap-1 pl-5 text-sm text-muted">
          <li>
            Di TV, buka browser dan kunjungi <span className="font-semibold break-all text-ink">{playerUrl}</span>
          </li>
          <li>Ketik kode 6 karakter yang muncul di layar TV ke kolom di bawah.</li>
        </ol>
        <Input
          label="Kode di layar TV"
          name="code"
          required
          minLength={6}
          maxLength={6}
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          className="text-center text-2xl font-bold tracking-[0.3em] uppercase"
        />
        <Input label="Nama layar" name="name" required maxLength={80} placeholder="TV Lobi" />
        <Select label="Cabang" name="branchId" required>
          <BranchOptions branches={branches} />
        </Select>
        <Button type="submit" variant="primary" busy={busy}>
          Hubungkan
        </Button>
      </form>
    </Modal>
  )
}

function DeviceDialog({ device, branches, onClose }: { device: Device; branches: Branch[]; onClose: () => void }) {
  const { run, busy } = useAction()
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const body = {
      name: form.get('name'),
      branchId: form.get('branchId'),
      rotation: Number(form.get('rotation')),
    }
    if (await run(() => api('PATCH', `/api/devices/${device.id}`, body), 'Layar diperbarui')) onClose()
  }
  return (
    <Modal title="Ubah layar" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Input label="Nama layar" name="name" defaultValue={device.name} required maxLength={80} autoFocus />
        <Select label="Cabang" name="branchId" defaultValue={device.branchId} required>
          <BranchOptions branches={branches} />
        </Select>
        <Select
          label="Orientasi layar"
          name="rotation"
          defaultValue={String(device.rotation)}
          hint="Untuk TV yang dipasang berdiri. Tampilan diputar di TV, file tidak diolah ulang."
        >
          <option value="0">Mendatar (normal)</option>
          <option value="90">Tegak, putar 90°</option>
          <option value="270">Tegak, putar 270°</option>
        </Select>
        <Button type="submit" variant="primary" busy={busy}>
          Simpan
        </Button>
      </form>
    </Modal>
  )
}

const OTHER_CITY = '__lain'

function BranchDialog({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const { run, busy } = useAction()
  const saved = branch?.prayer
  const [timezone, setTimezone] = useState<Timezone>(branch?.timezone ?? 'Asia/Jakarta')
  const [enabled, setEnabled] = useState(saved?.enabled ?? false)
  const [city, setCity] = useState(saved?.city && saved.city in CITIES ? saved.city : saved?.lat != null ? OTHER_CITY : 'Jakarta')
  const [lat, setLat] = useState(String(saved?.lat ?? ''))
  const [lng, setLng] = useState(String(saved?.lng ?? ''))
  const savedTicker = branch?.ticker
  const [tickerOn, setTickerOn] = useState(savedTicker?.enabled ?? false)
  const [tickerText, setTickerText] = useState(savedTicker?.text ?? '')
  const [tickerSpeed, setTickerSpeed] = useState(savedTicker?.speed ?? 120)
  const [tickerBg, setTickerBg] = useState(savedTicker?.bg ?? '#000000')

  const custom = city === OTHER_CITY
  const place = custom ? ([Number(lat), Number(lng)] as const) : CITIES[city]
  const valid = !custom || (lat !== '' && lng !== '' && Math.abs(place[0]) <= 90 && Math.abs(place[1]) <= 180)
  const tickerValid = !tickerOn || !!tickerText.trim()

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const body = {
      name: form.get('name'),
      timezone,
      prayer: {
        enabled,
        city: custom ? null : city,
        lat: enabled ? place[0] : (saved?.lat ?? null),
        lng: enabled ? place[1] : (saved?.lng ?? null),
        pause: Number(form.get('pause') ?? saved?.pause ?? 10),
        jumat: Number(form.get('jumat') ?? saved?.jumat ?? 45),
      },
      ticker: {
        enabled: tickerOn,
        text: tickerOn ? tickerText.trim() : null,
        speed: tickerSpeed,
        bg: tickerBg,
      },
    }
    const ok = await run(
      () => (branch ? api('PATCH', `/api/branches/${branch.id}`, body) : api('POST', '/api/branches', body)),
      'Cabang disimpan',
    )
    if (ok) onClose()
  }

  const today =
    enabled && valid
      ? todaysPrayers({ lat: place[0], lng: place[1], offset: TIMEZONES[timezone].offset, pause: 0, jumat: 0 }, Date.now())
      : null

  return (
    <Modal title={branch ? 'Ubah cabang' : 'Tambah cabang'} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Input label="Nama cabang" name="name" defaultValue={branch?.name} required maxLength={80} autoFocus />
        <Select
          label="Zona waktu"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value as Timezone)}
          hint="Jadwal tayang di cabang ini mengikuti zona waktu ini."
        >
          {(Object.keys(TIMEZONES) as Timezone[]).map((tz) => (
            <option key={tz} value={tz}>
              {TIMEZONES[tz].label} (UTC+{TIMEZONES[tz].offset})
            </option>
          ))}
        </Select>

        <div className="grid gap-3 border-t border-line pt-3">
          <Check
            label="Jeda tayangan saat waktu sholat"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {enabled && (
            <>
              <Select label="Kota" value={city} onChange={(e) => setCity(e.target.value)} hint="Pilih kota terdekat dari cabang ini.">
                {Object.keys(CITIES)
                  .sort()
                  .map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                <option value={OTHER_CITY}>Kota lain (isi koordinat)</option>
              </Select>
              {custom && (
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Lintang" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-7.9666" required />
                  <Input label="Bujur" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="112.6326" required />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Input label="Lama jeda (menit)" name="pause" type="number" min={1} max={60} defaultValue={saved?.pause ?? 10} required />
                <Input label="Jeda sholat Jumat (menit)" name="jumat" type="number" min={1} max={120} defaultValue={saved?.jumat ?? 45} required />
              </div>
              {today && (
                <dl className="flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-sunken px-3 py-2 text-sm">
                  {today.map((p) => (
                    <div key={p.prayer}>
                      <dt className="text-muted">{p.label}</dt>
                      <dd className="font-semibold tabular-nums">{clockLabel(p.minutes)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="text-sm text-muted">
                Waktu dihitung dengan kriteria Kemenag untuk hari ini. Selama jeda, TV menampilkan keterangan waktu sholat,
                lalu melanjutkan tayangan sendiri, juga saat internet putus.
              </p>
            </>
          )}
        </div>

        <div className="grid gap-3 border-t border-line pt-3">
          <Check
            label="Teks berjalan di bawah tayangan"
            checked={tickerOn}
            onChange={(e) => setTickerOn(e.target.checked)}
          />
          {tickerOn && (
            <>
              <Input
                label="Teks"
                value={tickerText}
                onChange={(e) => setTickerText(e.target.value)}
                maxLength={200}
                placeholder="Promo hari ini, jam buka, atau pengumuman"
                hint="Berjalan di semua layar cabang ini. Bisa diganti tanpa membuat video baru."
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <Select label="Kecepatan" value={tickerSpeed} onChange={(e) => setTickerSpeed(Number(e.target.value))}>
                  {TICKER_SPEEDS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
                <div className="grid content-start gap-1.5">
                  <label htmlFor="ticker-bg" className="text-sm font-semibold">
                    Warna latar
                  </label>
                  <input
                    id="ticker-bg"
                    type="color"
                    value={tickerBg}
                    onChange={(e) => setTickerBg(e.target.value)}
                    className="h-11 w-16 cursor-pointer rounded-md border border-line bg-surface p-1"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <Button type="submit" variant="primary" busy={busy} disabled={(enabled && !valid) || !tickerValid}>
          Simpan
        </Button>
      </form>
    </Modal>
  )
}
