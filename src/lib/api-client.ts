// Client-side fetch wrapper (design「前端 fetch wrapper 與錯誤呈現」): every
// non-2xx becomes a typed ApiError carrying the unified error shape, so flow
// components render inline banners instead of silently swallowing failures.
import type { ErrorCode } from './error-response';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let code: ErrorCode = 'INTERNAL';
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) code = body.error.code as ErrorCode;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body (proxy pages etc.) — keep the HTTP fallback
    }
    throw new ApiError(code, message, res.status);
  }
  return (await res.json()) as T;
}
