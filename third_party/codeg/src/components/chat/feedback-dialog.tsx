"use client"

/**
 * Dialog for composing a live-feedback note, opened from the composer "+" menu.
 * Add-only (notes are read-only once sent). Enter sends, Shift+Enter inserts a
 * newline — matching the main composer.
 *
 * The draft lives in `FeedbackDialogForm`, which is mounted only inside
 * `DialogContent` (Radix unmounts it on close), so every open starts with an
 * empty field — no reset effect needed.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useImeGuard } from "@/hooks/use-ime-guard"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface FeedbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (text: string) => void
  submitting?: boolean
  agentName?: string
  /** Which channel the note rides (`useSessionFeedback().channel`): `native`
   *  = injected into the running turn immediately, `pull` = read when the
   *  agent next checks. Only swaps the description copy — the pull wording
   *  ("the next time it checks") is wrong for an instant push. */
  channel?: "native" | "pull"
}

interface FeedbackDialogFormProps {
  onSubmit: (text: string) => void
  onCancel: () => void
  submitting: boolean
  agentName?: string
  channel: "native" | "pull"
}

function FeedbackDialogForm({
  onSubmit,
  onCancel,
  submitting,
  agentName,
  channel,
}: FeedbackDialogFormProps) {
  const t = useTranslations("LiveFeedback")
  const ime = useImeGuard()
  const [text, setText] = useState("")

  const trimmed = text.trim()
  const canSend = trimmed.length > 0 && !submitting

  const handleSubmit = () => {
    if (canSend) onSubmit(trimmed)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("dialogTitle")}</DialogTitle>
        <DialogDescription>
          {t(
            channel === "native"
              ? "dialogDescriptionInstant"
              : "dialogDescription"
          )}
        </DialogDescription>
      </DialogHeader>
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        {...ime.props}
        onKeyDown={(e) => {
          if (ime.isComposing(e)) return
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            handleSubmit()
          }
        }}
        placeholder={t("placeholder", {
          agent: agentName ?? t("agentFallback"),
        })}
        aria-label={t("ariaLabel")}
        className="max-h-40 min-h-28 overflow-y-auto"
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button onClick={handleSubmit} disabled={!canSend}>
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {t("send")}
        </Button>
      </DialogFooter>
    </>
  )
}

export function FeedbackDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting = false,
  agentName,
  channel = "pull",
}: FeedbackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <FeedbackDialogForm
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
          submitting={submitting}
          agentName={agentName}
          channel={channel}
        />
      </DialogContent>
    </Dialog>
  )
}
