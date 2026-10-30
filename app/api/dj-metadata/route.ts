import { spotifyDJMetadata } from '@/lib/spotify-dj';
import { createHash } from 'node:crypto';
import {createTextStore} from '@/lib/text-store';
import { join } from 'node:path';
import { requireUser, requireOrigin, apiError, noStore } from '@/lib/route-auth';
import { SpotifyError } from '@/lib/spotify';
import { validateMetadataImport, matchedMetadata, type DJMetadata } from '@/lib/dj-metadata';
const root = join(process.cwd(), '.data/dj-metadata');
function file(userId: string) { return `${createHash('sha256').update(userId).digest('hex')}.json`; }
async function load(userId: string): Promise<Record<string, DJMetadata>> { const value=await createTextStore(root,'dj-metadata').read(file(userId));return value?JSON.parse(value):{}; }
export async function GET(request: Request) {
  try { const user = await requireUser(); const q = new URL(request.url).searchParams; const id = q.get('trackId') || ''; const duration = Number(q.get('durationMs')); if (!/^spotify:[A-Za-z0-9]{22}$/.test(id) || !Number.isFinite(duration) || duration < 0) throw new SpotifyError('Invalid track metadata request.', 400); return Response.json({ metadata: matchedMetadata((await load(user.userId))[id], duration) || await spotifyDJMetadata(user.userId,id) }, { headers: noStore }); } catch (e) { return apiError(e); }
}
export async function POST(request: Request) {
  try {
    requireOrigin(request); const user = await requireUser(); const raw = await request.text(); if (Buffer.byteLength(raw) > 2000000) throw new SpotifyError('Metadata imports must be smaller than 2 MB.', 400);
    let data; try { data = validateMetadataImport(JSON.parse(raw)); } catch (e) { throw new SpotifyError(e instanceof Error ? e.message : 'Invalid metadata JSON.', 400); }
    const storage=createTextStore(root,'dj-metadata');const release=await storage.lock(file(user.userId));try{await storage.write(file(user.userId),JSON.stringify({...await load(user.userId),...data}))}finally{await release()}
    return Response.json({ imported: Object.keys(data).length }, { headers: noStore });
  } catch (e) { return apiError(e); }
}
