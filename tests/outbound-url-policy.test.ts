import { describe, expect, it } from 'vitest';
import {
  UnsafeOutboundUrlError,
  validateOutboundHttpUrl,
} from '../src/services/security/outbound-url-policy';

describe('outbound URL policy', () => {
  it('allows explicit loopback endpoints only when requested', async () => {
    await expect(validateOutboundHttpUrl('http://localhost:20128/v1', { allowLoopback: true }))
      .resolves.toBeInstanceOf(URL);
    await expect(validateOutboundHttpUrl('http://127.0.0.1:11434/v1', { allowLoopback: true }))
      .resolves.toBeInstanceOf(URL);
    await expect(validateOutboundHttpUrl('http://localhost:20128/v1'))
      .rejects.toBeInstanceOf(UnsafeOutboundUrlError);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.8/v1',
    'http://192.168.1.10/v1',
    'http://[::1]:11434/v1',
    'https://[::ffff:7f00:1]/v1',
    'https://[::ffff:c0a8:1]/v1',
    'https://[::7f00:1]/v1',
    'https://[::ffff:0:7f00:1]/v1',
    'https://[64:ff9b::7f00:1]/v1',
    'file:///etc/passwd',
    'https://user:password@example.test/v1',
  ])('rejects unsafe endpoint %s', async (endpoint) => {
    await expect(validateOutboundHttpUrl(endpoint)).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
  });

  it('requires HTTPS for a non-local endpoint', async () => {
    const resolveHost = async () => [{ address: '93.184.216.34', family: 4 }];
    await expect(validateOutboundHttpUrl('http://models.example.test/v1', { resolveHost }))
      .rejects.toThrow('must use HTTPS');
  });

  it('accepts a public HTTPS endpoint after DNS validation', async () => {
    const resolveHost = async () => [{ address: '93.184.216.34', family: 4 }];
    const result = await validateOutboundHttpUrl('https://models.example.test/v1', { resolveHost });
    expect(result.toString()).toBe('https://models.example.test/v1');
  });

  it('allows ordinary public-page query strings only under the explicit web policy', async () => {
    const resolveHost = async () => [{ address: '93.184.216.34', family: 4 }];
    await expect(validateOutboundHttpUrl('https://pages.example.test/report?q=boz', { resolveHost }))
      .rejects.toBeInstanceOf(UnsafeOutboundUrlError);
    await expect(validateOutboundHttpUrl('https://pages.example.test/report?q=boz', { resolveHost, allowQuery: true }))
      .resolves.toBeInstanceOf(URL);
  });

  it('rejects a hostname if any resolved address is private', async () => {
    const resolveHost = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.1.2', family: 4 },
    ];
    await expect(validateOutboundHttpUrl('https://mixed.example.test/v1', { resolveHost }))
      .rejects.toBeInstanceOf(UnsafeOutboundUrlError);
  });

  it('does not let a DNS hostname inherit explicit-loopback permission', async () => {
    const resolveHost = async () => [{ address: '127.0.0.1', family: 4 }];
    await expect(validateOutboundHttpUrl('https://router.example.test/v1', {
      allowLoopback: true,
      resolveHost,
    })).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
  });
});
