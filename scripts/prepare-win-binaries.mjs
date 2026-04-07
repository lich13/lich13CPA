import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const REPOSITORY = 'router-for-me/CLIProxyAPI'
const RELEASE_API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
const EMBEDDED_ROOT = path.resolve(process.cwd(), 'embedded-binaries')
const WINDOWS_TARGETS = [
  { arch: 'x64', assetSuffix: 'amd64', directory: 'win-x64' },
  { arch: 'arm64', assetSuffix: 'arm64', directory: 'win-arm64' },
]
const STALE_EMBEDDED_FILES = ['cli-proxy-api', 'CLIProxyAPI', 'cli-proxy-api.exe', 'CLIProxyAPI.exe']
const TRANSIENT_FILE_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY'])

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function withTransientFileRetries(action, description, retries = 8) {
  let lastError = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      const errorCode =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : ''

      if (!TRANSIENT_FILE_ERROR_CODES.has(errorCode) || attempt === retries) {
        throw error
      }

      lastError = error
      const delayMs = 250 * (attempt + 1)
      console.warn(
        `[prepare-win-binaries] ${description} busy (${errorCode}), retry ${attempt + 1}/${retries} in ${delayMs}ms`,
      )
      await sleep(delayMs)
    }
  }

  throw lastError
}

async function fetchLatestRelease() {
  const response = await fetch(RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'lich13CPA build',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch latest CLIProxyAPI release: HTTP ${response.status}`)
  }

  return response.json()
}

function findWindowsAsset(release, assetSuffix) {
  const matcher = new RegExp(`_windows_${assetSuffix}\\.zip$`, 'i')
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => typeof item?.name === 'string' && matcher.test(item.name))
    : null

  if (asset) {
    return asset
  }

  const availableAssets = Array.isArray(release.assets)
    ? release.assets
        .map((item) => item?.name)
        .filter((value) => typeof value === 'string')
        .join(', ')
    : 'none'

  throw new Error(`Missing Windows ${assetSuffix} asset in latest release. Available: ${availableAssets}`)
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'lich13CPA build',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  }

  const payload = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(outputPath, payload)
}

async function expandZip(archivePath, outputDirectory) {
  await fs.mkdir(outputDirectory, { recursive: true })
  await execFileAsync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outputDirectory.replace(/'/g, "''")}' -Force`,
    ],
    { windowsHide: true },
  )
}

async function findFileRecursive(rootDirectory, fileName) {
  const queue = [rootDirectory]
  const expectedName = fileName.toLowerCase()

  while (queue.length > 0) {
    const currentDirectory = queue.shift()

    if (!currentDirectory) {
      continue
    }

    const entries = await fs.readdir(currentDirectory, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentDirectory, entry.name)

      if (entry.isDirectory()) {
        queue.push(fullPath)
        continue
      }

      if (entry.isFile() && entry.name.toLowerCase() === expectedName) {
        return fullPath
      }
    }
  }

  throw new Error(`Unable to find ${fileName} under ${rootDirectory}`)
}

async function prepareTargetBinary(release, target, tempRoot) {
  const asset = findWindowsAsset(release, target.assetSuffix)
  const archivePath = path.join(tempRoot, asset.name)
  const extractDirectory = path.join(tempRoot, target.directory)
  const targetDirectory = path.join(EMBEDDED_ROOT, target.directory)
  const targetBinaryPath = path.join(targetDirectory, 'cli-proxy-api.exe')

  console.log(`[prepare-win-binaries] Downloading ${asset.name}`)
  await downloadFile(asset.browser_download_url, archivePath)
  await expandZip(archivePath, extractDirectory)

  const extractedBinaryPath = await findFileRecursive(extractDirectory, 'cli-proxy-api.exe')

  await withTransientFileRetries(
    () => fs.rm(targetDirectory, { recursive: true, force: true }),
    `Removing ${targetDirectory}`,
  )
  await fs.mkdir(targetDirectory, { recursive: true })
  await withTransientFileRetries(
    () => fs.copyFile(extractedBinaryPath, targetBinaryPath),
    `Copying ${targetBinaryPath}`,
  )

  console.log(`[prepare-win-binaries] Prepared ${target.arch}: ${targetBinaryPath}`)
}

async function main() {
  const release = await fetchLatestRelease()
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lich13cpa-win-binaries-'))

  try {
    await fs.mkdir(EMBEDDED_ROOT, { recursive: true })
    await Promise.all(
      STALE_EMBEDDED_FILES.map((fileName) => fs.rm(path.join(EMBEDDED_ROOT, fileName), { force: true })),
    )

    console.log(`[prepare-win-binaries] Latest CLIProxyAPI release: ${release.tag_name}`)

    for (const target of WINDOWS_TARGETS) {
      await prepareTargetBinary(release, target, tempRoot)
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`[prepare-win-binaries] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
