import qrcode from 'qrcode-generator'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api, can, useAuthConfig, useMe, type Me } from '../lib/api'
import { Button, Failed, Input, Loading, PageHeader, useAction, useToast } from '../ui'

export default function Settings() {
  const me = useMe()
  const [params] = useSearchParams()
  if (me.isPending) return <Loading what="pengaturan" />
  if (me.error) return <Failed error={me.error} retry={() => me.refetch()} />

  return (
    <>
      <PageHeader title="Pengaturan" />
      {params.get('baru') && (
        <p role="status" className="mb-6 rounded-md border border-line bg-surface px-4 py-3">
          <span className="font-semibold">Akun Anda sudah jadi.</span> Kami memberi nama sementara untuk usaha Anda. Ganti
          dengan nama usaha yang sebenarnya di bawah ini, lalu hubungkan TV pertama lewat menu Layar.
        </p>
      )}
      <div className="grid max-w-2xl gap-10">
        {can(me.data, 'settings') && <Business me={me.data} />}
        <Alerts me={me.data} />
        <TwoFactor me={me.data} />
        <Password me={me.data} />
      </div>
    </>
  )
}

function Section({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        {lead && <p className="mt-1 text-muted">{lead}</p>}
      </div>
      {children}
    </section>
  )
}

function Business({ me }: { me: Me }) {
  const { run, busy } = useAction()
  const [color, setColor] = useState(me.tenant.brandColor)
  const branding = me.tenant.limits.branding

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    run(
      () =>
        api('PATCH', '/api/tenant', {
          name: form.get('name'),
          brandColor: color,
          alertThreshold: Number(form.get('alertThreshold')),
        }),
      'Pengaturan usaha disimpan',
    )
  }

  const uploadLogo = (file: File | undefined) => {
    if (!file) return
    run(() => api('PUT', '/api/tenant/logo', file), 'Logo diganti')
  }

  return (
    <Section title="Identitas usaha" lead="Nama, logo, dan warna ini tampil di dashboard dan di layar TV saat tidak ada tayangan.">
      <form onSubmit={save} className="grid gap-4">
        <Input label="Nama usaha" name="name" defaultValue={me.tenant.name} required minLength={2} maxLength={80} />
        <div className="grid gap-1.5">
          <label htmlFor="warna-usaha" className="text-sm font-semibold">
            Warna usaha
          </label>
          <div className="flex items-center gap-3">
            <input
              id="warna-usaha"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              disabled={!branding}
              className="h-11 w-16 cursor-pointer rounded-md border border-line bg-surface p-1 disabled:cursor-not-allowed disabled:opacity-55"
            />
            <span className="text-sm text-muted tabular-nums">{color}</span>
          </div>
        </div>
        <Input
          label="Kirim peringatan saat layar offline mencapai"
          name="alertThreshold"
          type="number"
          min={1}
          max={1000}
          defaultValue={me.tenant.alertThreshold}
          required
          hint="Jumlah layar offline bersamaan yang dianggap perlu diperhatikan."
        />
        <div>
          <Button type="submit" variant="primary" busy={busy}>
            Simpan
          </Button>
        </div>
      </form>

      <div className="grid gap-2">
        <p className="text-sm font-semibold">Logo</p>
        <div className="flex flex-wrap items-center gap-4">
          {me.tenant.logoUrl ? (
            <img src={me.tenant.logoUrl} alt={`Logo ${me.tenant.name}`} className="size-16 rounded-md border border-line object-contain" />
          ) : (
            <p className="text-sm text-muted">Belum ada logo. Inisial nama usaha dipakai sebagai gantinya.</p>
          )}
          {branding && (
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-line bg-surface px-4 font-semibold hover:bg-sunken has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink">
              {me.tenant.logoUrl ? 'Ganti logo' : 'Pilih logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => {
                  uploadLogo(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
          )}
          {me.tenant.logoUrl && (
            <Button variant="danger" onClick={() => run(() => api('DELETE', '/api/tenant/logo'), 'Logo dihapus')}>
              Hapus logo
            </Button>
          )}
        </div>
        {branding ? (
          <p className="text-sm text-muted">PNG, JPG, atau WebP, maksimal 512 KB.</p>
        ) : (
          <p className="text-sm text-muted">
            Logo dan warna usaha sendiri tersedia mulai paket Pro.{' '}
            <Link to="/paket" className="font-semibold text-ink underline">
              Lihat paket
            </Link>
          </p>
        )}
      </div>
    </Section>
  )
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
}

function Alerts({ me }: { me: Me }) {
  const toast = useToast()
  const supported = 'serviceWorker' in navigator && 'PushManager' in window
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => setSubscribed(false))
  }, [supported])

  const enable = async () => {
    setBusy(true)
    try {
      if ((await Notification.requestPermission()) !== 'granted') {
        throw new Error('Izin notifikasi ditolak. Izinkan notifikasi untuk situs ini di pengaturan browser.')
      }
      await navigator.serviceWorker.register('/sw.js')
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(me.push.publicKey!),
      })
      await api('POST', '/api/push/subscribe', { endpoint: sub.endpoint })
      setSubscribed(true)
      toast('Notifikasi aktif di perangkat ini')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengaktifkan notifikasi', true)
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint })
        await sub.unsubscribe()
      }
      setSubscribed(false)
      toast('Notifikasi dimatikan di perangkat ini')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="Notifikasi ke HP"
      lead={`Anda diberi tahu saat ${me.tenant.alertThreshold} layar atau lebih offline bersamaan. Aktifkan di tiap HP atau komputer yang ingin menerima.`}
    >
      {!me.push.publicKey ? (
        <p className="text-muted">
          Notifikasi push belum disiapkan di server ini. Peringatan layar offline tetap muncul di halaman Pantau.
        </p>
      ) : !supported ? (
        <p className="text-muted">
          Browser ini tidak mendukung notifikasi. Di iPhone, tambahkan AdCast ke Layar Utama lebih dulu lewat menu Bagikan.
        </p>
      ) : (
        <div>
          {subscribed ? (
            <Button busy={busy} onClick={disable}>
              Matikan notifikasi di perangkat ini
            </Button>
          ) : (
            <Button variant="primary" busy={busy} onClick={enable}>
              Aktifkan notifikasi di perangkat ini
            </Button>
          )}
        </div>
      )}
    </Section>
  )
}

