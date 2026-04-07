import { chmod, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const MIN_NODE_MAJOR = 20
const MIN_NODE_MINOR = 19
const MIN_NODE_PATCH = 0

function fail(message) {
  console.error(`[prepare-mac-build] ${message}`)
  process.exit(1)
}

function parseNodeVersion(rawVersion) {
  const normalized = rawVersion.replace(/^v/i, '')
  const [major = '0', minor = '0', patch = '0'] = normalized.split('.')
  return {
    major: Number.parseInt(major, 10) || 0,
    minor: Number.parseInt(minor, 10) || 0,
    patch: Number.parseInt(patch, 10) || 0,
    normalized,
  }
}

function isSupportedNodeVersion(version) {
  if (version.major > 22) {
    return true
  }

  if (version.major === 22) {
    return version.minor >= 12
  }

  if (version.major > MIN_NODE_MAJOR) {
    return true
  }

  if (version.major < MIN_NODE_MAJOR) {
    return false
  }

  if (version.minor > MIN_NODE_MINOR) {
    return true
  }

  if (version.minor < MIN_NODE_MINOR) {
    return false
  }

  return version.patch >= MIN_NODE_PATCH
}

async function readPngDimensions(pngPath) {
  const fileBuffer = await readFile(pngPath)

  if (fileBuffer.length < 24) {
    fail(`图标文件过小，无法读取尺寸: ${pngPath}`)
  }

  const pngSignature = '89504e470d0a1a0a'

  if (fileBuffer.subarray(0, 8).toString('hex') !== pngSignature) {
    fail(`图标文件不是合法 PNG: ${pngPath}`)
  }

  const width = fileBuffer.readUInt32BE(16)
  const height = fileBuffer.readUInt32BE(20)

  return { width, height }
}

function verifyXcodeCommandLineTools() {
  const result = spawnSync('xcode-select', ['-p'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    fail('未检测到 Xcode Command Line Tools，请先执行 `xcode-select --install`。')
  }
}

async function ensureMacBinaryExecutable(binaryPath) {
  await chmod(binaryPath, 0o755)
}

async function main() {
  if (process.platform !== 'darwin') {
    fail('mac 打包必须在 macOS 上执行。')
  }

  if (process.arch !== 'arm64') {
    fail('当前 Node 进程不是 arm64。请在 Apple Silicon 上使用原生 arm64 Node，避免 Rosetta/x64 打出错误架构产物。')
  }

  const nodeVersion = parseNodeVersion(process.version)

  if (!isSupportedNodeVersion(nodeVersion)) {
    fail(`当前 Node 版本 ${process.version} 不满足要求，请使用 Node 20.19+ 或 22.12+。`)
  }

  verifyXcodeCommandLineTools()

  const macBinaryPath = path.join(projectRoot, 'embedded-binaries', 'mac-arm64', 'cli-proxy-api')
  const iconPath = path.join(projectRoot, 'build', 'icon.png')

  try {
    await stat(macBinaryPath)
  } catch {
    fail(`缺少 mac 内嵌二进制: ${macBinaryPath}`)
  }

  try {
    await stat(iconPath)
  } catch {
    fail(`缺少打包图标: ${iconPath}`)
  }

  const { width, height } = await readPngDimensions(iconPath)

  if (width < 512 || height < 512) {
    fail(`build/icon.png 当前为 ${width}x${height}，electron-builder 的 mac 图标至少需要 512x512。`)
  }

  await ensureMacBinaryExecutable(macBinaryPath)

  console.log('[prepare-mac-build] mac 构建环境检查通过。')
  console.log(`[prepare-mac-build] Node ${process.version} / ${process.arch}`)
  console.log(`[prepare-mac-build] icon.png ${width}x${height}`)
}

await main()

