/**
 * Pure BOZ skill helpers (no fs, no DOM).
 * Slash commands like `/intraday NVDA` are triggers for `.boz/skills/<name>/SKILL.md`,
 * not hardcoded handlers. Server loader in `src/services/skills/skill-loader.ts`
 * reads the file; this module parses, matches, and formats.
 */

export interface BozSkillFrontmatter {
  name: string;
  description: string;
  triggers: string[];
  /** Optional UI hints for the Composer slash menu. Defaults derived from name. */
  title?: string;
  icon?: string;
}

export interface SlashCommand {
  cmd: string;
  args: string;
}

/** Parse `---` YAML frontmatter (name/description/triggers/title/icon). Never throws. */
export function parseSkillFrontmatter(md: string): BozSkillFrontmatter | null {
  const match = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const raw = match[1];
  const get = (key: string): string => {
    const m = raw.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return (m?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  };
  const name = get('name');
  const description = get('description');
  if (!name) return null;
  const triggersRaw = get('triggers');
  const triggers = triggersRaw
    ? triggersRaw
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((t) => t.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    : [`/${name}`];
  const title = get('title') || undefined;
  const icon = get('icon') || undefined;
  return { name, description, triggers, ...(title ? { title } : {}), ...(icon ? { icon } : {}) };
}

/** Derive the slash-menu entry for a skill. No hardcoded command list. */
export function skillToSlashCommand(skill: BozSkillFrontmatter): { cmd: string; title: string; desc: string; icon: string } {
  const trigger = skill.triggers[0] || `/${skill.name}`;
  const cmd = trigger.endsWith(' ') ? trigger : `${trigger} `;
  return {
    cmd,
    title: skill.title || skill.name.charAt(0).toUpperCase() + skill.name.slice(1),
    desc: skill.description || '',
    icon: skill.icon || 'fa-wand-magic-sparkles',
  };
}

/** Match `/cmd args` at message start. Returns null for non-slash chat. */
export function extractSlashCommand(message: string): SlashCommand | null {
  const match = message.trimStart().match(/^\/([A-Za-z0-9_-]+)\s*([\s\S]*)$/);
  if (!match) return null;
  return { cmd: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
}

/** Normalize a skill key: strip leading slash, lowercase, keep safe chars. */
export function normalizeSkillKey(name: string): string {
  return (name ?? '').trim().replace(/^\/+/, '').toLowerCase();
}

/** Resolve a slash cmd or trigger to its skill name. Matches triggers or name. */
export function findSkillByTrigger(
  skills: BozSkillFrontmatter[],
  cmd: string,
): BozSkillFrontmatter | null {
  const key = normalizeSkillKey(cmd);
  if (!key) return null;
  for (const s of skills) {
    if (normalizeSkillKey(s.name) === key) return s;
    for (const t of s.triggers ?? []) {
      if (normalizeSkillKey(t) === key) return s;
    }
  }
  return null;
}

/** Strip frontmatter, return body capped at maxChars. */
export function skillBody(md: string, maxChars = 4000): string {
  const body = md.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, '').trim();
  return body.length > maxChars ? body.slice(0, maxChars) : body;
}

/** Wrap an active skill for system-prompt injection. Skill MD is untrusted data. */
export function buildSkillBlock(name: string, body: string, args: string): string {
  return [
    `<boz_skill name="${name}">`,
    body,
    args ? `Active trigger args: ${args}` : '',
    '</boz_skill>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Index line for the kernel prompt (~60 tokens/skill). */
export function skillIndexPrompt(skills: BozSkillFrontmatter[]): string {
  if (!skills.length) return '';
  const lines = skills.map(
    (s) => `- ${s.name}: ${s.description || 'no description'} (trigger: ${s.triggers[0] || `/${s.name}`})`,
  );
  return ['BOZ SKILLS (trigger with /<name>; active skill body follows when triggered):', ...lines].join('\n');
}

/**
 * Skills variable for system-prompt injection.
 * One block the model can inspect to see what it can do (capabilities),
 * what rules each skill carries, and how to load them on demand via the
 * `list_skills` / `get_skill` tools. Skill MD stays the source of truth —
 * this block only advertises and carries the already-active skill body.
 */
export function buildSkillsVariable(
  skills: BozSkillFrontmatter[],
  active: { name: string; body: string; args: string } | null = null,
): string {
  const lines = skills.map(
    (s) => `- ${s.name}: ${s.description || 'no description'} (load: get_skill {"name": "${s.name}"})`,
  );
  const parts = [
    '<boz_skills>',
    'Available skills — call get_skill for the full rules before acting under one.',
    ...lines,
    'Slash fast-path: a leading /<name> pre-loads that skill body below; otherwise call get_skill yourself.',
    '</boz_skills>',
  ];
  if (active?.body) {
    parts.push(buildSkillBlock(active.name, active.body, active.args));
  }
  return parts.join('\n');
}
