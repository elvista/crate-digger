import { requireUser, apiError, noStore } from '@/lib/route-auth';
import { sessionStore } from '@/lib/session-store';
import { SpotifyError } from '@/lib/spotify';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); const { id } = await context.params;
    const result = await sessionStore().page(user.userId, id, new URL(request.url).searchParams.get('cursor'));
    if (!result) throw new SpotifyError('This digging session expired or is unavailable. Generate a new queue.', 404);
    return Response.json(result, { headers: noStore });
  } catch (e) { return apiError(e); }
}
