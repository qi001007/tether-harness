import {
  BarChart3,
  Box,
  Clapperboard,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Presentation,
  Rocket,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"

/**
 * A daily-office (officecli) skill shortcut. Shared by the welcome-page quick
 * actions and the composer "+" menu so both resolve the same glyphs, labels,
 * and prompt templates.
 */
export interface OfficeAction {
  /** Stable id; also the i18n label key (`<id>`) and description (`<id>Desc`)
   *  under `Folder.chat.welcomePanel.quickActions`. */
  id: string
  icon: LucideIcon
  /** i18n key under `Folder.chat.welcomePanel.quickActions` for the localized
   *  prompt template injected on click. */
  promptKey: string
  /** OfficeCLI skill invocation id, used as the leading badge on click. */
  skillId: string
}

/**
 * Every office skill, in display order. The welcome page promotes the first
 * three (excel/word/ppt) to colored cards and scrolls the rest; the composer
 * "+" menu lists them all in one submenu.
 */
export const OFFICE_ACTIONS: OfficeAction[] = [
  {
    id: "excel",
    icon: FileSpreadsheet,
    promptKey: "prompts.excel",
    skillId: "officecli-xlsx",
  },
  {
    id: "word",
    icon: FileText,
    promptKey: "prompts.word",
    skillId: "officecli-docx",
  },
  {
    id: "ppt",
    icon: Presentation,
    promptKey: "prompts.ppt",
    skillId: "officecli-pptx",
  },
  {
    id: "pitchDeck",
    icon: Rocket,
    promptKey: "prompts.pitchDeck",
    skillId: "officecli-pitch-deck",
  },
  {
    id: "morph",
    icon: Clapperboard,
    promptKey: "prompts.morph",
    skillId: "morph-ppt",
  },
  {
    id: "morph3d",
    icon: Box,
    promptKey: "prompts.morph3d",
    skillId: "morph-ppt-3d",
  },
  {
    id: "academic",
    icon: GraduationCap,
    promptKey: "prompts.academic",
    skillId: "officecli-academic-paper",
  },
  {
    id: "financial",
    icon: TrendingUp,
    promptKey: "prompts.financial",
    skillId: "officecli-financial-model",
  },
  {
    id: "dashboard",
    icon: BarChart3,
    promptKey: "prompts.dashboard",
    skillId: "officecli-data-dashboard",
  },
]

/** Accent palette key for the three promoted office cards (welcome page only). */
export const OFFICE_FEATURED_ACCENTS: Record<string, string> = {
  excel: "green",
  word: "blue",
  ppt: "orange",
}
