import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      stdio: 'inherit',
      shell: false,
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} exited with code ${code ?? 'unknown'}`))
    })
  })
}

async function copyEntry(sourcePath, destinationPath) {
  await cp(sourcePath, destinationPath, {
    recursive: true,
    force: true,
  })
}

async function createZipFromDirectory(directoryPath, zipPath) {
  if (process.platform === 'win32') {
    const psCommand = [
      '-NoProfile',
      '-Command',
      `Compress-Archive -LiteralPath '${directoryPath}' -DestinationPath '${zipPath}' -Force`,
    ]

    await runCommand('powershell', psCommand)
    return
  }

  await runCommand('zip', ['-qry', zipPath, path.basename(directoryPath)], {
    cwd: path.dirname(directoryPath),
  })
}

async function main() {
  const packageJsonPath = path.join(projectRoot, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const version = packageJson.version

  const outputRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(projectRoot, '..', `lich13CPA-${version}-mac-build-minimal`)
  const zipPath = `${outputRoot}.zip`

  const entriesToCopy = [
    '.gitignore',
    'README.md',
    'MAC_BUILD_COMMANDS.txt',
    'eslint.config.js',
    'index.html',
    'package-lock.json',
    'package.json',
    'tsconfig.app.json',
    'tsconfig.electron.json',
    'tsconfig.json',
    'tsconfig.node.json',
    'tsup.config.ts',
    'vite.config.ts',
    'build',
    'electron',
    'public',
    'scripts',
    'shared',
    'src',
  ]

  await rm(outputRoot, { recursive: true, force: true })
  await rm(zipPath, { force: true })
  await mkdir(outputRoot, { recursive: true })

  for (const relativePath of entriesToCopy) {
    const sourcePath = path.join(projectRoot, relativePath)
    const destinationPath = path.join(outputRoot, relativePath)

    await copyEntry(sourcePath, destinationPath)
  }

  const macEmbeddedRoot = path.join(outputRoot, 'embedded-binaries', 'mac-arm64')
  await mkdir(path.join(outputRoot, 'embedded-binaries'), { recursive: true })
  await copyEntry(path.join(projectRoot, 'embedded-binaries', 'mac-arm64'), macEmbeddedRoot)

  const packageNote = [
    'This directory is a macOS Apple Silicon minimal build package.',
    'Only the source, build config, and embedded mac-arm64 cli-proxy-api binary are included.',
    'Use MAC_BUILD_COMMANDS.txt for the exact build commands.',
    '',
  ].join('\n')

  await writeFile(path.join(outputRoot, 'PACKAGE_NOTE.txt'), packageNote, 'utf8')

  await createZipFromDirectory(outputRoot, zipPath)

  console.log(`[create-mac-minimal-package] Created ${outputRoot}`)
  console.log(`[create-mac-minimal-package] Created ${zipPath}`)
}

await main()
