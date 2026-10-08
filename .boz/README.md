# .boz — default BOZ skills (committed)

Smart AI sandbox: slash commands are triggers for `SKILL.md`, not hardcoded handlers.

- Folder = slash command minus slash, kebab-case. File is always uppercase `SKILL.md`.
- Chat auto-loads `.boz/skills/<name>/SKILL.md` when the message starts with `/<name>`.
- Fallback: if a skill file is missing, the engine uses its built-in mandate — chat never breaks.
- Precedence (first hit wins): user override `<cwd>/.boz/` > repo `.boz/` > built-in fallback.
- On conflict with `AGENTS.md`, `AGENTS.md` wins and the skill gets updated.

## Add a new skill (no code change)

1. Create `.boz/skills/<name>/SKILL.md` with frontmatter:
   `name`, `description`, `triggers: ["/<name>"]`, optional `title`, `icon` (FontAwesome class).
2. Write the instruction body: when to use, must-do tool steps, output shape.
3. It appears automatically in the Composer `/` menu (via `/api/skills`) and in the engine prompt. Try `/<name>`.

Current skills: `intraday`, `longterm`, `newsintel`, `global`, `idx`, `price`, `sentiment`, `help`.
See `skills/intraday/SKILL.md` for the default intraday skill.
