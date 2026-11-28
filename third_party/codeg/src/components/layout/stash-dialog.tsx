"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useImeGuard } from "@/hooks/use-ime-guard"
import { gitStashPush } from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"

interface StashDialogProps {
  open: boolean
  folderPath: string
  onClose: () => void
  onStashed: () => void
}

export function StashDialog({
  open,
  folderPath,
  onClose,
  onStashed,
}: StashDialogProps) {
  const t = useTranslations("Folder.branchDropdown.stashDialog")
  const ime = useImeGuard()
  const [message, setMessage] = useState("")
  const [keepIndex, setKeepIndex] = useState(false)
  const [loading, setLoading] = useState(false)

  function handleClose() {
    if (loading) return
    setMessage("")
    setKeepIndex(false)
    onClose()
  }

  async function handleStash() {
    setLoading(true)
    try {
      await gitStashPush(folderPath, message.trim() || undefined, keepIndex)
      toast.success(t("success"))
      setMessage("")
      setKeepIndex(false)
      onStashed()
      onClose()
    } catch (err) {
      toast.error(t("error"), { description: toErrorMessage(err) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="stash-message">{t("messageLabel")}</Label>
            <Input
              id="stash-message"
              placeholder={t("messagePlaceholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              {...ime.props}
              onKeyDown={(e) => {
                if (ime.isComposing(e)) return
                if (e.key === "Enter" && !loading) {
                  handleStash()
                }
              }}
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="keep-index"
              checked={keepIndex}
              onCheckedChange={setKeepIndex}
              disabled={loading}
            />
            <Label htmlFor="keep-index">{t("keepIndex")}</Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={loading}
          >
            {t("cancel")}
          </Button>
          <Button size="sm" onClick={handleStash} disabled={loading}>
            {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {t("stash")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
