import { NextRequest, NextResponse } from 'next/server';
import { MAX_REQUEST_BODY_BYTES } from '@/app/lib/api-helpers';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseLoopbackHost(rawHost: string | null): URL | null {
  if (!rawHost || /[\s,]/.test(rawHost)) return null;
  try {
    const parsed = new URL(`http://${rawHost}`);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function deny(message: string, status = 403): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function proxy(request: NextRequest) {
  const requestHost = parseLoopbackHost(request.headers.get('host'));
  if (!requestHost) return deny('API access is restricted to the local BOZ origin');

  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite === 'cross-site') return deny('Cross-site API requests are not allowed');

  const originHeader = request.headers.get('origin');
  if (originHeader) {
    if (originHeader === 'null') return deny('Opaque origins are not allowed');
    try {
      const origin = new URL(originHeader);
      const originHost = parseLoopbackHost(origin.host);
      if (!originHost || origin.protocol !== request.nextUrl.protocol || origin.host.toLowerCase() !== requestHost.host.toLowerCase()) {
        return deny('Request origin does not match the local BOZ origin');
      }
    } catch {
      return deny('Request origin is invalid');
    }
  } else if (UNSAFE_METHODS.has(request.method) && fetchSite) {
    return deny('Browser API writes require a same-origin Origin header');
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) return deny('Invalid Content-Length', 400);
    if (parsedLength > MAX_REQUEST_BODY_BYTES) return deny('Request body is too large', 413);
  }

  if (UNSAFE_METHODS.has(request.method) && declaredLength !== '0' && request.body) {
    const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') return deny('Content-Type must be application/json', 415);
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
