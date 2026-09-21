'use client';

import { isTauri } from '@tauri-apps/api/core';
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
import { useCallback, useEffect, useRef, useState } from 'react';

type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'error' | 'unavailable';

interface DownloadProgress {
  received: number;
  total: number | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The update service could not be reached.';
}

export function progressFromEvent(event: DownloadEvent, previous: DownloadProgress): DownloadProgress {
  if (event.event === 'Started') {
    return { received: 0, total: event.data.contentLength ?? null };
  }
  if (event.event === 'Progress') {
    return { ...previous, received: previous.received + event.data.chunkLength };
  }
  return previous;
}

export default function DesktopUpdateControl({ version }: { version: string }) {
  const updateRef = useRef<Update | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({ received: 0, total: null });
  const [error, setError] = useState<string | null>(null);

  const releaseUpdate = useCallback(async () => {
    const update = updateRef.current;
    updateRef.current = null;
    if (update) await update.close().catch(() => undefined);
  }, []);

  useEffect(() => {
    setIsDesktop(isTauri());
    return () => { void releaseUpdate(); };
  }, [releaseUpdate]);

  const checkForUpdates = useCallback(async () => {
    if (!isTauri()) {
      setStatus('unavailable');
      return;
    }

    await releaseUpdate();
    setError(null);
    setAvailableVersion(null);
    setProgress({ received: 0, total: null });
    setStatus('checking');

    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check({ timeout: 20_000 });
      if (!update) {
        setStatus('current');
        return;
      }
      updateRef.current = update;
      setAvailableVersion(update.version);
      setStatus('available');
    } catch (checkError) {
      setError(errorMessage(checkError));
      setStatus('error');
    }
  }, [releaseUpdate]);

  const downloadAndRestart = useCallback(async () => {
    const update = updateRef.current;
    if (!update) {
      await checkForUpdates();
      return;
    }

    setError(null);
    setProgress({ received: 0, total: null });
    setStatus('downloading');

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Finished') {
          setStatus('installing');
          return;
        }
        setProgress(current => progressFromEvent(event, current));
      }, { restartAfterInstall: true, timeout: 15 * 60_000 });
      // On Windows Tauri exits the app after the signed NSIS updater launches.
      // This state is only visible on platforms where the process remains alive.
      setStatus('installing');
    } catch (installError) {
      setError(errorMessage(installError));
      setStatus('error');
      await releaseUpdate();
    }
  }, [checkForUpdates, releaseUpdate]);

  const percentage = progress.total && progress.total > 0
    ? Math.min(100, Math.round((progress.received / progress.total) * 100))
    : null;
  const busy = status === 'checking' || status === 'downloading' || status === 'installing';
  const buttonLabel = status === 'checking'
    ? 'Checking…'
    : status === 'available'
      ? 'Download & restart'
      : status === 'downloading'
        ? percentage == null ? 'Downloading…' : `Downloading ${percentage}%`
        : status === 'installing'
          ? 'Starting updater…'
          : status === 'error'
            ? 'Try again'
            : 'Check for updates';
  const action = status === 'available' ? downloadAndRestart : checkForUpdates;

  return (
    <section className="desktop-update-control" aria-live="polite">
      <div className="desktop-update-control__copy">
        <strong>BOZ desktop v{version}</strong>
        {!isDesktop && <span>Updates are available from the installed Windows app.</span>}
        {isDesktop && status === 'idle' && <span>Check the signed BOZ release channel from here.</span>}
        {isDesktop && status === 'checking' && <span>Checking the signed release channel…</span>}
        {isDesktop && status === 'current' && <span>You are running the latest version.</span>}
        {isDesktop && status === 'available' && <span>BOZ v{availableVersion} is ready to download and will restart automatically.</span>}
        {isDesktop && status === 'downloading' && <span>{percentage == null ? 'Downloading the signed installer…' : `${percentage}% downloaded. BOZ will restart when ready.`}</span>}
        {isDesktop && status === 'installing' && <span>Windows is applying the signed update and restarting BOZ.</span>}
        {isDesktop && status === 'error' && <span className="desktop-update-control__error">{error}</span>}
      </div>

      {status === 'downloading' && (
        <div className="desktop-update-control__progress" aria-label={percentage == null ? 'Downloading update' : `${percentage}% downloaded`}>
          <span style={{ width: `${percentage ?? 15}%` }} />
        </div>
      )}

      <button
        type="button"
        className="desktop-update-control__button"
        onClick={() => void action()}
        disabled={!isDesktop || busy}
      >
        {buttonLabel}
      </button>
    </section>
  );
}
