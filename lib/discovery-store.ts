import {createTextStore} from './text-store.ts';
import { randomUUID } from 'node:crypto';
import { seal, unseal } from './spotify-session.ts';
import type { DiggingSession, DiscoveryResult, SessionPage } from './discovery-types.ts';
export function createDiscoveryStore(root: string, secret: string) {
  const storage=createTextStore(root,'discovery');
  async function create(ownerId: string, result: DiscoveryResult) {
    try{await storage.prune?.(Date.now()-12*3600000)}catch{}
    const session: DiggingSession = { ...result, id: randomUUID(), ownerId, createdAt: Date.now(), expiresAt: Date.now() + 12 * 3600000 };
    await storage.write(`${session.id}.json`,seal(session,secret));return session;
  }
  async function page(ownerId: string, id: string, cursor: string | null): Promise<SessionPage | null> {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    let session: DiggingSession | null;
    try { session = unseal<DiggingSession>((await storage.read(`${id}.json`))??undefined, secret, 12000000); } catch { return null; }
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
  async function replace(ownerId:string,id:string,result:DiscoveryResult){
    if(!/^[a-f0-9-]{36}$/.test(id))return false;
    const raw=await storage.read(`${id}.json`);const session=unseal<DiggingSession>(raw??undefined,secret,12000000);
    if(!session||session.ownerId!==ownerId||session.expiresAt<Date.now())return false;
    await storage.write(`${id}.json`,seal({...session,...result,id:session.id,ownerId:session.ownerId},secret));return true;
  }
  return { create, page, replace };
}
