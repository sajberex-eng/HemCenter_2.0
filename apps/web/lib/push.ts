import { api } from './api';

export type PushState = 'unsupported' | 'ios-install' | 'server-off' | 'denied' | 'off' | 'on';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) return existing;
  // On the very first visit the worker is still being installed. Wait for it, but not forever: the worker is
  // only registered in production builds, and in development "ready" would never resolve.
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))]);
}

function toKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined') return 'unsupported';
  // iOS exposes push only to apps added to the Home Screen, so the API looks "missing" in a normal Safari tab
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!supported()) return 'unsupported';
  const reg = await registration();
  if (!reg) return 'unsupported';
  const cfg = await api<{ enabled: boolean }>('/push/config').catch(() => ({ enabled: false }));
  if (!cfg.enabled) return 'server-off';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await reg.pushManager.getSubscription();
  return Notification.permission === 'granted' && sub ? 'on' : 'off';
}

async function sendToServer(sub: PushSubscription) {
  const json = sub.toJSON();
  await api('/push/subscriptions', { method: 'POST', body: { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } } });
}

/** Must be called from a click: browsers only show the permission dialog in response to a user gesture. */
export async function enablePush(): Promise<PushState> {
  const reg = await registration();
  if (!reg) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'denied' : 'off';
  const cfg = await api<{ enabled: boolean; publicKey: string | null }>('/push/config');
  if (!cfg.enabled || !cfg.publicKey) return 'server-off';
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(cfg.publicKey) }));
  await sendToServer(sub);
  return 'on';
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api('/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => undefined);
  await sub.unsubscribe();
}

/** On every start: if this device is subscribed, make sure the server knows it (covers expired or renewed subscriptions). */
export async function syncPush(): Promise<void> {
  try {
    if (typeof window === 'undefined' || !supported() || Notification.permission !== 'granted') return;
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await sendToServer(sub);
  } catch {
    /* best effort */
  }
}

export interface NotificationSettings {
  dndUntil: string | null;
  quietStart: string | null;
  quietEnd: string | null;
  devices: number;
}

export const loadSettings = () => api<NotificationSettings>('/push/settings');
export const saveSettings = (patch: Partial<Pick<NotificationSettings, 'dndUntil' | 'quietStart' | 'quietEnd'>>) => api<NotificationSettings>('/push/settings', { method: 'PATCH', body: patch });

// ---- sound (a per-device preference, not stored on the server) --------------------------------------------------
const SOUND_KEY = 'hc_sound';
export const soundEnabled = () => {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
};
export const setSoundEnabled = (on: boolean) => {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
};

let audio: AudioContext | null = null;
/** A short soft ping. Browsers only allow audio after the user has interacted with the page; failures are silent. */
export function playPing() {
  try {
    if (!soundEnabled()) return;
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, audio.currentTime);
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.3);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.32);
  } catch {
    /* no sound is fine */
  }
}
