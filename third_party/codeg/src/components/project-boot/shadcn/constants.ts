// ── Preset encoding/decoding (matches shadcn v2 format) ─────────────

const PRESET_STYLES = ["nova", "vega", "maia", "lyra", "mira"] as const

const PRESET_BASE_COLORS = [
  "neutral",
  "stone",
  "zinc",
  "gray",
  "mauve",
  "olive",
  "mist",
  "taupe",
] as const

const PRESET_THEMES = [
  "neutral",
  "stone",
  "zinc",
  "gray",
  "amber",
  "blue",
  "cyan",
  "emerald",
  "fuchsia",
  "green",
  "indigo",
  "lime",
  "orange",
  "pink",
  "purple",
  "red",
  "rose",
  "sky",
  "teal",
  "violet",
  "yellow",
  "mauve",
  "olive",
  "mist",
  "taupe",
] as const

const PRESET_ICON_LIBRARIES = [
  "lucide",
  "hugeicons",
  "tabler",
  "phosphor",
  "remixicon",
] as const

const PRESET_FONTS = [
  "inter",
  "noto-sans",
  "nunito-sans",
  "figtree",
  "roboto",
  "raleway",
  "dm-sans",
  "public-sans",
  "outfit",
  "jetbrains-mono",
  "geist",
  "geist-mono",
  "lora",
  "merriweather",
  "playfair-display",
  "noto-serif",
  "roboto-slab",
  "oxanium",
  "manrope",
  "space-grotesk",
  "montserrat",
  "ibm-plex-sans",
  "source-sans-3",
  "instrument-sans",
] as const

const PRESET_FONT_HEADINGS = ["inherit", ...PRESET_FONTS] as const

const PRESET_RADII = ["default", "none", "small", "medium", "large"] as const

const PRESET_MENU_ACCENTS = ["subtle", "bold"] as const

const PRESET_MENU_COLORS = [
  "default",
  "inverted",
  "default-translucent",
  "inverted-translucent",
] as const

/** V2 field layout for bit-packing (order must match shadcn exactly) */
const PRESET_FIELDS_V2 = [
  { key: "menuColor", values: PRESET_MENU_COLORS, bits: 3 },
  { key: "menuAccent", values: PRESET_MENU_ACCENTS, bits: 3 },
  { key: "radius", values: PRESET_RADII, bits: 4 },
  { key: "font", values: PRESET_FONTS, bits: 6 },
  { key: "iconLibrary", values: PRESET_ICON_LIBRARIES, bits: 6 },
  { key: "theme", values: PRESET_THEMES, bits: 6 },
  { key: "baseColor", values: PRESET_BASE_COLORS, bits: 6 },
  { key: "style", values: PRESET_STYLES, bits: 6 },
  { key: "chartColor", values: PRESET_THEMES, bits: 6 },
  { key: "fontHeading", values: PRESET_FONT_HEADINGS, bits: 5 },
] as const

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

function toBase62(num: number): string {
  if (num === 0) return "0"
  let result = ""
  let n = num
  while (n > 0) {
    result = BASE62[n % 62] + result
    n = Math.floor(n / 62)
  }
  return result
}

/** Encode a preset config into a compact base62 code (v2 format). */
export function encodePreset(config: PresetCodeConfig): string {
  const defaults: Record<string, string> = {
    menuColor: "default",
    menuAccent: "subtle",
    radius: "default",
    font: "inter",
    iconLibrary: "lucide",
    theme: "neutral",
    baseColor: "neutral",
    style: "nova",
    chartColor: config.theme ?? "neutral",
    fontHeading: "inherit",
  }
  const merged: Record<string, string> = { ...defaults }
  for (const [k, v] of Object.entries(config)) {
    if (v) merged[k] = v
  }
  let bits = 0
  let offset = 0
  for (const field of PRESET_FIELDS_V2) {
    const idx = (field.values as readonly string[]).indexOf(
      merged[field.key] ?? ""
    )
    bits += (idx === -1 ? 0 : idx) * 2 ** offset
    offset += field.bits
  }
  return "b" + toBase62(bits)
}

// ── Config types ────────────────────────────────────────────────────

/** Fields that are encoded into the preset code (sent to CLI & preview). */
export interface PresetCodeConfig {
  style: string
  baseColor: string
  theme: string
  chartColor: string
  iconLibrary: string
  font: string
  fontHeading: string
  radius: string
  menuAccent: string
  menuColor: string
}

/** Full UI config (preset fields + non-preset fields like base/template). */
export interface ShadcnPresetConfig extends PresetCodeConfig {
  base: string
  template: string
}

export const DEFAULT_PRESET_CONFIG: ShadcnPresetConfig = {
  base: "radix",
  style: "nova",
  baseColor: "neutral",
  theme: "orange",
  chartColor: "orange",
  iconLibrary: "lucide",
  font: "inter",
  fontHeading: "inherit",
  radius: "default",
  menuAccent: "subtle",
  menuColor: "default",
  template: "start",
}

// ── UI option arrays ────────────────────────────────────────────────

export const BASE_OPTIONS = [
  { value: "radix", label: "Radix" },
  { value: "base", label: "Base" },
]

export const STYLE_OPTIONS = PRESET_STYLES.map((v) => ({
  value: v,
  label: v.charAt(0).toUpperCase() + v.slice(1),
}))

export const BASE_COLOR_OPTIONS = PRESET_BASE_COLORS.map((v) => ({
  value: v,
  label: v.charAt(0).toUpperCase() + v.slice(1),
}))

export const THEME_OPTIONS = PRESET_THEMES.map((v) => ({
  value: v,
  label: v.charAt(0).toUpperCase() + v.slice(1),
}))

export const ICON_LIBRARY_OPTIONS = PRESET_ICON_LIBRARIES.map((v) => ({
  value: v,
  label: v.charAt(0).toUpperCase() + v.slice(1),
}))

export const FONT_OPTIONS = PRESET_FONTS.map((v) => ({
  value: v,
  label: v
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" "),
}))

export const FONT_HEADING_OPTIONS = PRESET_FONT_HEADINGS.map((v) => ({
  value: v,
  label:
    v === "inherit"
      ? "Inherit"
      : v
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
}))

export const MENU_ACCENT_OPTIONS = PRESET_MENU_ACCENTS.map((v) => ({
  value: v,
  label: v.charAt(0).toUpperCase() + v.slice(1),
}))

export const MENU_COLOR_OPTIONS = PRESET_MENU_COLORS.map((v) => ({
  value: v,
  label: v
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" "),
}))

export const RADIUS_OPTIONS = PRESET_RADII.map((v) => ({
  value: v,
  label: v.charAt(0).toUpperCase() + v.slice(1),
}))

export const TEMPLATE_OPTIONS = [{ value: "start", label: "Start" }]

export const FRAMEWORK_OPTIONS = [
  { value: "next", label: "Next.js" },
  { value: "vite", label: "Vite" },
  { value: "start", label: "TanStack Start" },
  { value: "react-router", label: "React Router" },
  { value: "laravel", label: "Laravel" },
  { value: "astro", label: "Astro" },
]

export const PACKAGE_MANAGER_OPTIONS = [
  { value: "pnpm", label: "pnpm" },
  { value: "npm", label: "npm" },
  { value: "yarn", label: "yarn" },
  { value: "bun", label: "bun" },
]

// ── URL builders ────────────────────────────────────────────────────

/** Build the preview iframe URL using a preset code. */
export function buildPreviewUrl(_base: string, presetCode: string): string {
  return `https://ui.shadcn.com/preview/radix/preview-02?preset=${presetCode}`
}
