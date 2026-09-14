import { timingSafeEqual } from 'node:crypto';
import { jsonResponse } from '@/app/lib/api-helpers';
import { getBuildVersion } from '@/utils/version';

export const dynamic = 'force-dynamic';

function matchesHealthToken(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

export async function GET(request: Request) {
  const expectedToken = process.env.BOZ_DESKTOP_HEALTH_TOKEN?.trim();
  if (!expectedToken || !matchesHealthToken(request.headers.get('x-boz-desktop-token'), expectedToken)) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  return jsonResponse({
    name: 'BOZ',
    version: getBuildVersion(),
    distribution: 'desktop',
    status: 'ready',
  });
}
