import { describe, expect, it } from 'vitest';
import {
  buildSkillBlock,
  buildSkillsVariable,
  extractSlashCommand,
  findSkillByTrigger,
  normalizeSkillKey,
  parseSkillFrontmatter,
  parseTickerArgPrompt,
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

  it('parses the argument kind and the answer shape', () => {
    const fm = parseSkillFrontmatter('---\nname: who\ndescription: Profile [ticker]\narg: ticker\nshape: profile\n---\nbody');
    expect(fm).toMatchObject({ arg: 'ticker', shape: 'profile' });
  });

  it('loads the committed /who profile skill as a ticker command', () => {
    clearBozSkillCache();
    const skill = listBozSkills().find((s) => s.name === 'who');
    expect(skill).toBeTruthy();
    expect(skill!.arg).toBe('ticker');
    expect(skill!.shape).toBe('profile');
    const body = loadBozSkill('who');
    expect(body).toContain('Legitimacy');
    expect(body).toContain('Disclosure depth');
  });

  it('derives slash menu entries without hardcoding', () => {
    const item = skillToSlashCommand({ name: 'idx', description: 'Hunt', triggers: ['/idx'], title: 'IDX Hunt', icon: 'fa-x' });
    expect(item).toEqual({ cmd: '/idx ', title: 'IDX Hunt', desc: 'Hunt', icon: 'fa-x', needsTicker: false });
  });

  it('marks ticker commands from frontmatter and from the [ticker] tag', () => {
    expect(skillToSlashCommand({ name: 'intraday', description: 'Live', triggers: ['/intraday'], arg: 'ticker' }).needsTicker).toBe(true);
    // Existing skills that only carry the tag keep working without edits.
    expect(skillToSlashCommand({ name: 'longterm', description: 'Fundamental [ticker]', triggers: ['/longterm'] }).needsTicker).toBe(true);
    expect(skillToSlashCommand({ name: 'newsintel', description: 'Headlines', triggers: ['/newsintel'] }).needsTicker).toBe(false);
    // A different argument kind is not a ticker.
    expect(skillToSlashCommand({ name: 'idx', description: 'Hunt [sector]', triggers: ['/idx'] }).needsTicker).toBe(false);
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

describe('ticker argument picker (composer)', () => {
  const COMMANDS = [
    { cmd: '/intraday ', needsTicker: true },
    { cmd: '/price ', needsTicker: true },
    { cmd: '/who ', needsTicker: true },
    { cmd: '/newsintel ', needsTicker: false },
    { cmd: '/idx ', needsTicker: false },
  ];

  it('opens the picker for a ticker command with an argument', () => {
    const prompt = parseTickerArgPrompt('/intraday nvx', COMMANDS);
    expect(prompt).toMatchObject({ cmd: 'intraday', prefix: '/intraday ', query: 'nvx' });
    expect(prompt!.apply('NVDA')).toBe('/intraday NVDA');
  });

  it('stays open before any argument is typed so the prompt can invite input', () => {
    expect(parseTickerArgPrompt('/intraday ', COMMANDS)).toMatchObject({ cmd: 'intraday', query: '' });
    expect(parseTickerArgPrompt('/who ', COMMANDS)).toMatchObject({ cmd: 'who', query: '' });
    expect(parseTickerArgPrompt('/intraday', COMMANDS)).toBeNull();
  });

  it('stays out of the way for prose, plain chat, and non-ticker commands', () => {
    // Past one token the user is writing a follow-up, not searching a symbol.
    expect(parseTickerArgPrompt('/intraday NVDA and support levels?', COMMANDS)).toBeNull();
    expect(parseTickerArgPrompt('/newsintel nvx', COMMANDS)).toBeNull();
    expect(parseTickerArgPrompt('/idx nvx', COMMANDS)).toBeNull();
    expect(parseTickerArgPrompt('what is up with nvx', COMMANDS)).toBeNull();
    expect(parseTickerArgPrompt('/unknown nvx', COMMANDS)).toBeNull();
    expect(parseTickerArgPrompt('', COMMANDS)).toBeNull();
  });

  it('matches the command case-insensitively and preserves what was typed', () => {
    const prompt = parseTickerArgPrompt('/Intraday  bitcoin', COMMANDS);
    expect(prompt!.apply('BTC-USD')).toBe('/Intraday BTC-USD');
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

  it('tells the composer which commands need a ticker', async () => {
    clearBozSkillCache();
    const res = await GET();
    const data = await res.json();
    const byCmd = new Map<string, boolean>(
      data.commands.map((c: { cmd: string; needsTicker: boolean }) => [c.cmd.trim(), c.needsTicker]),
    );
    expect(byCmd.get('/intraday')).toBe(true);
    expect(byCmd.get('/longterm')).toBe(true);
    expect(byCmd.get('/price')).toBe(true);
    expect(byCmd.get('/who')).toBe(true);
    expect(byCmd.get('/newsintel')).toBe(false);
    expect(byCmd.get('/idx')).toBe(false);
  });
});
