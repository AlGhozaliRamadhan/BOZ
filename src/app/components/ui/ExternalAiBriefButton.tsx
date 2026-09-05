'use client';

import { useState } from 'react';
import { buildExternalAiBrief } from '@/shared/external-ai-brief';

interface ExternalAiBriefButtonProps {
  ticker: string;
  source: string;
  data: unknown;
  dataTimestamp?: string | null;
  disabled?: boolean;
}

function copyWithFallback(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

export default function ExternalAiBriefButton({
  ticker,
  source,
  data,
  dataTimestamp,
  disabled = false,
}: ExternalAiBriefButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const briefing = buildExternalAiBrief({ ticker, source, data, dataTimestamp });
    try {
      await navigator.clipboard.writeText(briefing);
    } catch {
      if (!copyWithFallback(briefing)) return;
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      className="external-ai-brief-button"
      title="Copy the complete ticker information snapshot"
    >
      <i className={copied ? 'fa-solid fa-check' : 'fa-regular fa-copy'}></i>
      {copied ? 'COPIED' : 'COPY INFORMATION'}
    </button>
  );
}
