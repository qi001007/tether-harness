"use client"

import {
  Bot,
  Bug,
  CheckCheck,
  FileCode2,
  FlaskConical,
  GitBranch,
  GitFork,
  GitMerge,
  Lightbulb,
  ListTodo,
  MessageSquareQuote,
  MessageSquareReply,
  PlayCircle,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

const ICON_MAP: Record<string, LucideIcon> = {
  Lightbulb,
  ListTodo,
  PlayCircle,
  Bot,
  GitFork,
  GitBranch,
  FlaskConical,
  CheckCheck,
  Bug,
  MessageSquareQuote,
  MessageSquareReply,
  GitMerge,
  Sparkles,
  FileCode2,
}

/**
 * Resolve the lucide-react component referenced by an expert's `icon`
 * metadata field. Falls back to `Sparkles` when the name is missing or
 * does not match a known icon.
 */
export function getExpertIcon(name: string | null | undefined): LucideIcon {
  return (name && ICON_MAP[name]) || Sparkles
}

/**
 * Resolve a localized string from an expert metadata dictionary.
 *
 * next-intl locales look like `zh_cn`, while the bundled expert metadata
 * uses BCP-47 style keys such as `zh-CN`. Normalize both sides, then fall
 * back to `en`, then to any available entry when the exact locale is
 * missing.
 */
export function pickExpertLocalized(
  dict: Record<string, string> | undefined,
  locale: string
): string {
  if (!dict) return ""
  if (dict[locale]) return dict[locale]
  const normalized = locale.replace("_", "-")
  if (dict[normalized]) return dict[normalized]
  const [lang] = normalized.split("-")
  const match = Object.keys(dict).find(
    (key) => key.toLowerCase().split("-")[0] === lang.toLowerCase()
  )
  if (match) return dict[match]
  return dict.en ?? Object.values(dict)[0] ?? ""
}
