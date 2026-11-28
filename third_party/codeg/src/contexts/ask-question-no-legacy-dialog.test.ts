import { describe, expect, it } from "vitest"

import { extractQuestionText } from "@/contexts/acp-connections-context"
import { inferLiveToolName } from "@/lib/tool-call-normalization"

/**
 * The new multiple-choice `ask_user_question` MCP tool shares its name with the
 * legacy free-text `QuestionDialog` heuristic. Tool-name normalization DOES
 * classify it as "question" (expected/cosmetic), but the legacy dialog only
 * fires when `extractQuestionText` finds a singular `question` STRING in the raw
 * input. The new tool's input is `{ questions: [...] }` (plural array), so it
 * must NOT trip the legacy dialog. This pins that invariant.
 */
describe("ask_user_question does not trigger the legacy QuestionDialog", () => {
  it("normalization classifies the name as 'question' (cosmetic)", () => {
    expect(
      inferLiveToolName({
        title: "ask_user_question",
        kind: null,
        rawInput: null,
        meta: null,
      })
    ).toBe("question")
  })

  it("extractQuestionText returns null for the plural `questions` input", () => {
    const rawInput = JSON.stringify({
      questions: [
        {
          question: "Which approach?",
          header: "Approach",
          multiSelect: false,
          options: [
            { label: "A", description: "" },
            { label: "B", description: "" },
          ],
        },
      ],
    })
    expect(extractQuestionText(rawInput)).toBeNull()
  })

  it("still extracts a singular `question` string (legacy tools unaffected)", () => {
    expect(extractQuestionText(JSON.stringify({ question: "What now?" }))).toBe(
      "What now?"
    )
    expect(extractQuestionText(null)).toBeNull()
  })
})
