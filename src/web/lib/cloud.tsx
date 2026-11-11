import { useState } from 'react'
import type { Incoming } from '../pages/Videos'
import { Button, Modal, useToast } from '../ui'
import { useMe } from './api'

type Source = 'gdrive' | 'dropbox' | 'onedrive'
type OnFiles = (files: Incoming[], source: Source) => void

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    gapi?: any
    google?: any
    Dropbox?: any
    OneDrive?: any
  }
}

function loadScript(src: string, attrs: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const el = document.createElement('script')
    el.src = src
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    el.onload = () => resolve()
    el.onerror = () => {
      el.remove()
      reject(new Error('Gagal memuat layanan cloud. Periksa koneksi internet Anda.'))
    }
    document.head.append(el)
  })
}

async function download(url: string, headers?: Record<string, string>): Promise<Blob> {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`File tidak bisa diambil dari cloud (${res.status})`)
  return res.blob()
}

const DRIVE_VIDEO_TYPES =
  'video/mp4,video/quicktime,video/x-matroska,video/x-msvideo,video/webm,video/x-m4v,video/mpeg,video/x-ms-wmv,video/x-flv,video/3gpp'
const DRIVE_FOLDER = 'application/vnd.google-apps.folder'

async function pickFromDrive(clientId: string, apiKey: string): Promise<Incoming[]> {
  await Promise.all([loadScript('https://accounts.google.com/gsi/client'), loadScript('https://apis.google.com/js/api.js')])
  await new Promise<void>((resolve) => window.gapi.load('picker', resolve))

  const token = await new Promise<string>((resolve, reject) => {
    window.google.accounts.oauth2
      .initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (res: any) => (res.access_token ? resolve(res.access_token) : reject(new Error('Akses Google Drive ditolak'))),
        error_callback: () => reject(new Error('Jendela izin Google ditutup sebelum selesai')),
      })
      .requestAccessToken()
  })
  const auth = { Authorization: `Bearer ${token}` }

  const picked = await new Promise<any[]>((resolve) => {
    const picker = window.google.picker
    const view = new picker.DocsView(picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(`${DRIVE_VIDEO_TYPES},${DRIVE_FOLDER}`)
    new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setLocale('id')
      .setCallback((data: any) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs)
        else if (data.action === picker.Action.CANCEL) resolve([])
      })
      .build()
      .setVisible(true)
  })

  const files: { id: string; name: string }[] = []
  for (const doc of picked) {
    if (doc.mimeType !== DRIVE_FOLDER) {
      files.push({ id: doc.id, name: doc.name })
      continue
    }
    // A picked folder means "every video directly inside it".
    let pageToken = ''
    do {
      const query = new URLSearchParams({
        q: `'${doc.id}' in parents and mimeType contains 'video/' and trashed = false`,
        fields: 'nextPageToken, files(id, name)',
        pageSize: '200',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        ...(pageToken && { pageToken }),
      })
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${query}`, { headers: auth })
      if (!res.ok) throw new Error('Isi folder Google Drive tidak bisa dibaca')
      const page = (await res.json()) as { nextPageToken?: string; files: { id: string; name: string }[] }
      files.push(...page.files)
      pageToken = page.nextPageToken ?? ''
    } while (pageToken)
  }

  return files.map((f) => ({
    name: f.name,
    load: () => download(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`, auth),
  }))
}

async function pickFromDropbox(appKey: string): Promise<Incoming[]> {
  await loadScript('https://www.dropbox.com/static/api/2/dropins.js', { id: 'dropboxjs', 'data-app-key': appKey })
  return new Promise((resolve) => {
    window.Dropbox.choose({
      linkType: 'direct',
      multiselect: true,
      extensions: ['video'],
      success: (files: { name: string; link: string }[]) =>
        resolve(files.map((f) => ({ name: f.name, load: () => download(f.link) }))),
      cancel: () => resolve([]),
    })
  })
}

async function pickFromOneDrive(clientId: string): Promise<Incoming[]> {
  await loadScript('https://js.live.net/v7.2/OneDrive.js')
  return new Promise((resolve, reject) => {
    window.OneDrive.open({
      clientId,
      action: 'download',
      multiSelect: true,
      advanced: { filter: 'folder,video', redirectUri: `${location.origin}/onedrive-picker.html` },
      success: (res: { value: { name: string; '@microsoft.graph.downloadUrl': string }[] }) =>
        resolve(res.value.map((f) => ({ name: f.name, load: () => download(f['@microsoft.graph.downloadUrl']) }))),
      cancel: () => resolve([]),
      error: () => reject(new Error('OneDrive tidak bisa dibuka')),
    })
  })
}

export function CloudImport({ onFiles }: { onFiles: OnFiles }) {
  const me = useMe()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const keys = me.data?.integrations

  const providers: { source: Source; label: string; hint?: string; pick: (() => Promise<Incoming[]>) | null }[] = [
    {
      source: 'gdrive',
      label: 'Google Drive',
      hint: 'Pilih beberapa video, atau satu folder untuk mengambil semua video di dalamnya.',
      pick: keys?.googleClientId && keys.googleApiKey ? () => pickFromDrive(keys.googleClientId!, keys.googleApiKey!) : null,
    },
    { source: 'dropbox', label: 'Dropbox', pick: keys?.dropboxAppKey ? () => pickFromDropbox(keys.dropboxAppKey!) : null },
    { source: 'onedrive', label: 'OneDrive', pick: keys?.onedriveClientId ? () => pickFromOneDrive(keys.onedriveClientId!) : null },
  ]
  const available = providers.filter((p) => p.pick)
  // Nothing to offer until the operator sets at least one provider key.
  if (!available.length) return null

  const start = async (source: Source, pick: () => Promise<Incoming[]>) => {
    setOpen(false)
    try {
      const files = await pick()
      if (files.length) onFiles(files, source)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Impor gagal', true)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Impor dari cloud</Button>
      {open && (
        <Modal title="Impor dari cloud" onClose={() => setOpen(false)}>
          <div className="grid gap-3">
            {available.map((p) => (
              <div key={p.source} className="grid gap-1">
                <Button onClick={() => start(p.source, p.pick!)}>{p.label}</Button>
                {p.hint && <p className="text-sm text-muted">{p.hint}</p>}
              </div>
            ))}
            <p className="text-sm text-muted">
              File diambil lewat browser ini, diperiksa, lalu diunggah. Biarkan tab ini terbuka sampai selesai.
            </p>
          </div>
        </Modal>
      )}
    </>
  )
}
