import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type {
  AuthFileQuotaSummary,
  DeleteAiProviderInput,
  DesktopAppState,
  DesktopBridge,
  FetchProviderModelsInput,
  LogEntry,
  ProviderAuthCallbackEvent,
  ProviderAuthLaunchResult,
  ProviderAuthProvider,
  ProviderAuthStatusResult,
  SaveAiProviderInput,
  SaveKnownSettingsInput,
  SaveProviderInput,
  UsageSummary,
  UsageSummaryQuery,
} from '../shared/types'

const STATE_CHANGED_EVENT = 'cliproxy://state-changed'
const LOGS_UPDATED_EVENT = 'cliproxy://logs-updated'
const OAUTH_CALLBACK_EVENT = 'cliproxy://oauth-callback'

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function createUnavailableBridge(): DesktopBridge {
  const unavailable = async <T>(): Promise<T> => {
    throw new Error('未检测到可用的 Tauri 桌面运行时，请通过 Tauri 外壳启动应用。')
  }

  return {
    getAppState: () => unavailable<DesktopAppState>(),
    saveConfigText: () => unavailable<DesktopAppState>(),
    saveKnownSettings: () => unavailable<DesktopAppState>(),
    startProxy: () => unavailable<DesktopAppState>(),
    stopProxy: () => unavailable<DesktopAppState>(),
    syncRuntimeConfig: () => unavailable<DesktopAppState>(),
    refreshUsage: () => unavailable<DesktopAppState>(),
    getUsageSummary: () => unavailable<UsageSummary>(),
    getProviderAuthUrl: () => unavailable<ProviderAuthLaunchResult>(),
    checkProviderAuthStatus: () => unavailable<ProviderAuthStatusResult>(),
    checkProxyBinaryUpdate: () => unavailable<DesktopAppState>(),
    updateProxyBinary: () => unavailable<DesktopAppState>(),
    pickAuthFiles: () => unavailable<DesktopAppState>(),
    deleteAuthFile: () => unavailable<DesktopAppState>(),
    toggleAuthFile: () => unavailable<DesktopAppState>(),
    getAuthFileQuota: () => unavailable<AuthFileQuotaSummary>(),
    saveProvider: () => unavailable<DesktopAppState>(),
    deleteProvider: () => unavailable<DesktopAppState>(),
    saveAiProvider: () => unavailable<DesktopAppState>(),
    deleteAiProvider: () => unavailable<DesktopAppState>(),
    fetchProviderModels: () => unavailable<string[]>(),
    openPath: () => unavailable<void>(),
    openExternal: () => unavailable<void>(),
    clearLogs: () => unavailable<DesktopAppState>(),
    stopProxyAndQuit: () => unavailable<void>(),
    onStateChanged: () => () => undefined,
    onOAuthCallback: () => () => undefined,
    onLogsUpdated: () => () => undefined,
  }
}

function createTauriListener<TPayload>(
  event: string,
  handler: (payload: TPayload) => void,
): () => void {
  let disposed = false
  const unlistenPromise = listen<TPayload>(event, (payload) => {
    if (!disposed) {
      handler(payload.payload)
    }
  }).then((unlisten) => {
    if (disposed) {
      unlisten()
    }

    return unlisten
  })

  return () => {
    disposed = true
    void unlistenPromise.then((unlisten: UnlistenFn) => {
      unlisten()
    })
  }
}

function createTauriBridge(): DesktopBridge {
  return {
    getAppState: () => invoke<DesktopAppState>('get_app_state'),
    saveConfigText: (text: string) => invoke<DesktopAppState>('save_config_text', { text }),
    saveKnownSettings: (input: SaveKnownSettingsInput) =>
      invoke<DesktopAppState>('save_known_settings', { input }),
    startProxy: () => invoke<DesktopAppState>('start_proxy'),
    stopProxy: () => invoke<DesktopAppState>('stop_proxy'),
    syncRuntimeConfig: () => invoke<DesktopAppState>('sync_runtime_config'),
    refreshUsage: () => invoke<DesktopAppState>('refresh_usage'),
    getUsageSummary: (query?: UsageSummaryQuery) =>
      invoke<UsageSummary>('get_usage_summary', { query: query ?? null }),
    getProviderAuthUrl: (provider: ProviderAuthProvider) =>
      invoke<ProviderAuthLaunchResult>('get_provider_auth_url', { provider }),
    checkProviderAuthStatus: (provider: ProviderAuthProvider, state: string) =>
      invoke<ProviderAuthStatusResult>('check_provider_auth_status', { provider, state }),
    checkProxyBinaryUpdate: () => invoke<DesktopAppState>('check_proxy_binary_update'),
    updateProxyBinary: () => invoke<DesktopAppState>('update_proxy_binary'),
    pickAuthFiles: (providerHint?: string) =>
      invoke<DesktopAppState>('pick_auth_files', { providerHint: providerHint ?? null }),
    deleteAuthFile: (name: string) => invoke<DesktopAppState>('delete_auth_file', { name }),
    toggleAuthFile: (name: string) => invoke<DesktopAppState>('toggle_auth_file', { name }),
    getAuthFileQuota: (name: string) => invoke<AuthFileQuotaSummary>('get_auth_file_quota', { name }),
    saveProvider: (input: SaveProviderInput) => invoke<DesktopAppState>('save_provider', { input }),
    deleteProvider: (index: number) => invoke<DesktopAppState>('delete_provider', { index }),
    saveAiProvider: (input: SaveAiProviderInput) =>
      invoke<DesktopAppState>('save_ai_provider', { input }),
    deleteAiProvider: (input: DeleteAiProviderInput) =>
      invoke<DesktopAppState>('delete_ai_provider', { input }),
    fetchProviderModels: (input: FetchProviderModelsInput) =>
      invoke<string[]>('fetch_provider_models', { input }),
    openPath: (targetPath: string) => invoke<void>('open_path', { targetPath }),
    openExternal: (targetUrl: string) => invoke<void>('open_external', { targetUrl }),
    clearLogs: () => invoke<DesktopAppState>('clear_logs'),
    stopProxyAndQuit: () => invoke<void>('stop_proxy_and_quit'),
    onStateChanged: (listener: () => void) =>
      createTauriListener<void>(STATE_CHANGED_EVENT, () => {
        listener()
      }),
    onOAuthCallback: (listener: (payload: ProviderAuthCallbackEvent) => void) =>
      createTauriListener<ProviderAuthCallbackEvent>(OAUTH_CALLBACK_EVENT, (payload) => {
        listener(payload)
      }),
    onLogsUpdated: (listener: (entries: LogEntry[]) => void) =>
      createTauriListener<LogEntry[]>(LOGS_UPDATED_EVENT, (entries) => {
        listener(entries)
      }),
  }
}

export async function ensureDesktopBridge(): Promise<void> {
  if (typeof window === 'undefined' || window.cliproxy) {
    return
  }

  window.cliproxy = isTauriRuntime() ? createTauriBridge() : createUnavailableBridge()
}
