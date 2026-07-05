// Unified API error shape (spec "Unified error response shape"):
// { error: { code, message } }. Raw exceptions go to the server log only.
export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'CONFLICT'
  | 'INTERNAL';

export function errorResponse(code: ErrorCode, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function unauthorized(): Response {
  return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
}

// 500 exit: log the raw error, return a generic message — exception text and
// stack traces never leave the server.
export function internalError(error: unknown): Response {
  console.error('API internal error:', error);
  return errorResponse('INTERNAL', '伺服器發生錯誤，請稍後再試', 500);
}

// Map a validation status to its code (413 payload caps vs ordinary 400s).
export function validationError(message: string, status = 400): Response {
  return errorResponse(status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION', message, status);
}
