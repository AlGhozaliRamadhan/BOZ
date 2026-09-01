import { NextResponse, NextRequest } from 'next/server';
import { nvidiaConfig, NVIDIA_MODELS } from '@/config/nvidia.config';
import { readBoundedFetchText } from '@/services/security/public-http-client';

export async function GET(request: NextRequest) {
  try {
    const key = nvidiaConfig.apiKey;
    if (!key) {
      // If no key is set yet, return the default hardcoded list
      return NextResponse.json({ models: NVIDIA_MODELS });
    }

    const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${key}`
      },
      // Timeout after 5 seconds to prevent hanging
      signal: AbortSignal.timeout(5000)
    });

    if (!res.ok) {
       console.warn('NVIDIA models fetch failed:', res.status);
       return NextResponse.json({ models: NVIDIA_MODELS });
    }

    const data = JSON.parse(await readBoundedFetchText(res));
    const unique = new Map();
    
    // The NVIDIA API returns a "data" array containing model objects
    if (data && Array.isArray(data.data)) {
       data.data.forEach((m: any) => {
          // Keep the ID and create a clean label
          const labelPart = m.id.split('/').pop() || m.id;
          unique.set(m.id, { 
            id: m.id, 
            label: `${labelPart} (NVIDIA NIM)`
          });
       });
    }

    const fetchedModels = Array.from(unique.values());
    if (fetchedModels.length > 0) {
      return NextResponse.json({ models: fetchedModels });
    } else {
      return NextResponse.json({ models: NVIDIA_MODELS });
    }
  } catch (err) {
    console.error('Failed to fetch NVIDIA NIM models:', err);
    return NextResponse.json({ models: NVIDIA_MODELS });
  }
}
