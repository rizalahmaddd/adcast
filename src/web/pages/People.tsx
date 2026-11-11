import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ALL_PERMISSIONS, PERMISSIONS, type Permission } from '../../shared/types'
import { api, useAuthConfig, useMe, useRoles, useUsers, type Role } from '../lib/api'
import { Button, Check, Failed, Input, Loading, Modal, PageHeader, Select, useAction } from '../ui'

export default function People() {
  const me = useMe()
  const users = useUsers()
  const roles = useRoles()
  const { run } = useAction()
  const [adding, setAdding] = useState(false)
  const [roleForm, setRoleForm] = useState<Role | 'new' | null>(null)

  if (users.isPending || roles.isPending) return <Loading what="pengguna" />
  if (users.error || roles.error) {
    return <Failed error={users.error ?? roles.error} retry={() => (users.refetch(), roles.refetch())} />
  }

  const removeUser = (id: string, name: string) => {
    if (!confirm(`Keluarkan ${name} dari usaha ini?`)) return
    run(() => api('DELETE', `/api/users/${id}`), 'Pengguna dikeluarkan')
  }
  const removeRole = (role: Role) => {
    if (!confirm(`Hapus peran "${role.name}"?`)) return
    run(() => api('DELETE', `/api/roles/${role.id}`), 'Peran dihapus')
  }

  return (
    <>
      <PageHeader
        title="Pengguna"
        lead="Siapa saja yang bisa masuk ke dashboard, dan apa yang boleh mereka lakukan."
        action={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden /> Tambah pengguna
          </Button>
        }
      />

      <ul className="divide-y divide-line border-y border-line">
        {users.data.map((u) => (
          <li key={u.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_12rem_auto] sm:items-center">
            <div className="min-w-0">
              <p className="font-semibold">
                {u.name} {u.id === me.data?.user.id && <span className="font-medium text-muted">(Anda)</span>}
              </p>
              <p className="truncate text-sm text-muted">
                {u.email}
                {u.totpEnabled ? ', verifikasi dua langkah aktif' : ''}
              </p>
            </div>
            <select
              aria-label={`Peran ${u.name}`}
              value={u.roleId}
              onChange={(e) => run(() => api('PATCH', `/api/users/${u.id}`, { roleId: e.target.value }), 'Peran diubah')}
              className="min-h-11 rounded-md border border-line bg-surface px-3"
            >
              {roles.data.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {u.id !== me.data?.user.id ? (
              <Button small variant="danger" onClick={() => removeUser(u.id, u.name)}>
                Keluarkan
              </Button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>

      <section className="mt-10" aria-labelledby="judul-peran">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="judul-peran" className="text-xl font-bold">
              Peran dan hak akses
            </h2>
            <p className="text-muted">Semua peran bisa melihat status layar. Hak di bawah ini mengatur tindakan lainnya.</p>
          </div>
          <Button onClick={() => setRoleForm('new')}>Buat peran</Button>
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {roles.data.map((role) => (
            <li key={role.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-bold">{role.name}</h3>
                {!role.isOwner && (
                  <div className="flex gap-2">
                    <Button small onClick={() => setRoleForm(role)}>
                      Ubah
                    </Button>
                    <Button small variant="danger" onClick={() => removeRole(role)}>
                      Hapus
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-1 text-sm text-muted">
                {role.isOwner
                  ? 'Akses penuh, tidak bisa diubah.'
                  : role.permissions.length
                    ? role.permissions.map((p) => PERMISSIONS[p]).join('. ') + '.'
                    : 'Hanya melihat.'}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {adding && <AddUserDialog roles={roles.data} onClose={() => setAdding(false)} />}
      {roleForm && <RoleDialog role={roleForm === 'new' ? null : roleForm} onClose={() => setRoleForm(null)} />}
    </>
  )
}

function AddUserDialog({ roles, onClose }: { roles: Role[]; onClose: () => void }) {
  const { run, busy } = useAction()
  const google = useAuthConfig().data?.google === true
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const { password, ...rest } = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    const body = password ? { ...rest, password } : rest
    if (await run(() => api('POST', '/api/users', body), 'Pengguna ditambahkan')) onClose()
  }
  return (
    <Modal title="Tambah pengguna" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Input label="Nama" name="name" required maxLength={80} autoFocus />
        <Input label="Email" name="email" type="email" required />
        <Select label="Peran" name="roleId" required defaultValue={roles.find((r) => !r.isOwner)?.id}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Input
          label={google ? 'Kata sandi awal (opsional)' : 'Kata sandi awal'}
          name="password"
          type="password"
          required={!google}
          minLength={8}
          autoComplete="new-password"
          hint={
            google
              ? 'Kosongkan jika orang ini akan masuk dengan akun Google yang memakai email di atas.'
              : 'Minimal 8 karakter. Orang ini bisa menggantinya setelah masuk.'
          }
        />
        <Button type="submit" variant="primary" busy={busy}>
          Tambahkan
        </Button>
      </form>
    </Modal>
  )
}

function RoleDialog({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const { run, busy } = useAction()
  const [name, setName] = useState(role?.name ?? '')
  const [perms, setPerms] = useState<Permission[]>(role?.permissions ?? [])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = { name, permissions: perms }
    const ok = await run(
      () => (role ? api('PUT', `/api/roles/${role.id}`, body) : api('POST', '/api/roles', body)),
      'Peran disimpan',
    )
    if (ok) onClose()
  }
  return (
    <Modal title={role ? 'Ubah peran' : 'Buat peran'} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Input label="Nama peran" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">Hak akses</legend>
          {ALL_PERMISSIONS.map((p) => (
            <Check
              key={p}
              label={PERMISSIONS[p]}
              checked={perms.includes(p)}
              onChange={() => setPerms((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]))}
            />
          ))}
        </fieldset>
        <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>
          Simpan peran
        </Button>
      </form>
    </Modal>
  )
}
