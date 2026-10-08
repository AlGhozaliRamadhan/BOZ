import { NextResponse } from 'next/server';
import { skillToSlashCommand } from '@/shared/boz-skills.js';
import { listBozSkills } from '@/services/skills/skill-loader.js';

/** Dynamic slash menu: every `.boz/skills/<name>/SKILL.md` becomes a `/command`. */
export async function GET() {
  try {
    const skills = listBozSkills();
    return NextResponse.json({
      skills: skills.map((s) => ({ name: s.name, description: s.description, triggers: s.triggers })),
      commands: skills.map(skillToSlashCommand),
    });
  } catch {
    return NextResponse.json({ skills: [], commands: [] });
  }
}
