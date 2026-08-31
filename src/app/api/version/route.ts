import { NextRequest } from 'next/server';
import { jsonResponse } from '@/app/lib/api-helpers';
import { checkForUpdates } from '@/utils/update-check';
import { getBuildVersion } from '@/utils/version';

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get('force') === 'true';
  const result = await checkForUpdates({
    currentVersion: getBuildVersion(),
    force,
  });

  return jsonResponse(result);
}
