import { describe, expect, it } from "vitest"

import {
  defaultCustomSkillTemplate,
  parseYamlFrontMatter,
} from "./skill-frontmatter"

describe("parseYamlFrontMatter", () => {
  it("splits a frontmatter block into fields and body", () => {
    const parsed = parseYamlFrontMatter(
      '---\nname: my-skill\ndescription: "Does a thing"\n---\n\n# Body\n\ntext'
    )
    expect(parsed.fields).toEqual([
      { key: "name", value: "my-skill" },
      { key: "description", value: "Does a thing" }, // surrounding quotes stripped
    ])
    expect(parsed.body).toBe("# Body\n\ntext")
    expect(parsed.frontMatterRaw).toContain("name: my-skill")
  })

  it("returns the whole content as body when there is no frontmatter", () => {
    const parsed = parseYamlFrontMatter("# Just markdown\n\nno frontmatter")
    expect(parsed.frontMatterRaw).toBeNull()
    expect(parsed.fields).toEqual([])
    expect(parsed.body).toBe("# Just markdown\n\nno frontmatter")
  })

  it("ignores comment and non key:value lines", () => {
    const parsed = parseYamlFrontMatter(
      "---\n# a comment\nname: skill\nnot a pair\n---\nbody"
    )
    expect(parsed.fields).toEqual([{ key: "name", value: "skill" }])
  })
})

describe("defaultCustomSkillTemplate", () => {
  it("produces a valid, parseable SKILL.md scaffold", () => {
    const template = defaultCustomSkillTemplate()
    const parsed = parseYamlFrontMatter(template)
    expect(parsed.frontMatterRaw).not.toBeNull()
    const keys = parsed.fields.map((f) => f.key)
    expect(keys).toContain("name")
    expect(keys).toContain("description")
    expect(parsed.body.trim().length).toBeGreaterThan(0)
  })
})
