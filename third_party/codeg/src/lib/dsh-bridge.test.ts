import { describe, expect, it, vi } from "vitest"
import {
  DSH_PROMPT_TYPE,
  DSH_PROMPT_RESULT_TYPE,
  isDshExternalSession,
  isDshSessionId,
  sendDshPrompt,
} from "@/lib/dsh-bridge"

describe("dsh-bridge session detection", () => {
  it("accepts a deepseek conversation whose external id is a DSH session", () => {
    expect(isDshExternalSession("deepseek", "session-341d4e84-3c97-42c5")).toBe(
      true
    )
  })

  it("rejects other agents and non-DSH ids", () => {
    expect(isDshExternalSession("claude_code", "session-341d")).toBe(false)
    expect(isDshExternalSession("deepseek", "01a1cd31-ac00-7ca2")).toBe(false)
    expect(isDshExternalSession("deepseek", null)).toBe(false)
    expect(isDshExternalSession(null, undefined)).toBe(false)
  })

  it("keeps the id charset narrow — it is interpolated into a URL path", () => {
    expect(isDshSessionId("session-abc_1.2")).toBe(true)
    expect(isDshSessionId('session-x" onload="1')).toBe(false)
    expect(isDshSessionId("session-../etc")).toBe(false)
    expect(isDshSessionId("session-")).toBe(false)
  })
})

describe("sendDshPrompt", () => {
  it("posts the prompt to the parent frame and resolves with the host's verdict", async () => {
    const postMessage = vi.fn()
    const fakeParent = { postMessage } as unknown as Window
    const parentSpy = vi
      .spyOn(window, "parent", "get")
      .mockReturnValue(fakeParent)

    const pending = sendDshPrompt("session-abc", "hello")
    expect(postMessage).toHaveBeenCalledTimes(1)
    const message = postMessage.mock.calls[0][0] as {
      type: string
      id: string
      sessionId: string
      text: string
      device?: string
    }
    expect(message).toMatchObject({
      type: DSH_PROMPT_TYPE,
      sessionId: "session-abc",
      text: "hello",
    })
    // The guest cannot know which Tether device it belongs to; the host fills
    // that in, so the bridge must not invent one.
    expect(message.device).toBeUndefined()

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: DSH_PROMPT_RESULT_TYPE,
          id: message.id,
          ok: true,
          status: 200,
          error: null,
        },
      })
    )
    await expect(pending).resolves.toEqual({
      ok: true,
      status: 200,
      error: null,
    })
    parentSpy.mockRestore()
  })

  it("reports the host's refusal reason", async () => {
    const fakeParent = { postMessage: vi.fn() } as unknown as Window
    const parentSpy = vi
      .spyOn(window, "parent", "get")
      .mockReturnValue(fakeParent)

    const pending = sendDshPrompt("session-abc", "hello", { timeoutMs: 50 })
    const sent = (
      fakeParent.postMessage as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0][0] as { id: string }
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: DSH_PROMPT_RESULT_TYPE,
          id: sent.id,
          ok: false,
          status: 409,
          error: "session_busy",
        },
      })
    )
    await expect(pending).resolves.toEqual({
      ok: false,
      status: 409,
      error: "session_busy",
    })
    parentSpy.mockRestore()
  })

  it("fails fast when there is no host frame", async () => {
    const parentSpy = vi.spyOn(window, "parent", "get").mockReturnValue(window)
    await expect(sendDshPrompt("session-abc", "hello")).resolves.toMatchObject({
      ok: false,
      status: 0,
    })
    parentSpy.mockRestore()
  })
})