import type { Session } from 'next-auth';
import { auth } from './auth';
import { unauthorized } from './error-response';

type SessionResult =
  | { session: Session; response: null }
  | { session: null; response: Response };

// Single auth gate for API routes. Team-shared access model: any signed-in
// whitelisted member passes — there is no per-user resource ownership.
//
//   const { session, response } = await requireSession();
//   if (response) return response;
export async function requireSession(): Promise<SessionResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      session: null,
      response: unauthorized(),
    };
  }
  return { session, response: null };
}
