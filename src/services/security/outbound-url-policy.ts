import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface OutboundUrlPolicyOptions {
  allowLoopback?: boolean;
  allowQuery?: boolean;
  allowFragment?: boolean;
  resolveHost?: HostResolver;
}

export interface ValidatedOutboundUrl {
  url: URL;
  addresses: ResolvedAddress[];
}

export class UnsafeOutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeOutboundUrlError';
  }
}

const defaultResolver: HostResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

function isIpv4Loopback(address: string): boolean {
  return address.split('.')[0] === '127';
}

function isBlockedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function normalizedIpv6(address: string): string {
  return address.toLowerCase().replace(/^\[|\]$/g, '');
}

function parseIpv6Words(address: string): number[] | null {
  const normalized = normalizedIpv6(address);
  if (normalized.includes('.')) return null;
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right].map((word) => Number.parseInt(word || '0', 16));
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : null;
}

function isIpv6Loopback(address: string): boolean {
  return normalizedIpv6(address) === '::1';
}

function isBlockedIpv6(address: string): boolean {
  const normalized = normalizedIpv6(address);
  if (normalized === '::' || normalized === '::1') return true;

  const words = parseIpv6Words(normalized);
  if (!words) return true;
  const isIpv4Compatible = words.slice(0, 6).every((word) => word === 0);
  const isIpv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const isIpv4Translated = words.slice(0, 4).every((word) => word === 0) && words[4] === 0xffff && words[5] === 0;
  const isNat64WellKnown = words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0);
  const isNat64LocalUse = words[0] === 0x64 && words[1] === 0xff9b && words[2] === 1;
  const isSixToFour = words[0] === 0x2002;
  const isTeredo = words[0] === 0x2001 && words[1] === 0;
  if (isIpv4Compatible || isIpv4Mapped || isIpv4Translated || isNat64WellKnown || isNat64LocalUse || isSixToFour || isTeredo) {
    return true;
  }

  const firstGroup = words[0];
  return (
    (firstGroup & 0xfe00) === 0xfc00 ||
    (firstGroup & 0xffc0) === 0xfe80 ||
    (firstGroup & 0xffc0) === 0xfec0 ||
    (firstGroup & 0xff00) === 0xff00 ||
    normalized === '2001:db8' ||
    normalized.startsWith('2001:db8:')
  );
}

function assertAddressAllowed(address: string, allowLoopback: boolean): void {
  const family = isIP(address);
  const loopback = family === 4 ? isIpv4Loopback(address) : family === 6 && isIpv6Loopback(address);
  if (loopback && allowLoopback) return;

  if (family === 4 && !isBlockedIpv4(address)) return;
  if (family === 6 && !isBlockedIpv6(address)) return;

  throw new UnsafeOutboundUrlError('Endpoint resolves to a private, reserved, or local network address');
}

export async function resolveAndValidateOutboundHttpUrl(
  raw: string,
  options: OutboundUrlPolicyOptions = {},
): Promise<ValidatedOutboundUrl> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeOutboundUrlError('Endpoint must be an absolute HTTP(S) URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeOutboundUrlError('Endpoint must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw new UnsafeOutboundUrlError('Endpoint URL must not contain credentials');
  }
  if (url.search && options.allowQuery !== true) throw new UnsafeOutboundUrlError('Endpoint URL must not contain a query string');
  if (url.hash && options.allowFragment !== true) throw new UnsafeOutboundUrlError('Endpoint URL must not contain a fragment');

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const allowLoopback = options.allowLoopback === true;
  const literalFamily = isIP(hostname);
  let addresses: ResolvedAddress[];

  if (hostname === 'localhost') {
    if (!allowLoopback) {
      throw new UnsafeOutboundUrlError('Loopback endpoints are not allowed');
    }
    addresses = [{ address: '127.0.0.1', family: 4 }];
  } else if (literalFamily !== 0) {
    assertAddressAllowed(hostname, allowLoopback);
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await (options.resolveHost ?? defaultResolver)(hostname);
    } catch {
      throw new UnsafeOutboundUrlError('Endpoint hostname could not be resolved');
    }
    if (addresses.length === 0) {
      throw new UnsafeOutboundUrlError('Endpoint hostname did not resolve to an address');
    }
    // Local mode is an explicit endpoint choice, not permission for an
    // arbitrary DNS name to resolve into the local network.
    for (const result of addresses) assertAddressAllowed(result.address, false);
  }

  if (url.protocol === 'http:' && hostname !== 'localhost' && !isIpv4Loopback(hostname) && !isIpv6Loopback(hostname)) {
    throw new UnsafeOutboundUrlError('Remote custom endpoints must use HTTPS');
  }

  return { url, addresses };
}

export async function validateOutboundHttpUrl(
  raw: string,
  options: OutboundUrlPolicyOptions = {},
): Promise<URL> {
  return (await resolveAndValidateOutboundHttpUrl(raw, options)).url;
}

export async function validateCustomProviderEndpoint(raw: string): Promise<string> {
  const url = await validateOutboundHttpUrl(raw, { allowLoopback: true });
  return url.toString().replace(/\/$/, '');
}
