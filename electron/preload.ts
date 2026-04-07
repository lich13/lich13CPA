import { contextBridge, ipcRenderer } from 'electron'

import type {
  DeleteAiProviderInput,
  DesktopBridge,
  LogEntry,
  ProviderAuthProvider,
  SaveAiProviderInput,
  SaveKnownSettingsInput,
  SaveProviderInput,
} from '../shared/types'

const api: DesktopBridge = {
  getAppState: () => ipcRenderer.invoke('cliproxy:getAppState'),
  saveConfigText: (text: string) => ipcRenderer.invoke('cliproxy:saveConfigText', text),
  saveKnownSettings: (input: SaveKnownSettingsInput) =>
    ipcRenderer.invoke('cliproxy:saveKnownSettings', input),
  startProxy: () => ipcRenderer.invoke('cliproxy:startProxy'),
  stopProxy: () => ipcRenderer.invoke('cliproxy:stopProxy'),
  syncRuntimeConfig: () => ipcRenderer.invoke('cliproxy:syncRuntimeConfig'),
  refreshUsage: () => ipcRenderer.invoke('cliproxy:refreshUsage'),
  getUsageSummary: (query) => ipcRenderer.invoke('cliproxy:getUsageSummary', query),
  getProviderAuthUrl: (provider: ProviderAuthProvider) =>
    ipcRenderer.invoke('cliproxy:getProviderAuthUrl', provider),
  checkProviderAuthStatus: (provider: ProviderAuthProvider, state: string) =>
    ipcRenderer.invoke('cliproxy:checkProviderAuthStatus', provider, state),
  checkProxyBinaryUpdate: () => ipcRenderer.invoke('cliproxy:checkProxyBinaryUpdate'),
  updateProxyBinary: () => ipcRenderer.invoke('cliproxy:updateProxyBinary'),
  pickAuthFiles: (providerHint?: string) =>
    ipcRenderer.invoke('cliproxy:pickAuthFiles', providerHint),
  deleteAuthFile: (name: string) => ipcRenderer.invoke('cliproxy:deleteAuthFile', name),
  toggleAuthFile: (name: string) => ipcRenderer.invoke('cliproxy:toggleAuthFile', name),
  getAuthFileQuota: (name: string) => ipcRenderer.invoke('cliproxy:getAuthFileQuota', name),
  saveProvider: (input: SaveProviderInput) =>
    ipcRenderer.invoke('cliproxy:saveProvider', input),
  deleteProvider: (index: number) => ipcRenderer.invoke('cliproxy:deleteProvider', index),
  saveAiProvider: (input: SaveAiProviderInput) =>
    ipcRenderer.invoke('cliproxy:saveAiProvider', input),
  deleteAiProvider: (input: DeleteAiProviderInput) =>
    ipcRenderer.invoke('cliproxy:deleteAiProvider', input),
  openPath: (targetPath: string) => ipcRenderer.invoke('cliproxy:openPath', targetPath),
  openExternal: (targetUrl: string) => ipcRenderer.invoke('cliproxy:openExternal', targetUrl),
  clearLogs: () => ipcRenderer.invoke('cliproxy:clearLogs'),
  onStateChanged: (listener: () => void) => {
    const wrapped = () => listener()
    ipcRenderer.on('cliproxy:state-changed', wrapped)
    return () => {
      ipcRenderer.removeListener('cliproxy:state-changed', wrapped)
    }
  },
  onLogsUpdated: (listener: (entries: LogEntry[]) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, entries: LogEntry[]) => {
      listener(entries)
    }
    ipcRenderer.on('cliproxy:logs-updated', wrapped)
    return () => {
      ipcRenderer.removeListener('cliproxy:logs-updated', wrapped)
    }
  },
}

contextBridge.exposeInMainWorld('cliproxy', api)
