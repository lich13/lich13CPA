import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function normalizeChannel(value) {
  return String(value || 'main').trim().toLowerCase() === 'plus' ? 'plus' : 'main'
}

const CHANNEL = normalizeChannel(process.env.CLIPROXYAPI_CHANNEL)
const REPOSITORY = CHANNEL === 'plus' ? 'router-for-me/CLIProxyAPIPlus' : 'router-for-me/CLIProxyAPI'
const ASSET_PREFIX = CHANNEL === 'plus' ? 'CLIProxyAPIPlus' : 'CLIProxyAPI'
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
const LATEST_RELEASE_URL = `https://github.com/${REPOSITORY}/releases/latest`
const RESOURCE_BIN_DIR = path.resolve(process.cwd(), 'src-tauri/resources/bin')

const TARGETS = {
  'aarch64-apple-darwin': {
    platform: 'darwin',
    assetSuffix: 'arm64',
    archiveKind: 'tar.gz',
    outputName: 'cli-proxy-api',
    binaryNames: [
      'cli-proxy-api',
      'cli-proxy-api-aarch64-apple-darwin',
      'cliproxyapi-aarch64-apple-darwin',
      'cli-proxy-api-x86_64-apple-darwin',
      'cliproxyapi-x86_64-apple-darwin',
      'CLIProxyAPI',
      'cli-proxy-api-plus',
      'CLIProxyAPIPlus',
    ],
  },
  'x86_64-apple-darwin': {
    platform: 'darwin',
    assetSuffix: 'amd64',
    archiveKind: 'tar.gz',
    outputName: 'cli-proxy-api',
    binaryNames: [
      'cli-proxy-api',
      'cli-proxy-api-x86_64-apple-darwin',
      'cliproxyapi-x86_64-apple-darwin',
      'cli-proxy-api-aarch64-apple-darwin',
      'cliproxyapi-aarch64-apple-darwin',
      'CLIProxyAPI',
      'cli-proxy-api-plus',
      'CLIProxyAPIPlus',
    ],
  },
  'x86_64-pc-windows-msvc': {
    platform: 'windows',
    assetSuffix: 'amd64',
    archiveKind: 'zip',
    outputName: 'cli-proxy-api.exe',
    binaryNames: [
      'cli-proxy-api.exe',
      'cli-proxy-api-x86_64-pc-windows-msvc.exe',
      'cli-proxy-api-aarch64-pc-windows-msvc.exe',
      'CLIProxyAPI.exe',
      'cli-proxy-api-plus.exe',
      'CLIProxyAPIPlus.exe',
    ],
  },
  'aarch64-pc-windows-msvc': {
    platform: 'windows',
    assetSuffix: 'arm64',
    archiveKind: 'zip',
    outputName: 'cli-proxy-api.exe',
    binaryNames: [
      'cli-proxy-api.exe',
      'cli-proxy-api-aarch64-pc-windows-msvc.exe',
      'cli-proxy-api-x86_64-pc-windows-msvc.exe',
      'CLIProxyAPI.exe',
      'cli-proxy-api-plus.exe',
      'CLIProxyAPIPlus.exe',
    ],
  },
}

