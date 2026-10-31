import {createHash} from 'node:crypto';
import type {MatchingState} from './cosine-core';

export function matchingRevision(state:MatchingState){
 return createHash('sha256').update(JSON.stringify({items:state.items,status:state.status,retryAt:state.retryAt,warnings:state.warnings})).digest('hex').slice(0,24);
}