function TwoFactor({ me }: { me: Me }) {
  const { run, busy } = useAction()
  const google = useAuthConfig().data?.google === true
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null)
  const [disabling, setDisabling] = useState(false)

  const begin = async () => {
    const res = await run(() => api<{ secret: string; uri: string }>('POST', '/api/auth/2fa/setup'))
    if (!res) return
    const qr = qrcode(0, 'M')
    qr.addData(res.uri)
    qr.make()
    setSetup({ secret: res.secret, qr: qr.createDataURL(5, 10) })
  }

  const confirm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const code = new FormData(e.currentTarget).get('code')
    const path = disabling ? '/api/auth/2fa/disable' : '/api/auth/2fa/enable'
    const done = disabling ? 'Verifikasi dua langkah dimatikan' : 'Verifikasi dua langkah aktif'
    if (await run(() => api('POST', path, { code }), done)) {
      setSetup(null)
      setDisabling(false)
    }
  }

  const codeForm = (
    <form onSubmit={confirm} className="grid max-w-xs gap-3">
      <Input
        label="Kode 6 digit dari aplikasi"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]{6,7}"
        required
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={busy}>
          {disabling ? 'Matikan' : 'Aktifkan'}
        </Button>
        <Button
          onClick={() => {
            setSetup(null)
            setDisabling(false)
          }}
        >
          Batal
        </Button>
      </div>
    </form>
  )

  return (
    <Section
      title="Verifikasi dua langkah"
      lead={`Setiap masuk, Anda diminta kode dari aplikasi autentikator (Google Authenticator, Authy, dan sejenisnya) selain ${google ? 'kata sandi atau akun Google' : 'kata sandi'}.`}
    >
      {me.user.totpEnabled ? (
        disabling ? (
          codeForm
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <p className="font-semibold text-ok">Aktif</p>
            <Button onClick={() => setDisabling(true)}>Matikan</Button>
          </div>
        )
      ) : setup ? (
        <div className="grid gap-4">
          <ol className="grid list-decimal gap-1 pl-5 text-muted">
            <li>Buka aplikasi autentikator di HP, lalu pindai kode QR ini.</li>
            <li>Masukkan 6 digit yang muncul untuk menyelesaikan.</li>
          </ol>
          <img src={setup.qr} alt="Kode QR untuk aplikasi autentikator" className="size-48 rounded-md border border-line" />
          <p className="text-sm text-muted">
            Tidak bisa memindai? Ketik kunci ini di aplikasi: <span className="font-semibold break-all text-ink">{setup.secret}</span>
          </p>
          {codeForm}
        </div>
      ) : (
        <div>
          <Button busy={busy} onClick={begin}>
            Siapkan verifikasi dua langkah
          </Button>
        </div>
      )}
    </Section>
  )
}

function Password({ me }: { me: Me }) {
  const { run, busy } = useAction()
  const google = useAuthConfig().data?.google === true
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const body = Object.fromEntries(new FormData(form))
    if (await run(() => api('POST', '/api/auth/password', body), 'Kata sandi disimpan')) form.reset()
  }
  return (
    <Section
      title="Kata sandi"
      lead={
        me.user.hasPassword
          ? `Dipakai untuk masuk dengan email ${me.user.email}.`
          : google
            ? 'Akun Anda masuk lewat Google. Buat kata sandi jika ingin juga bisa masuk dengan email.'
            : 'Akun Anda belum punya kata sandi. Buat sekarang supaya bisa masuk dengan email.'
      }
    >
      <form onSubmit={submit} className="grid max-w-xs gap-3">
        {me.user.hasPassword && (
          <Input label="Kata sandi saat ini" name="current" type="password" required autoComplete="current-password" />
        )}
        <Input
          label="Kata sandi baru"
          name="next"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          hint="Minimal 8 karakter."
        />
        <div>
          <Button type="submit" busy={busy}>
            {me.user.hasPassword ? 'Ganti kata sandi' : 'Buat kata sandi'}
          </Button>
        </div>
      </form>
    </Section>
  )
}
