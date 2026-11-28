"use client"

import {
  ClipboardCheck,
  FlaskConical,
  Gauge,
  GraduationCap,
  LineChart,
  Quote,
  ScanSearch,
  ScatterChart,
  Search,
  Sigma,
  Sparkles,
  TestTubes,
  Workflow,
  type LucideIcon,
} from "lucide-react"

/**
 * Lucide icons referenced by science skill metadata (`ScienceMetadata.icon` is
 * a bare icon name string, authored in science.toml). Shared by the science
 * settings page and the welcome-page "Scientific Research" quick actions so
 * both resolve the same glyphs. Mirrors `expert-presentation.ts`.
 */
export const SCIENCE_ICON_MAP: Record<string, LucideIcon> = {
  Sparkles,
  FlaskConical,
  TestTubes,
  Gauge,
  Sigma,
  ScatterChart,
  LineChart,
  ScanSearch,
  Search,
  ClipboardCheck,
  Quote,
  GraduationCap,
  Workflow,
}

/** Resolve a science skill's icon name to a Lucide component (FlaskConical fallback). */
export function getScienceIcon(name: string | null | undefined): LucideIcon {
  if (name && SCIENCE_ICON_MAP[name]) return SCIENCE_ICON_MAP[name]
  return FlaskConical
}
