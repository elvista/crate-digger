import { spotifyDJMetadata } from '@/lib/spotify-dj';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireUser, requireOrigin, apiError, noStore } from '@/lib/route-auth';
import { SpotifyError } from '@/lib/spotify';
import { validateMetadataImport, matchedMetadata, type DJMetadata } from '@/lib/dj-metadata';
const root = join(process.cwd(), '.data/dj-metadata');
function file(userId: string) { return join(root, `${createHash('sha256').update(userId).digest('hex')}.json`); }
async function load(userId: string): Promise<Record<string, DJMetadata>> { try { return JSON.parse(await readFile(file(userId), 'utf8')); } catch { return {}; } }
export async function GET(request: Request) {
  try { const user = await requireUser(); const q = new URL(request.url).searchParams; const id = q.get('trackId') || ''; const duration = Number(q.get('durationMs')); if (!/^spotify:[A-Za-z0-9]{22}$/.test(id) || !Number.isFinite(duration) || duration < 0) throw new SpotifyError('Invalid track metadata request.', 400); return Response.json({ metadata: matchedMetadata((await load(user.userId))[id], duration) || await spotifyDJMetadata(user.userId,id) }, { headers: noStore }); } catch (e) { return apiError(e); }
}
export async function POST(request: Request) {
  try {
    requireOrigin(request); const user = await requireUser(); const raw = await request.text(); if (Buffer.byteLength(raw) > 2000000) throw new SpotifyError('Metadata imports must be smaller than 2 MB.', 400);
    let data; try { data = validateMetadataImport(JSON.parse(raw)); } catch (e) { throw new SpotifyError(e instanceof Error ? e.message : 'Invalid metadata JSON.', 400); }
    await mkdir(root, { recursive: true, mode: 0o700 }); const path = file(user.userId), temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ ...await load(user.userId), ...data }), { mode: 0o600 }); await rename(temp, path);
    return Response.json({ imported: Object.keys(data).length }, { headers: noStore });
  } catch (e) { return apiError(e); }
}
