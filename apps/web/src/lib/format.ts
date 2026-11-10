export const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
export const fmtNum = (n?: number, d = 3) => (n === undefined || n === null ? '—' : Number.isInteger(n) ? n.toLocaleString('fr-FR') : n.toFixed(d))
export const shortId = (id?: string) => (id ? (id.length > 14 ? id.slice(0, 12) + '…' : id) : '—')
export const pct = (n: number) => `${Math.round(n * 1000) / 10} %`
export function ago(iso?: string) {
  if (!iso) return '—'; const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'à l\'instant'; if (s < 3600) return `il y a ${Math.floor(s / 60)} min`; if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`; return `il y a ${Math.floor(s / 86400)} j`
}
export const clsx = (...a: (string | false | undefined | null)[]) => a.filter(Boolean).join(' ')
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
