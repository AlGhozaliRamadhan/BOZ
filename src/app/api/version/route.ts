import { jsonResponse } from '@/app/lib/api-helpers';
import { getBuildVersion } from '@/utils/version';

export async function GET() {
  return jsonResponse({
    name: 'BOZ',
    currentVersion: getBuildVersion(),
    distribution: 'desktop',
    updateChannel: 'github',
  });
}
