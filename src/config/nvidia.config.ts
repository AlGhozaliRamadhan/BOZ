// Shared key-creation URL — imported by cli.ts and ai.service.ts
export const NVIDIA_API_KEY_URL = 'https://build.nvidia.com/';

export const NVIDIA_MODELS: { id: string; label: string }[] = [
  { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron Super 120B   (NVIDIA, default · reasoning)' },
  { id: 'qwen/qwen3.5-122b-a10b',           label: 'Qwen3.5 122B A10B     (Alibaba, MoE · multimodal)' },
  { id: 'openai/gpt-oss-120b',              label: 'GPT-OSS 120B          (OpenAI, MoE · chain-of-thought)' },
];

export const nvidiaConfig = {
  provider: 'nvidia' as const,
  get apiKey() { return (process.env.NVIDIA_API_KEY || '').trim(); }, // lazy: read after dotenv.config()
  baseURL:  process.env.NVIDIA_BASE_URL  || 'https://integrate.api.nvidia.com/v1',
  model:    process.env.NVIDIA_AI_MODEL  || NVIDIA_MODELS[0].id,
};
