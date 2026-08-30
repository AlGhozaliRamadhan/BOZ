import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface OutboundUrlPolicyOptions {
  allowLoopback?: boolean;
  resolveHost?: HostResolver;
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

function isIpv6Loopback(address: string): boolean {
  return normalizedIpv6(address) === '::1';
}

function isBlockedIpv6(address: string): boolean {
  const normalized = normalizedIpv6(address);
  if (normalized === '::' || normalized === '::1') return true;

  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4[1]);

  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    const ipv4 = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    return isBlockedIpv4(ipv4);
  }

  const firstGroup = Number.parseInt(normalized.split(':')[0] || '0', 16);
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

export async function validateOutboundHttpUrl(
  raw: string,
  options: OutboundUrlPolicyOptions = {},
): Promise<URL> {
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
  if (url.search || url.hash) {
    throw new UnsafeOutboundUrlError('Endpoint URL must not contain a query string or fragment');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const allowLoopback = options.allowLoopback === true;
  const literalFamily = isIP(hostname);

  if (hostname === 'localhost') {
    if (!allowLoopback) {
      throw new UnsafeOutboundUrlError('Loopback endpoints are not allowed');
    }
  } else if (literalFamily !== 0) {
    assertAddressAllowed(hostname, allowLoopback);
  } else {
    let addresses: ResolvedAddress[];
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

  return url;
}

export async function validateCustomProviderEndpoint(raw: string): Promise<string> {
  const url = await validateOutboundHttpUrl(raw, { allowLoopback: true });
  return url.toString().replace(/\/$/, '');
}
