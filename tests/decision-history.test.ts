import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {archiveDecision,readDecisionHistory,writeDecision} from '../lib/decision-history.ts';

test('independent tab decisions survive and undo archives only the chosen decision',()=>{
 const values=new Map<string,string>();const storage={get length(){return values.size},key:(i:number)=>[...values.keys()][i]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}} as Storage;
 const track=(n:number)=>({id:`spotify:${String(n).padStart(22,'0')}`,title:`Track ${n}`,artist:'Artist',durationMs:1000});
 const first={eventId:randomUUID(),trackId:track(1).id,track:track(1),decision:'save' as const,occurredAt:'2026-10-30T12:00:00.000Z'};
 const second={eventId:randomUUID(),trackId:track(2).id,track:track(2),decision:'skip' as const,occurredAt:'2026-10-30T12:00:01.000Z'};
 writeDecision('owner',first as any,storage);writeDecision('owner',second as any,storage);
 assert.equal(readDecisionHistory('owner',storage).length,2);
 archiveDecision('owner',first as any,storage);
 assert.deepEqual(readDecisionHistory('owner',storage).filter(e=>!e.archived).map(e=>e.trackId),[second.trackId]);
 assert.equal(readDecisionHistory('other',storage).length,0);
});
