/** Thin fetch wrapper: same-origin cookies, CSRF header on writes, typed error envelope. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

let csrfToken: string | null = null;
export const setCsrf = (t: string | null) => {
  csrfToken = t;
};

function readCsrfCookie() {
  const m = document.cookie.match(/(?:^|;\s*)cat100_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const t = csrfToken ?? readCsrfCookie();
    if (t) headers['x-csrf-token'] = t;
  }
  const res = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) onUnauthorized?.();
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T = any>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T = any>(url: string, body?: unknown) => request<T>('DELETE', url, body),
};

export const qs = (params: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};
