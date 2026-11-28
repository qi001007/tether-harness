import { describe, expect, it } from "vitest"

describe("vitest harness", () => {
  it("loads jsdom and jest-dom matchers", () => {
    const el = document.createElement("div")
    el.textContent = "hello"
    document.body.appendChild(el)
    expect(el).toBeInTheDocument()
    expect(el).toHaveTextContent("hello")
    document.body.removeChild(el)
  })
})
