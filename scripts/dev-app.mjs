import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const devServerUrl = 'http://127.0.0.1:5173'
const electronBin = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron',
)
const requiredFiles = [
  path.join(projectRoot, 'dist-electron', 'main.cjs'),
  path.join(projectRoot, 'dist-electron', 'preload.cjs'),
]

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForFile(filePath) {
  for (;;) {
    try {
      await access(filePath)
      return
    } catch {
      await delay(200)
    }
  }
}

async function waitForPort(port, host) {
  for (;;) {
    const ready = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port })
      socket.once('connect', () => {
        socket.end()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
    })

    if (ready) {
      return
    }

    await delay(200)
  }
}

await Promise.all(requiredFiles.map((filePath) => waitForFile(filePath)))
await waitForPort(5173, '127.0.0.1')

const child =
  process.platform === 'win32'
    ? spawn('cmd.exe', ['/c', electronBin, '.'], {
        cwd: projectRoot,
        env: {
          ...process.env,
          CLIPROXY_DEV_SERVER_URL: devServerUrl,
        },
        stdio: 'inherit',
        windowsHide: false,
      })
    : spawn(electronBin, ['.'], {
        cwd: projectRoot,
        env: {
          ...process.env,
          CLIPROXY_DEV_SERVER_URL: devServerUrl,
        },
        stdio: 'inherit',
        windowsHide: false,
      })

child.once('exit', (code) => {
  process.exit(code ?? 0)
})
