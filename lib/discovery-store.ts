import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { seal, unseal } from './spotify-session.ts';
import type { DiggingSession, DiscoveryResult, SessionPage } from './discovery-types.ts';
export function createDiscoveryStore(root: string, secret: string) {
  async function create(ownerId: string, result: DiscoveryResult) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (const name of (await readdir(root)).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).slice(0, 200)) {
      try { const old = unseal<DiggingSession>(await readFile(join(root, name), 'utf8'), secret, 12000000); if (!old || old.expiresAt < Date.now()) await unlink(join(root, name)); } catch {}
    }
    const session: DiggingSession = { ...result, id: randomUUID(), ownerId, createdAt: Date.now(), expiresAt: Date.now() + 12 * 3600000 };
    const path = join(root, `${session.id}.json`), temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, seal(session, secret), { mode: 0o600 }); await rename(temp, path); return session;
  }
  async function page(ownerId: string, id: string, cursor: string | null): Promise<SessionPage | null> {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    let session: DiggingSession | null;
    try { session = unseal<DiggingSession>(await readFile(join(root, `${id}.json`), 'utf8'), secret, 12000000); } catch { return null; }
    if (!session || session.ownerId !== ownerId || session.expiresAt < Date.now()) return null;
    let offset = 0;
    if (cursor) {
      const decoded = unseal<{ ownerId: string; id: string; offset: number; expiresAt: number }>(cursor, secret);
      if (!decoded || decoded.ownerId !== ownerId || decoded.id !== id || decoded.expiresAt < Date.now() || !Number.isSafeInteger(decoded.offset) || decoded.offset < 0 || decoded.offset > session.items.length) return null;
      offset = decoded.offset;
    }
    const { ownerId: _owner, items, ...publicSession } = session;
    return { ...publicSession, items: items.slice(offset, offset + 20), total: items.length, nextCursor: offset + 20 < items.length ? seal({ ownerId, id, offset: offset + 20, expiresAt: session.expiresAt }, secret) : null };
  }
  return { create, page };
}
