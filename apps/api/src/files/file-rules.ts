/** Pure rules for uploaded files: what may be stored, how it is named and how it may be served. */

/** Extensions that run code or install software when opened. Blocked outright (TZ: decisions-needed #15). */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'com', 'bat', 'cmd', 'scr', 'msi', 'msp', 'dll', 'sys', 'cpl', 'lnk', 'pif', 'reg',
  'js', 'jse', 'mjs', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'psm1', 'sh', 'bash', 'zsh', 'csh',
  'jar', 'apk', 'app', 'deb', 'rpm', 'dmg', 'pkg', 'hta', 'chm', 'iso', 'appimage', 'bin', 'run',
  'html', 'htm', 'xhtml', 'svg', 'swf',
]);

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const DEFAULT_MAX_UPLOAD_MB = 25;

export const maxUploadBytes = () => Math.floor(Number(process.env.MAX_UPLOAD_MB ?? DEFAULT_MAX_UPLOAD_MB) * 1024 * 1024);

/** Every extension in the name counts, so "report.pdf.exe" and "archive.exe.txt" are both caught. */
export function hasBlockedExtension(name: string): boolean {
  const parts = name.toLowerCase().split('.').slice(1);
  return parts.some((p) => BLOCKED_EXTENSIONS.has(p.trim()));
}

/**
 * The name is only stored as text and offered back as the download name; it never becomes a path.
 * Still, strip directory parts, control and bidi-override characters (which can disguise "txt.exe"), and cap the length.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\u202a-\u202e\u2066-\u2069\u200e\u200f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  const name = cleaned.length > 200 ? cleaned.slice(-200) : cleaned;
  return name || 'file';
}

/**
 * Multer reads the multipart filename as Latin-1. If the bytes are in fact UTF-8 (every modern browser), repair it.
 * Text that is already correct (contains characters above U+00FF) is left alone.
 */
export function repairFileNameEncoding(name: string): string {
  if ([...name].some((c) => c.charCodeAt(0) > 0xff)) return name;
  const fixed = Buffer.from(name, 'latin1').toString('utf8');
  return fixed.includes('\ufffd') ? name : fixed;
}

export type SafeImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** Recognises raster images by their first bytes. Anything else (including SVG and HTML) returns null. */
export function sniffImage(buf: Buffer): SafeImageMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Content-Disposition value: ASCII fallback plus the RFC 5987 UTF-8 name, so Cyrillic and Kazakh names survive. */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
