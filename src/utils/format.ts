export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toLocaleString('pt-BR', { maximumFractionDigits: idx === 0 ? 0 : 1 })} ${units[idx]}`;
}

export function formatNumber(n: number): string {
  return (n || 0).toLocaleString('pt-BR');
}

export function resolveCdnUrl(cdnBase: string, relUrl: string | null | undefined): string {
  if (!relUrl) return '';
  if (/^(https?:|blob:|data:|zip-backup:)/i.test(relUrl)) return relUrl;
  const cleanRel = relUrl.replace(/^\/+/, '');
  if (cdnBase.startsWith('zip-backup://')) {
    return `zip-backup://${cleanRel}`;
  }
  return `${cdnBase.replace(/\/?$/, '/')}${cleanRel}`;
}
