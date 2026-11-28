import { describe, expect, it } from "vitest"

import { isImeCompositionKey } from "./ime-composition"

describe("isImeCompositionKey", () => {
  it("catches the Chromium/Gecko signal on the native event", () => {
    expect(isImeCompositionKey({ key: "Enter", isComposing: true })).toBe(true)
  })

  it("catches `isComposing` behind a React synthetic event's nativeEvent", () => {
    // React keeps `isComposing` off the synthetic event, so call sites that
    // pass the synthetic object must still be recognized.
    expect(
      isImeCompositionKey({
        key: "Enter",
        keyCode: 229,
        nativeEvent: { isComposing: true },
      })
    ).toBe(true)
  })

  it("catches the WebKit 229 sentinel with isComposing already false", () => {
    // The reported bug: WebKit fires `compositionend` before the confirming
    // keydown, so `isComposing` is false and 229 is the only remaining trace.
    expect(
      isImeCompositionKey({ key: "Enter", keyCode: 229, isComposing: false })
    ).toBe(true)
    expect(
      isImeCompositionKey({
        key: "Enter",
        nativeEvent: { keyCode: 229, isComposing: false },
      })
    ).toBe(true)
  })

  it("catches the Gecko `Process` key", () => {
    expect(isImeCompositionKey({ key: "Process" })).toBe(true)
  })

  it("treats a plain Enter as the app's key", () => {
    expect(
      isImeCompositionKey({ key: "Enter", keyCode: 13, isComposing: false })
    ).toBe(false)
    expect(
      isImeCompositionKey({
        key: "Enter",
        keyCode: 13,
        nativeEvent: { isComposing: false, keyCode: 13 },
      })
    ).toBe(false)
  })

  it("does not treat a bare event with no IME fields as composing", () => {
    expect(isImeCompositionKey({ key: "a" })).toBe(false)
  })
})
