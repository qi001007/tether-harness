import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  RESEARCH_ACTIONS,
  RESEARCH_FEATURED_ACCENTS,
} from "@/lib/research-actions"

// science.toml is the single source of truth for which skills are featured and
// what accent each promoted card uses. These invariants fail loudly if
// research-actions.ts drifts from it (a skill added/removed/renamed, or an
// accent changed) — no TOML lib in the frontend deps, so parse the scalar
// header of each [[skill]] block directly.
function parseScienceSkills(): {
  id: string
  featured: boolean
  accent: string | null
}[] {
  const path = join(process.cwd(), "src-tauri/science/science.toml")
  const text = readFileSync(path, "utf8")
  const blocks = text.split(/^\[\[skill\]\]$/m).slice(1)
  return blocks
    .map((block) => {
      // Scalars live before the first [skill.*] sub-table in the block.
      const header = block.split(/^\[skill\./m)[0]
      const id = /^id\s*=\s*"([^"]+)"/m.exec(header)?.[1]
      if (!id) return null
      return {
        id,
        featured: /^featured\s*=\s*true\s*$/m.test(header),
        accent: /^accent\s*=\s*"([^"]+)"/m.exec(header)?.[1] ?? null,
      }
    })
    .filter(
      (v): v is { id: string; featured: boolean; accent: string | null } =>
        v !== null
    )
}

describe("research-actions vs science.toml", () => {
  const skills = parseScienceSkills()
  const featuredIds = skills
    .filter((s) => s.featured)
    .map((s) => s.id)
    .sort()

  it("covers exactly the featured science skills", () => {
    const actionIds = RESEARCH_ACTIONS.map((a) => a.id).sort()
    expect(actionIds).toEqual(featuredIds)
  })

  it("uses each skill's own id as its invocation badge", () => {
    for (const action of RESEARCH_ACTIONS) {
      expect(action.skillId).toBe(action.id)
      expect(action.promptKey).toBe(`prompts.${action.id}`)
    }
  })

  it("promotes only featured skills, with accents matching science.toml", () => {
    const accentById = new Map(skills.map((s) => [s.id, s.accent]))
    for (const [id, accent] of Object.entries(RESEARCH_FEATURED_ACCENTS)) {
      // Every promoted id is a real research action…
      expect(RESEARCH_ACTIONS.some((a) => a.id === id)).toBe(true)
      // …and its accent is exactly what science.toml declares.
      expect(accentById.get(id)).toBe(accent)
    }
  })

  it("has no duplicate action ids", () => {
    const ids = RESEARCH_ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
