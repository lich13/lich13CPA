import type { DesktopBridge } from '../shared/types'

declare global {
  interface Window {
    cliproxy: DesktopBridge
  }
}

export {}
