import type { UserDto } from '@hemcenter/shared';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public details: string[] = []) {
    super(code);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<UserDto | null> | null = null;

export const getAccessToken = () => accessToken;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

interface AuthResult {
  accessToken: string;
  user: UserDto;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'GENERIC';
  let details: string[] = [];
  try {
    const body = await res.json();
    if (typeof body.message === 'string') code = body.message;
    if (Array.isArray(body.details)) details = body.details.filter((x: unknown) => typeof x === 'string');
  } catch {
    /* non-JSON body */
  }
  if (res.status === 429) code = 'TOO_MANY';
  if (res.status === 413) code = 'FILE_TOO_LARGE';
  return new ApiError(res.status, code, details);
}

/** Exchanges the httpOnly refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<UserDto | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) return null;
      const body = (await res.json()) as AuthResult;
      accessToken = body.accessToken;
      return body.user;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Sends a request with the access token; on 401 refreshes the session once and retries. */
async function send(path: string, build: (headers: Record<string, string>) => RequestInit): Promise<Response> {
  const attempt = () => fetch(`/api${path}`, { credentials: 'same-origin', ...build(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) });
  let res: Response;
  try {
    res = await attempt();
    if (res.status === 401 && !path.startsWith('/auth/')) {
      if (await refreshSession()) res = await attempt();
    }
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await send(path, (auth) => ({
    method: init.method ?? 'GET',
    headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...auth },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  }));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fetches a protected file. Browsers cannot send the Authorization header from <img src> or <a href>, so files are read as blobs. */
export async function apiBlob(path: string): Promise<Blob> {
  return (await send(path, (auth) => ({ headers: auth }))).blob();
}

/** multipart upload; the browser sets the Content-Type with its boundary. */
export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await send(path, (auth) => ({ method: 'POST', headers: auth, body: form }));
  return (await res.json()) as T;
}

export async function authRequest(path: string, body: unknown): Promise<UserDto> {
  const res = await api<AuthResult>(path, { method: 'POST', body });
  accessToken = res.accessToken;
  return res.user;
}

export type LoginResult = { user: UserDto } | { mfaToken: string };

/** Password step. Resolves with the user, or with an mfaToken when a second factor is required. */
export async function loginRequest(login: string, password: string): Promise<LoginResult> {
  const res = await api<AuthResult | { mfaRequired: true; mfaToken: string }>('/auth/login', { method: 'POST', body: { login, password } });
  if ('mfaRequired' in res) return { mfaToken: res.mfaToken };
  accessToken = res.accessToken;
  return { user: res.user };
}
