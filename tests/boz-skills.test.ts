import { describe, expect, it } from 'vitest';
import {
  buildSkillBlock,
  buildSkillsVariable,
  extractSlashCommand,
  findSkillByTrigger,
  normalizeSkillKey,
  parseSkillFrontmatter,
  skillBody,
  skillIndexPrompt,
  skillToSlashCommand,
} from '../src/shared/boz-skills.js';
import { clearBozSkillCache, listBozSkills, loadBozSkill } from '../src/services/skills/skill-loader.js';
import { GET } from '../src/app/api/skills/route.js';

describe('boz skills (pure)', () => {
  it('parses intraday frontmatter', () => {
    const fm = parseSkillFrontmatter('---\nname: intraday\ndescription: Live\ntriggers: ["/intraday"]\n---\nbody');
    expect(fm).toMatchObject({ name: 'intraday', description: 'Live', triggers: ['/intraday'] });
  });

  it('parses title and icon hints', () => {
    const fm = parseSkillFrontmatter('---\nname: idx\ntitle: IDX Hunt\nicon: fa-chart\n---\nbody');
    expect(fm).toMatchObject({ name: 'idx', title: 'IDX Hunt', icon: 'fa-chart' });
  });

  it('derives slash menu entries without hardcoding', () => {
    const item = skillToSlashCommand({ name: 'idx', description: 'Hunt', triggers: ['/idx'], title: 'IDX Hunt', icon: 'fa-x' });
    expect(item).toEqual({ cmd: '/idx ', title: 'IDX Hunt', desc: 'Hunt', icon: 'fa-x' });
  });

  it('returns null without frontmatter', () => {
    expect(parseSkillFrontmatter('no frontmatter')).toBeNull();
  });

  it('extracts slash command and args', () => {
    expect(extractSlashCommand('/intraday NVDA')).toEqual({ cmd: 'intraday', args: 'NVDA' });
    expect(extractSlashCommand('hello')).toBeNull();
  });

  it('strips frontmatter and caps body', () => {
    expect(skillBody('---\nname: x\n---\nhello world', 5)).toBe('hello');
  });

  it('wraps skill block with args', () => {
    const block = buildSkillBlock('intraday', 'do stuff', 'NVDA');
    expect(block).toContain('<boz_skill name="intraday">');
    expect(block).toContain('NVDA');
  });

  it('builds index prompt', () => {
    const index = skillIndexPrompt([{ name: 'intraday', description: 'Live', triggers: ['/intraday'] }]);
    expect(index).toContain('/intraday');
    expect(skillIndexPrompt([])).toBe('');
  });

  it('normalizes skill keys (slash, case)', () => {
    expect(normalizeSkillKey('/Intraday')).toBe('intraday');
    expect(normalizeSkillKey('intraday')).toBe('intraday');
  });

  it('resolves triggers to skill names', () => {
    const skills = [{ name: 'intraday', description: 'Live', triggers: ['/intraday'] }];
    expect(findSkillByTrigger(skills, 'intraday')?.name).toBe('intraday');
    expect(findSkillByTrigger(skills, '/intraday')?.name).toBe('intraday');
    expect(findSkillByTrigger(skills, 'missing')).toBeNull();
  });

  it('builds skills variable with tool hints and active body', () => {
    const skills = [{ name: 'intraday', description: 'Live', triggers: ['/intraday'] }];
    const variable = buildSkillsVariable(skills, { name: 'intraday', body: 'do stuff', args: 'NVDA' });
    expect(variable).toContain('<boz_skills>');
    expect(variable).toContain('get_skill');
    expect(variable).toContain('<boz_skill name="intraday">');
    expect(buildSkillsVariable(skills, null)).toContain('<boz_skills>');
  });
});

describe('boz skill loader (server)', () => {
  it('loads the committed intraday skill', () => {
    clearBozSkillCache();
    const body = loadBozSkill('intraday');
    expect(body).toBeTruthy();
    expect(body!).toContain('fetch_ticker_dashboard');
  });

  it('returns null for missing skill (fallback path)', () => {
    clearBozSkillCache();
    expect(loadBozSkill('does-not-exist-xyz')).toBeNull();
  });

  it('lists skills with static fallback', () => {
    const skills = listBozSkills();
    expect(skills.map((s) => s.name)).toContain('intraday');
  });

  it('loads every committed skill folder', () => {
    clearBozSkillCache();
    for (const name of ['intraday', 'longterm', 'newsintel', 'global', 'idx', 'price', 'sentiment', 'help']) {
      expect(loadBozSkill(name), name).toBeTruthy();
    }
  });

  it('lists all eight skills from .boz/', () => {
    clearBozSkillCache();
    const names = listBozSkills().map((s) => s.name);
    for (const name of ['intraday', 'longterm', 'newsintel', 'global', 'idx', 'price', 'sentiment', 'help']) {
      expect(names).toContain(name);
    }
  });
});

describe('skills route (dynamic slash menu)', () => {
  it('returns commands derived from skill frontmatter', async () => {
    clearBozSkillCache();
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.commands.length).toBeGreaterThanOrEqual(8);
    expect(data.commands.map((c: { cmd: string }) => c.cmd)).toContain('/intraday ');
  });
});
