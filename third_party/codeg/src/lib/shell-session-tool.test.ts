import { describe, expect, it } from "vitest"

import {
  describeStdinChars,
  extractAnnouncedSessionId,
  isShellSessionToolName,
  parseShellSessionInput,
} from "./shell-session-tool"

describe("isShellSessionToolName", () => {
  it("matches the two codex unified-exec session tools", () => {
    expect(isShellSessionToolName("wait")).toBe(true)
    expect(isShellSessionToolName("write_stdin")).toBe(true)
    // `wait_agent` is the collab tool — a different thing entirely.
    expect(isShellSessionToolName("wait_agent")).toBe(false)
    expect(isShellSessionToolName("bash")).toBe(false)
  })
})

describe("parseShellSessionInput", () => {
  it("reads a wait: string cell id plus the resolved command", () => {
    expect(
      parseShellSessionInput(
        '{"cell_id":"7106","yield_time_ms":30000,"session_command":"cargo test"}'
      )
    ).toEqual({
      sessionId: "7106",
      command: "cargo test",
      chars: "",
      terminate: false,
    })
  })

  it("reads a write_stdin: numeric session id normalized to a string", () => {
    expect(
      parseShellSessionInput('{"session_id":33067,"chars":"y\\n"}')
    ).toEqual({
      sessionId: "33067",
      command: null,
      chars: "y\n",
      terminate: false,
    })
  })

  it("reports a terminating wait", () => {
    expect(
      parseShellSessionInput('{"cell_id":"42","terminate":true}')?.terminate
    ).toBe(true)
  })

  it("returns null for anything that is not an argument object", () => {
    expect(parseShellSessionInput(null)).toBeNull()
    expect(parseShellSessionInput("")).toBeNull()
    expect(parseShellSessionInput("not json")).toBeNull()
    expect(parseShellSessionInput("[1,2]")).toBeNull()
  })
})

describe("extractAnnouncedSessionId", () => {
  it("reads the id a script echoed after starting a background shell", () => {
    // Verbatim from a rollout: `text(r.output)` printed nothing, the echo is
    // the whole body of the card.
    expect(extractAnnouncedSessionId("\nSESSION_ID=17983")).toBe("17983")
    expect(extractAnnouncedSessionId("Installing…\nSESSION_ID=25332\n")).toBe(
      "25332"
    )
    expect(extractAnnouncedSessionId("SESSION_ID=25332\r\n")).toBe("25332")
  })

  it("ignores anything that is not the announcement line itself", () => {
    expect(extractAnnouncedSessionId(null)).toBeNull()
    expect(extractAnnouncedSessionId("")).toBeNull()
    // The script's own source, grepped back out of the transcript.
    expect(
      extractAnnouncedSessionId("if (r.session_id) text(`SESSION_ID=${r.id}`)")
    ).toBeNull()
    // Mentioned mid-line, or carrying something other than an id.
    expect(
      extractAnnouncedSessionId("export SESSION_ID=17983 && run")
    ).toBeNull()
    expect(extractAnnouncedSessionId("SESSION_ID=abc")).toBeNull()
  })
})

describe("describeStdinChars", () => {
  it("renders control characters that would otherwise be invisible", () => {
    expect(describeStdinChars("\u0003")).toBe("^C")
    expect(describeStdinChars("\u0004")).toBe("^D")
    expect(describeStdinChars("\u001b")).toBe("^[")
    expect(describeStdinChars("\u007f")).toBe("^?")
  })

  it("keeps ordinary text, showing newlines as a return symbol", () => {
    expect(describeStdinChars("y\n")).toBe("y⏎")
  })

  it("truncates a long payload", () => {
    expect(describeStdinChars("a".repeat(100))).toHaveLength(40)
  })
})
