import type { UserDto } from '@hemcenter/shared';

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<UserDto | null> | null = null;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

interface AuthResult {
  accessToken: string;
  user: UserDto;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'GENERIC';
  try {
    const body = await res.json();
    if (typeof body.message === 'string') code = body.message;
  } catch {
    /* non-JSON body */
  }
  if (res.status === 429) code = 'TOO_MANY';
  return new ApiError(res.status, code);
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

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const send = () =>
    fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && !path.startsWith('/auth/')) {
      if (await refreshSession()) res = await send();
    }
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function authRequest(path: string, body: unknown): Promise<UserDto> {
  const res = await api<AuthResult>(path, { method: 'POST', body });
  accessToken = res.accessToken;
  return res.user;
}
