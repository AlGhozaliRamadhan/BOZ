import { describe, expect, it } from 'vitest';
import { progressFromEvent } from '../src/app/components/ui/DesktopUpdateControl';

describe('DesktopUpdateControl download progress', () => {
  it('starts with an optional content length and accumulates downloaded chunks', () => {
    const started = progressFromEvent({ event: 'Started', data: { contentLength: 100 } }, { received: 80, total: null });
    const progressed = progressFromEvent({ event: 'Progress', data: { chunkLength: 25 } }, started);

    expect(started).toEqual({ received: 0, total: 100 });
    expect(progressed).toEqual({ received: 25, total: 100 });
  });

  it('keeps progress stable when the updater reports completion', () => {
    expect(progressFromEvent({ event: 'Finished' }, { received: 100, total: 100 }))
      .toEqual({ received: 100, total: 100 });
  });
});
