import 'server-only';
import { join } from 'node:path';
import { createDiscoveryStore } from './discovery-store';
import { appConfig } from './spotify-session';
export function sessionStore() { return createDiscoveryStore(join(process.cwd(), '.data/discovery'), appConfig().secret); }