function parseArgs(argv) {
  const options = {
    target: null,
    tag: process.env.CLIPROXYAPI_TAG?.trim() || null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]

    if (current === '--target') {
      options.target = argv[index + 1] ?? null
      index += 1
      continue
    }

    if (current === '--tag') {
      options.tag = argv[index + 1] ?? null
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${current}`)
  }

  return options
}

function detectHostTarget() {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 'aarch64-apple-darwin'
  }

  if (process.platform === 'darwin' && process.arch === 'x64') {
    return 'x86_64-apple-darwin'
  }

  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'x86_64-pc-windows-msvc'
  }

  if (process.platform === 'win32' && process.arch === 'arm64') {
    return 'aarch64-pc-windows-msvc'
  }

  throw new Error(`Unsupported host target: ${process.platform}/${process.arch}`)
}

function normalizeTag(tag) {
  if (!tag) {
    throw new Error('Missing release tag')
  }

  return tag.startsWith('v') ? tag : `v${tag}`
}

function buildAssetName(target, version) {
  if (target.platform === 'windows') {
    return `${ASSET_PREFIX}_${version}_windows_${target.assetSuffix}.zip`
  }

  return `${ASSET_PREFIX}_${version}_darwin_${target.assetSuffix}.tar.gz`
}

function buildReleaseDescriptor(targetTriple, tag) {
  const target = TARGETS[targetTriple]

  if (!target) {
    throw new Error(`Unsupported Rust target: ${targetTriple}`)
  }

  const normalizedTag = normalizeTag(tag)
  const version = normalizedTag.replace(/^v/i, '')
  const assetName = buildAssetName(target, version)

  return {
    ...target,
    targetTriple,
    tag: normalizedTag,
    version,
    assetName,
    downloadUrl: `https://github.com/${REPOSITORY}/releases/download/${normalizedTag}/${assetName}`,
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'lich13CPA build',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

function extractReleaseTagFromUrl(input) {
  const match = input.match(/\/releases\/tag\/([^/?#]+)/i)
  return match?.[1] ?? null
}

async function fetchLatestReleaseTagFromRedirect() {
  const requestInit = {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'lich13CPA build',
    },
  }

  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      ...requestInit,
      method: 'HEAD',
      redirect: 'manual',
    })
    const resolved =
      extractReleaseTagFromUrl(response.headers.get('location') ?? '') ??
      extractReleaseTagFromUrl(response.url)

    if (resolved) {
      return resolved
    }
  } catch {
    // Fall through to GET fallback.
  }

  const response = await fetch(LATEST_RELEASE_URL, {
    ...requestInit,
    method: 'GET',
    redirect: 'follow',
  })
  const resolved =
    extractReleaseTagFromUrl(response.url) ??
    extractReleaseTagFromUrl(response.headers.get('location') ?? '')

  if (!resolved) {
    throw new Error('Unable to resolve latest CLIProxyAPI release tag')
  }

  return resolved
}

async function resolveReleaseDescriptor(targetTriple, preferredTag) {
  if (preferredTag) {
    return buildReleaseDescriptor(targetTriple, preferredTag)
  }

  try {
    const payload = await fetchJson(LATEST_RELEASE_API_URL)
    const descriptor = buildReleaseDescriptor(targetTriple, payload.tag_name)
    const asset = Array.isArray(payload.assets)
      ? payload.assets.find((item) => item?.name === descriptor.assetName)
      : null

    if (asset?.browser_download_url) {
      descriptor.downloadUrl = asset.browser_download_url
    }

    return descriptor
  } catch (error) {
    const fallbackTag = await fetchLatestReleaseTagFromRedirect().catch((redirectError) => {
      throw new Error(
        `Failed to resolve latest CLIProxyAPI release (${error instanceof Error ? error.message : String(error)}; redirect fallback: ${
          redirectError instanceof Error ? redirectError.message : String(redirectError)
        })`,
      )
    })

    return buildReleaseDescriptor(targetTriple, fallbackTag)
  }
}

async function downloadFile(url, outputPath) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'lich13CPA build',
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const payload = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(outputPath, payload)
    return
  } catch (fetchError) {
    await execFileAsync(
      'curl',
      [
        '-fL',
        '--retry',
        '3',
        '--retry-delay',
        '1',
        '-H',
        'Accept: application/octet-stream',
        '-H',
        'User-Agent: lich13CPA build',
        '-o',
        outputPath,
        url,
      ],
      {
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
    ).catch((curlError) => {
      throw new Error(
        `Failed to download ${url} (fetch: ${
          fetchError instanceof Error ? fetchError.message : String(fetchError)
        }; curl: ${curlError instanceof Error ? curlError.message : String(curlError)})`,
      )
    })
  }
}

async function extractArchive(archivePath, destinationPath, archiveKind) {
  await fs.mkdir(destinationPath, { recursive: true })

  if (archiveKind === 'zip') {
    if (process.platform === 'win32') {
      await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationPath.replace(/'/g, "''")}' -Force`,
        ],
        { windowsHide: true },
      )
      return
    }

    await execFileAsync('unzip', ['-oq', archivePath, '-d', destinationPath], {
      windowsHide: true,
    })
    return
  }

  await execFileAsync('tar', ['-xzf', archivePath, '-C', destinationPath], {
    windowsHide: true,
  })
}

async function findFileRecursive(rootDirectory, fileNames) {
  const wantedNames = new Set(fileNames.map((name) => name.toLowerCase()))
  const queue = [rootDirectory]

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

      if (entry.isFile() && wantedNames.has(entry.name.toLowerCase())) {
        return fullPath
      }
    }
  }

  throw new Error(`Unable to find extracted binary under ${rootDirectory}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const targetTriple = options.target || detectHostTarget()
  const descriptor = await resolveReleaseDescriptor(targetTriple, options.tag)
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lich13cpa-tauri-binary-'))

  try {
    const archivePath = path.join(tempRoot, descriptor.assetName)
    const extractDirectory = path.join(tempRoot, 'extract')
    const outputPath = path.join(RESOURCE_BIN_DIR, descriptor.outputName)

    console.log(
      `[prepare-tauri-bundled-binary] Target ${descriptor.targetTriple} -> ${descriptor.assetName} (${descriptor.tag})`,
    )

    await downloadFile(descriptor.downloadUrl, archivePath)
    await extractArchive(archivePath, extractDirectory, descriptor.archiveKind)

    const extractedBinaryPath = await findFileRecursive(extractDirectory, descriptor.binaryNames)

    await fs.rm(RESOURCE_BIN_DIR, { recursive: true, force: true })
    await fs.mkdir(RESOURCE_BIN_DIR, { recursive: true })
    await fs.copyFile(extractedBinaryPath, outputPath)

    if (descriptor.platform !== 'windows') {
      await fs.chmod(outputPath, 0o755)
    }

    console.log(`[prepare-tauri-bundled-binary] Prepared ${outputPath}`)
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(
    `[prepare-tauri-bundled-binary] ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})
