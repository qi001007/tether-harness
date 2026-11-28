import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import { QuestionDialog } from "./question-dialog"
import enMessages from "@/i18n/messages/en.json"
import type { PendingQuestion } from "@/contexts/acp-connections-context"

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe("QuestionDialog", () => {
  it("returns nothing when question is null", () => {
    const { container } = renderWithIntl(
      <QuestionDialog question={null} onAnswer={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders the en title plus the question text", () => {
    const question: PendingQuestion = {
      tool_call_id: "q-1",
      question: "Which file should I edit?",
    }
    renderWithIntl(<QuestionDialog question={question} onAnswer={() => {}} />)
    expect(screen.getByText("Agent is asking a question")).toBeInTheDocument()
    expect(screen.getByText("Which file should I edit?")).toBeInTheDocument()
  })

  it("disables Send until the answer has non-whitespace content", () => {
    const question: PendingQuestion = {
      tool_call_id: "q-2",
      question: "?",
    }
    renderWithIntl(<QuestionDialog question={question} onAnswer={() => {}} />)
    const sendBtn = screen.getByRole("button", { name: /Send/i })
    expect(sendBtn).toBeDisabled()

    const textarea = screen.getByPlaceholderText("Type your answer...")
    fireEvent.change(textarea, { target: { value: "   " } })
    expect(sendBtn).toBeDisabled()

    fireEvent.change(textarea, { target: { value: "yes" } })
    expect(sendBtn).not.toBeDisabled()
  })

  it("invokes onAnswer with trimmed text when Send is clicked", () => {
    const onAnswer = vi.fn()
    const question: PendingQuestion = {
      tool_call_id: "q-3",
      question: "?",
    }
    renderWithIntl(<QuestionDialog question={question} onAnswer={onAnswer} />)
    const textarea = screen.getByPlaceholderText("Type your answer...")
    fireEvent.change(textarea, { target: { value: "   hello world   " } })
    fireEvent.click(screen.getByRole("button", { name: /Send/i }))
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer).toHaveBeenCalledWith("hello world")
  })

  it("resets the answer when tool_call_id changes between renders", () => {
    // The component compares the previous tool_call_id in a ref and clears
    // the answer state when a new question arrives. Regression guard: a
    // stale draft must not bleed into the next question's UI.
    const { rerender } = renderWithIntl(
      <QuestionDialog
        question={{ tool_call_id: "q-a", question: "First?" }}
        onAnswer={() => {}}
      />
    )
    const textarea = screen.getByPlaceholderText(
      "Type your answer..."
    ) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "draft answer" } })
    expect(textarea.value).toBe("draft answer")

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QuestionDialog
          question={{ tool_call_id: "q-b", question: "Second?" }}
          onAnswer={() => {}}
        />
      </NextIntlClientProvider>
    )
    const refreshed = screen.getByPlaceholderText(
      "Type your answer..."
    ) as HTMLTextAreaElement
    expect(refreshed.value).toBe("")
  })
})
