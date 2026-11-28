/**
 * Stable folder color + initial derivation for multi-folder visual identity
 * across tab bar, terminal tab bar, and sidebar conversation cards.
 */

const FOLDER_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-yellow-500",
  "bg-lime-500",
  "bg-green-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-sky-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-purple-500",
  "bg-fuchsia-500",
  "bg-pink-500",
] as const

export function folderBadgeColor(folderId: number): string {
  return FOLDER_COLORS[Math.abs(folderId) % FOLDER_COLORS.length]
}

export function folderBadgeLabel(name: string): string {
  if (!name) return "?"
  const match = name.match(/^(\p{L}|\p{N})/u)
  return (match ? match[1] : name.slice(0, 1)).toUpperCase()
}
