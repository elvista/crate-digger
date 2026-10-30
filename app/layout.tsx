import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Crate — Find your next obsession', description: 'A listening room for your next favorite electronic track.' };
export default function Layout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html> }
