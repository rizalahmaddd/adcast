import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, X } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')
export { cx }

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'plain' | 'danger'
  busy?: boolean
  small?: boolean
}

export function Button({ variant = 'plain', busy, small, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        // Compact only where a pointer is likely; touch screens keep the full 44px target.
        small ? 'min-h-11 px-3 text-sm sm:min-h-9' : 'min-h-11 px-4 text-[0.95rem]',
        variant === 'primary' && 'bg-brand text-on-brand hover:brightness-110',
        variant === 'plain' && 'border border-line bg-surface text-ink hover:bg-sunken',
        variant === 'danger' && 'border border-bad/50 bg-surface text-bad hover:bg-bad/10',
        className,
      )}
    >
      {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

const control =
  'min-h-11 w-full rounded-md border border-line bg-surface px-3 text-[0.95rem] text-ink placeholder:text-muted/70 disabled:opacity-60'

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  )
}

export function Input({ label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return <Field label={label} hint={hint}>{(id) => <input id={id} {...rest} className={cx(control, rest.className)} />}</Field>
}

export function Select({
  label,
  hint,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <select id={id} {...rest} className={cx(control, rest.className)}>
          {children}
        </select>
      )}
    </Field>
  )
}

export function Check({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-sunken">
      <input type="checkbox" {...rest} />
      <span className="text-[0.95rem]">{label}</span>
    </label>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        'm-auto max-h-[92dvh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-line bg-surface p-0 text-ink shadow-xl',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      <div className="sticky top-0 flex items-center justify-between gap-4 border-b border-line bg-surface px-5 py-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          className="grid size-11 place-items-center rounded-md hover:bg-sunken"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  )
}

export function PageHeader({ title, lead, action }: { title: string; lead?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-[1.7rem]">{title}</h1>
        {lead && <p className="mt-1 max-w-2xl text-muted">{lead}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </header>
  )
}

export function Loading({ what }: { what: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-10 text-muted">
      <LoaderCircle className="size-5 animate-spin" aria-hidden />
      Memuat {what}
    </p>
  )
}

export function Failed({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-bad/40 bg-bad/5 p-4">
      <p className="font-semibold text-bad">Gagal memuat data</p>
      <p className="mt-1 text-sm">{error instanceof Error ? error.message : 'Terjadi kesalahan yang tidak dikenal.'}</p>
      {retry && (
        <Button small className="mt-3" onClick={retry}>
          Coba lagi
        </Button>
      )}
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-5 py-10 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm font-medium text-bad">
      {message}
    </p>
  )
}

type Toast = { id: number; text: string; bad: boolean }
const ToastContext = createContext<(text: string, bad?: boolean) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, bad = false) => {
    const id = Date.now() + Math.random()
    setToasts((list) => [...list, { id, text, bad }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), bad ? 7000 : 3500)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 grid justify-items-center gap-2 px-4">
        {toasts.map((t) => (
          <p
            key={t.id}
            className={cx(
              'pointer-events-auto max-w-md rounded-md px-4 py-3 text-sm font-semibold shadow-lg',
              t.bad ? 'bg-bad text-white dark:text-black' : 'bg-ink text-bg',
            )}
          >
            {t.text}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

/** Runs a mutation, refreshes cached data, and reports the outcome as a toast. */
export function useAction() {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, done?: string | ((result: T) => string)): Promise<T | undefined> => {
      setBusy(true)
      try {
        const result = await fn()
        await qc.invalidateQueries()
        if (done) toast(typeof done === 'function' ? done(result) : done)
        return result
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Terjadi kesalahan', true)
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [qc, toast],
  )
  return { run, busy }
}
