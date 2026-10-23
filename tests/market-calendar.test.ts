import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMonthGrid,
  epochAtZonedMinutes,
  formatCountdown,
  globalDayStatus,
  goodFridayKeys,
  holidaysAsMap,
  localDateKey,
  monthLabelFromKey,
  offsetDateKey,
  sessionSnapshot,
  sessionWindowLabel,
  weekdayIndex,
  zonedParts,
} from '../src/shared/market-calendar.js';
import {
  getMarketCalendar,
  parseNagerHolidays,
  resetCalendarCacheForTests,
} from '../src/services/market/calendar.service.js';

describe('global day status (no market pinning)', () => {
  it('mutes only days where NEITHER exchange trades', () => {
    const idx = [{ date: '2026-03-20', name: 'Nyepi (IDX closed)' }];
    const status = globalDayStatus('2026-03-20', idx, undefined); // Friday: IDX off, US trades
    expect(status.idxTrading).toBe(false);
    expect(status.usTrading).toBe(true);
    expect(status.anyTrading).toBe(true);
    expect(status.closedLabels).toEqual(['Nyepi (IDX closed)']);
  });

  it('names shared closures once and mutes them gray, never red', () => {
    const status = globalDayStatus(
      '2026-04-03', // Good Friday: both exchanges closed
      goodFridayKeys([2026]),
      [{ date: '2026-04-03', name: 'Good Friday (NYSE closed)' }],
    );
    expect(status.anyTrading).toBe(false);
    expect(status.closedLabels).toEqual(['Good Friday (NYSE closed)']);
  });

  it('keeps weekends closed for both exchanges with the weekend label', () => {
    for (const key of ['2026-10-24', '2026-10-25']) { // Sat, Sun
      const status = globalDayStatus(key, undefined, undefined);
      expect(status.idxTrading).toBe(false);
      expect(status.usTrading).toBe(false);
      expect(status.anyTrading).toBe(false);
      expect(status.closedLabels).toEqual(['weekend']);
    }
  });

  it('leaves ordinary weekdays fully open with no closure labels', () => {
    const status = globalDayStatus('2026-10-22', undefined, undefined);
    expect(status).toEqual({ idxTrading: true, usTrading: true, anyTrading: true, closedLabels: [] });
  });
});

describe('the user-device day anchor', () => {
  it('localDateKey returns the machine-local date key', () => {
    // Epoch chosen so UTC reads a different day than a +7h zone reads.
    const epoch = Date.UTC(2026, 9, 22, 17, 0);
    expect(localDateKey(epoch)).toBe(`${new Date(epoch).getFullYear()}-10-${`${new Date(epoch).getDate()}`.padStart(2, '0')}`);
  });

  it('localDateKey never invents a key for an impossible epoch', () => {
    expect(localDateKey(NaN)).toBe('');
  });

  it('labels session windows per market', () => {
    expect(sessionWindowLabel('idx')).toBe('09:00–15:50 WIB');
    expect(sessionWindowLabel('us')).toBe('09:30–16:00 ET');
  });
});

describe('pure date-key arithmetic', () => {
  it('offsets across month and year boundaries', () => {
    expect(offsetDateKey('2026-10-22', -3)).toBe('2026-10-19');
    expect(offsetDateKey('2026-10-22', 7)).toBe('2026-10-29');
    expect(offsetDateKey('2026-12-28', 7)).toBe('2027-01-04');
  });

  it('indexes weekdays Monday-first', () => {
    expect(weekdayIndex('2026-10-22')).toBe(3); // Thursday
    expect(weekdayIndex('2026-10-25')).toBe(6); // Sunday
    expect(weekdayIndex('2026-10-26')).toBe(0); // Monday
  });

  it('formats countdowns, never negative, days beyond 24h', () => {
    expect(formatCountdown(83)).toBe('1h 23m');
    expect(formatCountdown(60)).toBe('1h');
    expect(formatCountdown(45)).toBe('45m');
    expect(formatCountdown(0)).toBe('0m');
    expect(formatCountdown(-5)).toBe('0m');
    expect(formatCountdown(2600)).toBe('1d 19h');
  });

  it('computes Good Friday from Easter for known NYSE closure years', () => {
    const keys = goodFridayKeys([2024, 2026]).map((entry) => entry.date);
    expect(keys).toContain('2024-03-29');
    expect(keys).toContain('2026-04-03');
  });
});

