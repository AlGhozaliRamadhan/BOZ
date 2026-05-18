import type { Candle } from '../types/types.js';

const NY_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const NY_DOW = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
});

const REGULAR_START_MINUTES = 9 * 60 + 30;
const REGULAR_END_MINUTES = 16 * 60;

function getNyMinutes(date: Date): number {
  const parts = NY_TIME.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const hour = Number(map.hour ?? '0');
  const minute = Number(map.minute ?? '0');
  return (hour * 60) + minute;
}

function isMarketOpen(date: Date): boolean {
  const weekday = NY_DOW.format(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = getNyMinutes(date);
  return minutes >= REGULAR_START_MINUTES && minutes < REGULAR_END_MINUTES;
}

export interface DataFreshness {
  latestCandleUtc: string;
  ageMinutes: number;
  isStale: boolean;
  isIncomplete: boolean;
  marketOpen: boolean;
  staleThresholdMinutes: number;
}

export function computeDataFreshness(
  latest: Candle,
  now: Date,
  intervalMinutes: number,
  isIncomplete: boolean,
): DataFreshness {
  const ageMinutes = Math.max(0, (now.getTime() - latest.date.getTime()) / 60000);
  const marketOpen = isMarketOpen(now);
  const staleThresholdMinutes = marketOpen
    ? Math.max(30, Math.round(intervalMinutes * 1.1))
    : Math.max(24 * 60, Math.round(intervalMinutes * 2));
  const isStale = ageMinutes > staleThresholdMinutes;
  const latestCandleUtc = latest.date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  return {
    latestCandleUtc,
    ageMinutes,
    isStale,
    isIncomplete,
    marketOpen,
    staleThresholdMinutes,
  };
}
