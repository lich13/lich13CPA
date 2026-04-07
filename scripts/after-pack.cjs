const fs = require('node:fs/promises')
const path = require('node:path')

const WINDOWS_EMBEDDED_SUBDIR_BY_ARCH = {
  x64: 'win-x64',
  arm64: 'win-arm64',
}

const WINDOWS_LOCALES_TO_KEEP = new Set(['en-US.pak', 'zh-CN.pak'])

function normalizeArch(arch) {
  const normalized = String(arch).toLowerCase()

  if (normalized === '1' || normalized === 'x64') {
    return 'x64'
  }

  if (normalized === '2' || normalized === '3' || normalized === 'arm64') {
    return 'arm64'
  }

  return normalized
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function pruneWindowsEmbeddedBinaries(resourcesDir, arch) {
  const embeddedRoot = path.join(resourcesDir, 'embedded-binaries')

  if (!(await pathExists(embeddedRoot))) {
    return
  }

  const allowedSubdirectory = WINDOWS_EMBEDDED_SUBDIR_BY_ARCH[arch]

  if (!allowedSubdirectory) {
    console.warn(`[after-pack] Skip embedded-binaries prune for unsupported arch: ${arch}`)
    return
  }

  const entries = await fs.readdir(embeddedRoot, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(embeddedRoot, entry.name)
    const shouldKeep = entry.isDirectory() && entry.name === allowedSubdirectory

    if (!shouldKeep) {
      await fs.rm(entryPath, { recursive: true, force: true })
    }
  }
}

async function pruneWindowsLocales(appOutDir) {
  const localesDir = path.join(appOutDir, 'locales')

  if (!(await pathExists(localesDir))) {
    return
  }

  const entries = await fs.readdir(localesDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }

    if (WINDOWS_LOCALES_TO_KEEP.has(entry.name)) {
      continue
    }

    await fs.rm(path.join(localesDir, entry.name), { force: true })
  }
}

module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName || context.packager?.platform?.nodeName

  if (platform !== 'win32') {
    return
  }

  const arch = normalizeArch(context.arch)
  const appOutDir = context.appOutDir

  if (!appOutDir) {
    return
  }

  const resourcesDir = path.join(appOutDir, 'resources')

  await pruneWindowsEmbeddedBinaries(resourcesDir, arch)
  await pruneWindowsLocales(appOutDir)
}
