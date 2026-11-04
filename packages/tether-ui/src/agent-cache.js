const catalogs = new Map()
const harnesses = new Map()

export function readCatalog(device) {
  return device ? (catalogs.get(device) || null) : null
}

export function writeCatalog(device, data) {
  if (device && data) catalogs.set(device, data)
}

export function readHarnesses(device) {
  return device ? (harnesses.get(device) || null) : null
}

export function writeHarnesses(device, data) {
  if (device && Array.isArray(data)) harnesses.set(device, data)
}
