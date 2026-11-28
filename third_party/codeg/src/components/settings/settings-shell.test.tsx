import { describe, expect, it } from "vitest"

import { settingsNavItemsFor } from "./settings-shell"

describe("settingsNavItemsFor", () => {
  it("keeps only General and Agents", () => {
    const labels = settingsNavItemsFor("tauri").map((item) => item.labelKey)
    expect(labels).toEqual(["general", "agents"])
  })

  it("drops the Codeg appearance page (the APP owns appearance)", () => {
    const labels = settingsNavItemsFor("web").map((item) => item.labelKey)
    expect(labels).not.toContain("appearance")
  })
})