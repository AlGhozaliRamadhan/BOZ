/**
 * Server-only BOZ skill loader (Node fs).
 * Search order: repo `.boz/` (committed defaults) — user overrides can shadow
 * by placing their own `.boz/` higher in the walk. Never throws: missing skill
 * returns null and the engine falls back to its built-in mandate.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  parseSkillFrontmatter,
  normalizeSkillKey,
  skillBody,
  type BozSkillFrontmatter,
} from '@/shared/boz-skills.js';

const MAX_SKILL_CHARS = 4000;
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  at: number;
  value: string | null;
}

const fileCache = new Map<string, CacheEntry>();

function bozRoots(): string[] {
  const roots: string[] = [];
  let dir = resolve(process.cwd());
  for (let i = 0; i < 5; i++) {
    roots.push(join(dir, '.boz', 'skills'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return roots;
}

function readSkillFile(name: string): string | null {
  const safe = normalizeSkillKey(name).replace(/[^a-z0-9_-]/g, '');
  if (!safe) return null;
  const cached = fileCache.get(safe);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  let value: string | null = null;
  for (const root of bozRoots()) {
    const path = join(root, safe, 'SKILL.md');
    try {
      if (existsSync(path)) {
        value = readFileSync(path, 'utf8');
        break;
      }
    } catch {
      // ignore and keep walking — missing skill is not an error
    }
  }
  fileCache.set(safe, { at: Date.now(), value });
  return value;
}

/** Full skill body (frontmatter stripped, capped). Null when missing. */
export function loadBozSkill(name: string, maxChars = MAX_SKILL_CHARS): string | null {
  const raw = readSkillFile(name);
  if (!raw) return null;
  return skillBody(raw, maxChars);
}

/** Skill index for the kernel prompt. Falls back to static defaults when .boz/ is absent. */
export function listBozSkills(): BozSkillFrontmatter[] {
  const found: BozSkillFrontmatter[] = [];
  for (const root of bozRoots()) {
    try {
      if (!existsSync(root)) continue;
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const path = join(root, entry.name, 'SKILL.md');
        if (!existsSync(path)) continue;
        try {
          const fm = parseSkillFrontmatter(readFileSync(path, 'utf8'));
          if (fm && !found.some((s) => s.name === fm.name)) found.push(fm);
        } catch {
          // skip unreadable skill — never break chat
        }
      }
      if (found.length) break;
    } catch {
      // ignore
    }
  }
  if (found.length) {
    found.sort((a, b) => a.name.localeCompare(b.name));
    return found;
  }
  return [
    { name: 'global', description: 'Global market outlook — equities, bonds/rates, macro regime', triggers: ['/global'], title: 'Global', icon: 'fa-earth-asia' },
    { name: 'help', description: 'List what BOZ can do — all slash skills', triggers: ['/help'], title: 'Help', icon: 'fa-circle-question' },
    { name: 'idx', description: 'Hunt IDX momentum setups — rebound, breakout, oversold [sector]', triggers: ['/idx'], title: 'IDX Hunt', icon: 'fa-magnifying-glass-chart' },
    { name: 'intraday', description: 'Live intraday analysis & key levels [ticker]', triggers: ['/intraday'], title: 'Intraday', icon: 'fa-chart-line' },
    { name: 'longterm', description: 'Fundamental analysis & long-term outlook [ticker]', triggers: ['/longterm'], title: 'Longterm', icon: 'fa-scale-balanced' },
    { name: 'newsintel', description: 'Scan latest market headlines', triggers: ['/newsintel'], title: '/newsintel', icon: 'fa-newspaper' },
    { name: 'price', description: 'Quick live price check for any asset [ticker]', triggers: ['/price'], title: 'Price', icon: 'fa-tag' },
    { name: 'sentiment', description: 'Crowd sentiment check — Fear & Greed + StockTwits pulse', triggers: ['/sentiment'], title: 'Sentiment', icon: 'fa-face-smile' },
  ];
}

/** For tests: clear the file cache. */
export function clearBozSkillCache(): void {
  fileCache.clear();
}