describe('holiday map validation', () => {
  it('keeps valid rows and drops malformed ones silently', () => {
    const map = holidaysAsMap([
      { date: '2026-10-23', name: 'Cuti bersama' },
      { date: 'not-a-date', name: 'Bad' },
      { date: '2026-10-24', name: '   ' },
      { date: '2026-10-25', name: '' },
      // @ts-expect-error malformed feed row deliberately injected
      null,
    ]);
    expect(map.size).toBe(1);
    expect(map.get('2026-10-23')).toBe('Cuti bersama');
  });
});

describe('calendar month label (never again "Invalid Date")', () => {
  it('renders the month of the day the user is on, from the key itself', () => {
    // The old widget built `new Date(`${todayKey}-01T12:00:00Z`)` on a FULL
    // date key — "2026-10-23-01T…" — and the header read literally
    // "Invalid Date". The label must come from the key's own YYYY-MM.
    expect(monthLabelFromKey('2026-10-23')).toBe('October 2026');
    expect(monthLabelFromKey('2026-01-01')).toBe('January 2026');
  });

  it('renders nothing for garbage keys instead of a broken label', () => {
    expect(monthLabelFromKey('')).toBe('');
    expect(monthLabelFromKey('garbage')).toBe('');
    expect(monthLabelFromKey('2026-13-01')).toBe('');
  });
});

describe('the month grid (a normal calendar)', () => {
  it('lays October 2026 out Monday-first with a real leading offset', () => {
    const grid = buildMonthGrid('2026-10-22', []);
    expect(grid.leadingBlanks).toBe(3); // Oct 1, 2026 falls on a Thursday
    expect(grid.days).toHaveLength(31);
    expect(grid.days[0].dayOfMonth).toBe(1);
    expect(grid.days[30].dayOfMonth).toBe(31);
  });

  it('colors weekends red, weekdays green, and rings today', () => {
    const grid = buildMonthGrid('2026-10-22', []);
    const saturday = grid.days.find((square) => square.dateKey === '2026-10-24');
    expect(saturday?.status).toBe('closed');
    const friday = grid.days.find((square) => square.dateKey === '2026-10-23');
    expect(friday?.status).toBe('trading');

    const today = grid.days.find((square) => square.isToday);
    expect(today?.dateKey).toBe('2026-10-22');
    expect(grid.days[0].isPast).toBe(true);
    expect(grid.days[30].isPast).toBe(false);
  });

  it('turns a fed holiday red and keeps its name, weekends stay unnamed', () => {
    const grid = buildMonthGrid('2026-10-22', [
      { date: '2026-10-23', name: 'Test Holiday' },
    ]);

    const friday = grid.days.find((square) => square.dateKey === '2026-10-23');
    expect(friday?.status).toBe('closed');
    expect(friday?.holidayName).toBe('Test Holiday');

    const saturday = grid.days.find((square) => square.dateKey === '2026-10-24');
    expect(saturday?.holidayName).toBeUndefined();
    expect(saturday?.status).toBe('closed');
  });
});

describe('session snapshots from wall-clock math', () => {
  const at = (tz: string, key: string, minutes: number) => epochAtZonedMinutes(tz, key, minutes);
  const IDX = 'Asia/Jakarta';
  const US = 'America/New_York';

  it('reports open sessions with the close boundary', () => {
    const now = at(IDX, '2026-10-22', 10 * 60);
    const snapshot = sessionSnapshot('idx', now, []);
    expect(snapshot.state).toBe('open');
    expect(snapshot.sessionToday).toBe(true);
    expect(snapshot.minutesToBoundary).toBeCloseTo(350, 5); // 15:50 − 10:00
    expect(snapshot.boundaryMinutesOfDay).toBe(15 * 60 + 50);
  });

  it('reports pre-open with today’s open boundary', () => {
    const now = at(IDX, '2026-10-22', 8 * 60);
    const snapshot = sessionSnapshot('idx', now, []);
    expect(snapshot.state).toBe('pre');
    expect(snapshot.minutesToBoundary).toBeCloseTo(60, 5);
    expect(snapshot.boundaryMinutesOfDay).toBe(9 * 60);
  });

  it('skips to Monday after a Friday close', () => {
    const now = at(IDX, '2026-10-23', 17 * 60); // Friday after close
    const snapshot = sessionSnapshot('idx', now, []);
    expect(snapshot.state).toBe('closed');
    expect(snapshot.boundaryEpoch).toBe(at(IDX, '2026-10-26', 9 * 60));
    expect(formatCountdown(snapshot.minutesToBoundary)).toBe('2d 16h');
  });

  it('jumps a holiday to the next real session', () => {
    const now = at(IDX, '2026-10-22', 17 * 60); // Thursday after close
    const snapshot = sessionSnapshot('idx', now, [
      { date: '2026-10-23', name: 'Long Holiday' },
    ]);
    expect(snapshot.state).toBe('closed');
    expect(snapshot.boundaryEpoch).toBe(at(IDX, '2026-10-26', 9 * 60));
  });

  it('handles the US clock in its own zone', () => {
    const open = sessionSnapshot('us', at(US, '2026-10-22', 10 * 60), []);
    expect(open.state).toBe('open');
    expect(open.minutesToBoundary).toBeCloseTo(360, 5); // 16:00 − 10:00

    const pre = sessionSnapshot('us', at(US, '2026-10-22', 8 * 60), []);
    expect(pre.state).toBe('pre');
    expect(pre.minutesToBoundary).toBeCloseTo(90, 5);

    const afterClose = sessionSnapshot('us', at(US, '2026-10-22', 17 * 60), []);
    expect(afterClose.state).toBe('closed');
    expect(afterClose.boundaryEpoch).toBe(at(US, '2026-10-23', 9 * 60 + 30));
  });
});

