import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api, useAuthConfig } from '../lib/api'
import { Button, FormError, Input } from '../ui'

const OAUTH_ERRORS: Record<string, string> = {
  google_dibatalkan: 'Masuk dengan Google dibatalkan. Silakan coba lagi.',
  google_gagal: 'Google tidak bisa memverifikasi akun Anda. Pastikan email Google sudah terverifikasi.',
  tanpa_usaha: 'Akun ini tidak terhubung ke usaha mana pun. Minta admin usaha Anda untuk menambahkan Anda kembali.',
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const config = useAuthConfig()

  const [step, setStep] = useState<'form' | '2fa'>(params.get('langkah') === '2fa' ? '2fa' : 'form')
  const [withEmail, setWithEmail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(OAUTH_ERRORS[params.get('error') ?? ''] ?? null)

  const enter = async () => {
    await qc.invalidateQueries()
    navigate('/', { replace: true })
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    setBusy(true)
    setError(null)
    try {
      if (step === '2fa') {
        await api('POST', '/api/auth/2fa/verify', { code: form.code })
        await enter()
      } else if (mode === 'register') {
        await api('POST', '/api/auth/register', form)
        await enter()
      } else {
        const res = await api<{ twofa: boolean }>('POST', '/api/auth/login', form)
        if (res.twofa) setStep('2fa')
        else await enter()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan')
    } finally {
      setBusy(false)
    }
  }

  const google = config.data?.google === true
  const showEmailForm = step === 'form' && (withEmail || !google)

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <main className="flex items-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <p className="text-lg font-bold">AdCast</p>
          <h1 className="mt-8 text-3xl font-bold tracking-tight">
            {step === '2fa' ? 'Verifikasi dua langkah' : mode === 'login' ? 'Masuk ke dashboard' : 'Daftarkan usaha Anda'}
          </h1>
          <p className="mt-2 text-muted">
            {step === '2fa'
              ? 'Buka aplikasi autentikator di HP Anda, lalu masukkan 6 digit kodenya.'
              : mode === 'login'
                ? 'Kelola tayangan semua TV Anda dari satu tempat.'
                : 'Satu akun untuk mengatur tayangan di semua TV kantor, toko, atau cabang.'}
          </p>

          <div className="mt-8 grid gap-4">
            <FormError message={error} />

            {step === 'form' && google && (
              <>
                <a
                  href="/api/auth/google"
                  className="inline-flex min-h-12 items-center justify-center gap-3 rounded-md bg-ink px-4 font-semibold text-bg hover:opacity-90"
                >
                  <GoogleMark />
                  {mode === 'login' ? 'Masuk dengan Google' : 'Daftar dengan Google'}
                </a>
                {!withEmail && (
                  <Button onClick={() => setWithEmail(true)}>
                    {mode === 'login' ? 'Masuk dengan email dan kata sandi' : 'Daftar dengan email dan kata sandi'}
                  </Button>
                )}
              </>
            )}

            {(showEmailForm || step === '2fa') && (
              <form onSubmit={submit} className="grid gap-4">
                {google && step === 'form' && <p className="text-sm font-semibold text-muted">Atau pakai email</p>}
                {step === '2fa' ? (
                  <Input
                    label="Kode 6 digit"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9 ]{6,7}"
                    required
                    autoFocus
                  />
                ) : (
                  <>
                    {mode === 'register' && (
                      <>
                        <Input label="Nama usaha" name="businessName" required minLength={2} maxLength={80} autoComplete="organization" />
                        <Input label="Nama Anda" name="name" required minLength={2} maxLength={80} autoComplete="name" />
                      </>
                    )}
                    <Input label="Email" name="email" type="email" required autoComplete="email" />
                    <Input
                      label="Kata sandi"
                      name="password"
                      type="password"
                      required
                      minLength={mode === 'register' ? 8 : undefined}
                      hint={mode === 'register' ? 'Minimal 8 karakter.' : undefined}
                      autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    />
                  </>
                )}
                <Button type="submit" variant={google && step === 'form' ? 'plain' : 'primary'} busy={busy}>
                  {step === '2fa' ? 'Verifikasi' : mode === 'login' ? 'Masuk' : 'Buat akun usaha'}
                </Button>
              </form>
            )}
          </div>

          {step === 'form' && (
            <p className="mt-8 text-muted">
              {mode === 'login' ? 'Belum punya akun? ' : 'Sudah punya akun? '}
              <Link to={mode === 'login' ? '/daftar' : '/masuk'} className="font-semibold text-ink underline">
                {mode === 'login' ? 'Daftarkan usaha Anda' : 'Masuk di sini'}
              </Link>
            </p>
          )}
        </div>
      </main>

      <aside className="hidden bg-screen p-10 text-white lg:flex lg:flex-col lg:justify-center" aria-hidden>
        <ScreenWall />
        <p className="mt-10 max-w-md text-2xl font-bold leading-snug">
          Ganti video di semua TV tanpa berkeliling membawa flashdisk.
        </p>
        <p className="mt-3 max-w-md text-white/75">
          Kirim video, atur jadwal tayang, dan pantau kondisi setiap layar dari satu dashboard.
        </p>
      </aside>
    </div>
  )
}

// Abstract wall of TVs: the same tile shape the Pantau page uses for real screens.
function ScreenWall() {
  const tiles = ['bg-brand', 'bg-white/10', 'bg-brand', 'bg-brand', 'bg-brand', 'bg-white/10']
  return (
    <div className="grid max-w-md grid-cols-3 gap-3">
      {tiles.map((tone, i) => (
        <div key={i} className={`aspect-video rounded-md ${tone}`} />
      ))}
    </div>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.300-2.1 3.500-5.200 3.500-8.700Z" />
      <path fill="#34A853" d="M12 24c3.200 0 6-1.100 8-2.900l-3.900-3c-1.100.7-2.500 1.200-4.100 1.200-3.100 0-5.800-2.100-6.700-5H1.300v3.100A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.300 14.300a7.200 7.200 0 0 1 0-4.600V6.600H1.300a12 12 0 0 0 0 10.800l4-3.100Z" />
      <path fill="#EA4335" d="M12 4.800c1.800 0 3.300.6 4.600 1.800l3.400-3.400A12 12 0 0 0 1.300 6.600l4 3.100c.9-2.900 3.600-4.900 6.700-4.900Z" />
    </svg>
  )
}
