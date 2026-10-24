import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GREETING_FALLBACK_NAME,
  getRandomGreeting,
  greetingForHour,
  resolveGreetingName,
} from '../src/app/chat/_lib/greetings.js';

const pinPick = (value: number) => vi.spyOn(Math, 'random').mockReturnValue(value);

// Pick indices with 4 templates per slot: 0 -> first, 0.25 -> second, 0.999 -> fourth.
const FIRST = 0;
const SECOND = 0.25;
const LAST = 0.999;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('resolveGreetingName', () => {
  it('falls back to the canned persona when unset, blank or placeholder', () => {
    expect(resolveGreetingName(undefined)).toBe(GREETING_FALLBACK_NAME);
    expect(resolveGreetingName('')).toBe(GREETING_FALLBACK_NAME);
    expect(resolveGreetingName('   ')).toBe(GREETING_FALLBACK_NAME);
    expect(resolveGreetingName('user')).toBe(GREETING_FALLBACK_NAME);
    expect(resolveGreetingName('USER')).toBe(GREETING_FALLBACK_NAME);
  });

  it('trims and keeps a configured name verbatim', () => {
    expect(resolveGreetingName('  Oz  ')).toBe('Oz');
    expect(resolveGreetingName('Grace L.')).toBe('Grace L.');
  });
});

describe('greetingForHour', () => {
  it('greets the configured name at the first template of each time slot', () => {
    pinPick(FIRST);
    expect(greetingForHour(8, 'Ada')).toBe('Good morning, Ada');
    expect(greetingForHour(13, 'Ada')).toBe('Good afternoon, Ada');
    expect(greetingForHour(19, 'Ada')).toBe('Good evening, Ada');
  });

  it('keeps the canned persona instead of the profile placeholder', () => {
    pinPick(FIRST);
    expect(greetingForHour(8)).toBe('Good morning, User');
    expect(greetingForHour(8, 'user')).toBe('Good morning, User');
    expect(greetingForHour(19)).toBe('Good evening, User');
  });

  it('leaves templates without a persona untouched in both modes', () => {
    pinPick(FIRST);
    expect(greetingForHour(2, 'Ada')).toBe('Burning the midnight oil?');
    expect(greetingForHour(2)).toBe('Burning the midnight oil?');
  });

  it('fills the persona at a later template and after the nightly boundary', () => {
    pinPick(SECOND);
    expect(greetingForHour(22, 'Ada')).toBe('Late night research mode, Ada');
    expect(greetingForHour(22)).toBe('Late night research mode, User');
  });

  it('ignores the persona for nameless templates', () => {
    pinPick(LAST);
    expect(greetingForHour(8, 'Ada')).toBe('Good morning! Let\'s check the tape');
    expect(greetingForHour(22)).toBe('Overnight global market scan');
  });
});

describe('getRandomGreeting', () => {
  it('maps local hour boundaries to slots and on-greets the profile name', () => {
    vi.useFakeTimers();
    pinPick(FIRST);
    const cases: Array<[number, number, string]> = [
      [5, 'Ada', 'Good morning, Ada'],
      [11, 'Ada', 'Good morning, Ada'],
      [12, 'Ada', 'Good afternoon, Ada'],
      [17, 'Ada', 'Good evening, Ada'],
      [22, 'Ada', 'Burning the midnight oil?'],
    ];
    for (const [hour, name, expected] of cases) {
      vi.setSystemTime(new Date(2026, 9, 23, hour, 0, 0));
      expect(getRandomGreeting(name)).toBe(expected);
    }
  });

  it('never leaks the placeholder token in either fallback mode', () => {
    expect(getRandomGreeting('Oz')).not.toContain('{name}');
    expect(getRandomGreeting('Oz')).not.toContain('User');
    expect(getRandomGreeting()).not.toContain('{name}');
    expect(getRandomGreeting()).not.toContain('Oz');
  });
});
