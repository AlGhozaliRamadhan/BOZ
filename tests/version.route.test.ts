import { describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/version/route';

describe('version route', () => {
  it('returns the desktop distribution contract without npm commands', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('name', 'BOZ');
    expect(data).toHaveProperty('currentVersion');
    expect(data).toMatchObject({ distribution: 'desktop', updateChannel: 'github' });
    expect(data).not.toHaveProperty('updateCommand');
    expect(data).not.toHaveProperty('packageUrl');
  });
});
