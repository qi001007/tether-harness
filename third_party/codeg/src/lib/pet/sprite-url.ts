import type { PetSpriteAsset } from "./types"

export function createPetSpriteObjectUrl(asset: PetSpriteAsset): string {
  const binary = atob(asset.dataBase64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return URL.createObjectURL(new Blob([bytes], { type: asset.mime }))
}

export function revokePetSpriteObjectUrl(url: string | null | undefined): void {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url)
  }
}