describe('zoned minute plumbing', () => {
  it('round-trips dateKey + minutes through an epoch', () => {
    for (const [tz, key, minutes] of [
      ['Asia/Jakarta', '2026-10-22', 600],
      ['America/New_York', '2026-10-22', 570],
      ['Asia/Jakarta', '2026-01-01', 23 * 60 + 59],
      ['America/New_York', '2026-07-04', 0],
    ] as [string, string, number][]) {
      const epoch = epochAtZonedMinutes(tz, key, minutes);
      const parts = zonedParts(tz, epoch);
      expect(parts.dateKey).toBe(key);
      expect(parts.minutes).toBe(minutes);
    }
  });
});

describe('holiday feed service', () => {
  // A fixed "today" pins the service to years 2026 + 2027, so every expected
  // holiday row is deterministic.
  const NOW = Date.UTC(2026, 9, 22);

  beforeEach(() => {
    resetCalendarCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const stubNager = (calls: { count: number }) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        calls.count += 1;
        const match = /PublicHolidays\/(\d{4})\/(ID|US)/.exec(String(input));
        const year = match?.[1];
        const country = match?.[2];
        const rows =
          year === '2026' && country === 'ID'
            ? [{ date: '2026-01-01', name: "New Year's Day" }, { date: '2026-05-27', localName: 'Waisak' }]
            : year === '2026' && country === 'US'
              ? [{ date: '2026-07-04', name: 'Independence Day' }]
              : [];
        return {
          ok: true,
          json: async () => rows,
        } as unknown as Response;
      }),
    );

  it('parses nager rows with dedupe and localName fallback', () => {
    const parsed = parseNagerHolidays({
      idx: [
        { date: '2026-01-01', name: "New Year's Day" },
        { date: '2026-01-01', name: 'Duplicate' },
        { date: '2026-05-27', name: '', localName: 'Waisak' },
        { date: 'nope', name: 'X' },
      ],
    });
    expect(parsed.idx).toHaveLength(2);
    expect(parsed.idx?.[0].name).toBe("New Year's Day");
    expect(parsed.idx?.[1].name).toBe('Waisak');
  });

  it('fetches both markets, appends the Good Friday rule, and stays cached inside TTL', async () => {
    const calls = { count: 0 };
    stubNager(calls);

    const first = await getMarketCalendar(NOW);
    expect(first.generatedAt).toBe(NOW);
    expect(first.idx.source).toBe('ok');
    expect(first.us.source).toBe('ok');
    expect(first.idx.holidays.map((entry) => entry.date)).toContain('2026-01-01');
    expect(first.us.holidays.map((entry) => entry.date)).toContain('2026-07-04');
    // NYSE-only closure the national feed cannot carry.
    expect(first.us.holidays.map((entry) => entry.date)).toContain('2026-04-03');
    // Two years × two markets, then never again within a TTL window.
    expect(calls.count).toBe(4);

    const second = await getMarketCalendar(NOW);
    expect(calls.count).toBe(4);
    expect(second.idx.holidays).toEqual(first.idx.holidays);
  });

  it('degrades to weekend-rule holidays when the feed is unreachable', async () => {
    const calls = { count: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls.count += 1;
        throw new Error('offline');
      }),
    );

    const result = await getMarketCalendar(NOW);
    expect(result.idx.source).toBe('unavailable');
    expect(result.idx.holidays).toEqual([]);
    // The US list keeps the locally computed Good Friday closures: that rule
    // needs no network.
    expect(result.us.source).toBe('unavailable');
    expect(result.us.holidays.length).toBeGreaterThan(0);
  });
});
