const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com']

const hostOf = (input: string) => {
  try {
    return new URL(input).hostname.replace(/^(www|m|music)\./, '')
  } catch {
    return null
  }
}

export const isYoutubeLink = (input: string) => /^[\w-]{11}$/.test(input) || YOUTUBE_HOSTS.includes(hostOf(input) ?? '')

/** A share link rewritten to the address that returns the file itself, or null if it can't be used. */
export function directVideoLink(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  // Dashboards run on https, where browsers refuse to load http video.
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.hostname === 'localhost' || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) return null
  if (hostOf(url.href) === 'dropbox.com') {
    url.searchParams.delete('dl')
    url.searchParams.set('raw', '1')
  }
  return url.href
}
