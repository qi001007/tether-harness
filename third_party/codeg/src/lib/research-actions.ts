import {
  FlaskConical,
  Gauge,
  LineChart,
  ScanSearch,
  ScatterChart,
  Search,
  Sigma,
  Sparkles,
  TestTubes,
  type LucideIcon,
} from "lucide-react"

/**
 * A scientific-research skill shortcut for the welcome-page "Scientific
 * Research" tab. Shares the `OfficeAction` shape (id, icon, promptKey, skillId)
 * and the same click behavior: inject a localized prompt template plus the
 * leading `/<skill-id>` badge.
 *
 * `id` doubles as the i18n label key (`<id>`) and description key (`<id>Desc`)
 * under `Folder.chat.welcomePanel.quickActions`; those are authored to match
 * science.toml's display_name/description. `skillId` is the central-store
 * science skill id (also the invocation badge). The set here mirrors the
 * `featured` skills in `src-tauri/science/science.toml` — asserted by
 * research-actions.test.ts.
 */
export interface ResearchAction {
  id: string
  icon: LucideIcon
  /** i18n key under `Folder.chat.welcomePanel.quickActions` for the localized
   *  prompt template injected on click. */
  promptKey: string
  /** Science skill id, used as the leading badge on click. */
  skillId: string
}

/**
 * The nine featured science skills, in display order. The welcome page promotes
 * the first three (brainstorming/hypothesis/design) to colored cards and
 * scrolls the rest.
 */
export const RESEARCH_ACTIONS: ResearchAction[] = [
  {
    id: "scientific-brainstorming",
    icon: Sparkles,
    promptKey: "prompts.scientific-brainstorming",
    skillId: "scientific-brainstorming",
  },
  {
    id: "hypothesis-generation",
    icon: FlaskConical,
    promptKey: "prompts.hypothesis-generation",
    skillId: "hypothesis-generation",
  },
  {
    id: "experimental-design",
    icon: TestTubes,
    promptKey: "prompts.experimental-design",
    skillId: "experimental-design",
  },
  {
    id: "statistical-power",
    icon: Gauge,
    promptKey: "prompts.statistical-power",
    skillId: "statistical-power",
  },
  {
    id: "statistical-analysis",
    icon: Sigma,
    promptKey: "prompts.statistical-analysis",
    skillId: "statistical-analysis",
  },
  {
    id: "exploratory-data-analysis",
    icon: ScatterChart,
    promptKey: "prompts.exploratory-data-analysis",
    skillId: "exploratory-data-analysis",
  },
  {
    id: "scientific-visualization",
    icon: LineChart,
    promptKey: "prompts.scientific-visualization",
    skillId: "scientific-visualization",
  },
  {
    id: "scientific-critical-thinking",
    icon: ScanSearch,
    promptKey: "prompts.scientific-critical-thinking",
    skillId: "scientific-critical-thinking",
  },
  {
    id: "paper-lookup",
    icon: Search,
    promptKey: "prompts.paper-lookup",
    skillId: "paper-lookup",
  },
]

/** Accent palette key for the three promoted research cards (welcome page only).
 *  Values match the `accent` field of these skills in science.toml. */
export const RESEARCH_FEATURED_ACCENTS: Record<string, string> = {
  "scientific-brainstorming": "amber",
  "hypothesis-generation": "violet",
  "experimental-design": "blue",
}
