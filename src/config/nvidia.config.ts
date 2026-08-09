// Shared key-creation URL — imported by cli.ts and ai.service.ts
export const NVIDIA_API_KEY_URL = 'https://build.nvidia.com/';

export const NVIDIA_MODELS: { id: string; label: string }[] = [
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 Ultra 550B  (NVIDIA, default · reasoning)' },
  { id: 'nvidia/nemotron-4-340b-instruct',   label: 'Nemotron-4 340B       (NVIDIA, dense · reasoning)' },
  { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B (NVIDIA, MoE · reasoning)' },
  { id: 'meta/llama-3.1-405b-instruct',      label: 'Llama 3.1 405B        (Meta, dense · reasoning)' },
  { id: 'qwen/qwen2.5-72b-instruct',         label: 'Qwen 2.5 72B          (Alibaba, dense · versatile)' },
];

export const nvidiaConfig = {
  provider: 'nvidia' as const,
  get apiKey() { return (process.env.NVIDIA_API_KEY || '').trim(); }, // lazy: read after dotenv.config()
  baseURL:  process.env.NVIDIA_BASE_URL  || 'https://integrate.api.nvidia.com/v1',
  model:    process.env.NVIDIA_AI_MODEL  || 'nvidia/nemotron-3-ultra-550b-a55b',
};
