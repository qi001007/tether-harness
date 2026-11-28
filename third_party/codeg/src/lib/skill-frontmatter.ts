// Shared SKILL.md frontmatter helpers, used by both the per-agent Skills editor
// (`skills-settings.tsx`) and the Custom skill pack editor
// (`custom-skills-settings.tsx`). Kept dependency-free so it can be unit-tested
// in isolation.

export interface FrontMatterField {
  key: string
  value: string
}

export interface ParsedFrontMatter {
  frontMatterRaw: string | null
  fields: FrontMatterField[]
  body: string
}

/**
 * Best-effort parse of a leading YAML frontmatter block (`--- … ---`) into a
 * flat list of `key: value` fields plus the remaining markdown body. This is a
 * display helper, not a full YAML parser: nested keys and block scalars are
 * ignored, and matching surrounding quotes are stripped from scalar values.
 */
export function parseYamlFrontMatter(content: string): ParsedFrontMatter {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n)?/)
  if (!match) {
    return {
      frontMatterRaw: null,
      fields: [],
      body: content,
    }
  }

  const raw = match[1].trim()
  const lines = raw.split(/\r?\n/)
  const fields: FrontMatterField[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const kv = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.+)$/)
    if (!kv) continue
    let value = kv[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    fields.push({ key: kv[1], value })
  }

  return {
    frontMatterRaw: raw,
    fields,
    body: content.slice(match[0].length),
  }
}

/**
 * A generic SKILL.md scaffold for a brand-new custom skill. Not agent-specific
 * (custom skills live in the shared central store and are enabled per agent via
 * links), so it uses a neutral template the user edits before saving.
 */
export function defaultCustomSkillTemplate(): string {
  return `---
name: my-skill
description: What this skill does and when the agent should use it.
---

# My Skill

Describe the workflow, steps, and any constraints here. The agent reads this
file when the skill is invoked.
`
}
