export type AppPage = 'dashboard' | 'providers' | 'auth-files' | 'logs' | 'settings'

export type SidecarChannel = 'main' | 'plus'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface KnownSettings {
  port: number
  useSystemProxy: boolean
  proxyUrl: string
  proxyUsername: string
  proxyPassword: string
  proxyApiKey: string
  managementApiKey: string
  requestRetry: number
  maxRetryInterval: number
  streamKeepaliveSeconds: number
  streamBootstrapRetries: number
  nonStreamKeepaliveIntervalSeconds: number
  sidecarChannel: SidecarChannel
  autoSyncOnStop: boolean
  launchAtLogin: boolean
  autoStartProxyOnLaunch: boolean
  minimizeToTrayOnClose: boolean
  apiBaseUrl: string
  managementBaseUrl: string
}

export interface SaveKnownSettingsInput {
  port: number
  useSystemProxy: boolean
  proxyUrl: string
  proxyUsername: string
  proxyPassword: string
  proxyApiKey: string
  managementApiKey: string
  requestRetry: number
  maxRetryInterval: number
  streamKeepaliveSeconds: number
  streamBootstrapRetries: number
  nonStreamKeepaliveIntervalSeconds: number
  sidecarChannel: SidecarChannel
  autoSyncOnStop: boolean
  launchAtLogin: boolean
  autoStartProxyOnLaunch: boolean
  minimizeToTrayOnClose: boolean
}

export interface ProviderModelMapping {
  alias: string
  name: string
}

export interface ProviderHeaderEntry {
  key: string
  value: string
}

export interface ProviderApiKeyEntry {
  apiKey: string
  proxyUrl: string
  headers: ProviderHeaderEntry[]
}

export interface BaseAiProviderRecord {
  index: number
  apiKey: string
  priority: number | null
  prefix: string
  baseUrl: string
  proxyUrl: string
  headers: ProviderHeaderEntry[]
  models: ProviderModelMapping[]
  excludedModels: string[]
}

export type GeminiProviderRecord = BaseAiProviderRecord

export interface ProviderKeyRecord extends BaseAiProviderRecord {
  websockets: boolean | null
}

export interface OpenAICompatibleProviderRecord {
  index: number
  name: string
  prefix: string
  baseUrl: string
  headers: ProviderHeaderEntry[]
  models: ProviderModelMapping[]
  apiKeyEntries: ProviderApiKeyEntry[]
  priority: number | null
  testModel: string
}

export interface AmpcodeModelMappingRecord {
  from: string
  to: string
}

export interface AmpcodeUpstreamApiKeyMappingRecord {
  upstreamApiKey: string
  apiKeys: string[]
}

export interface AmpcodeConfigRecord {
  upstreamUrl: string
  upstreamApiKey: string
  upstreamApiKeys: AmpcodeUpstreamApiKeyMappingRecord[]
  modelMappings: AmpcodeModelMappingRecord[]
  forceModelMappings: boolean
}

export interface AiProvidersState {
  gemini: GeminiProviderRecord[]
  codex: ProviderKeyRecord[]
  claude: ProviderKeyRecord[]
  vertex: ProviderKeyRecord[]
  openaiCompatibility: OpenAICompatibleProviderRecord[]
  ampcode: AmpcodeConfigRecord | null
}

export type AiProviderKind =
  | 'gemini'
  | 'codex'
  | 'claude'
  | 'vertex'
  | 'openai-compatibility'
  | 'ampcode'

export interface SaveGeminiProviderInput {
  kind: 'gemini'
  index?: number
  apiKey: string
  priority?: number | null
  prefix?: string
  baseUrl?: string
  proxyUrl?: string
  headers?: ProviderHeaderEntry[]
  models?: ProviderModelMapping[]
  excludedModels?: string[]
}

export interface SaveProviderKeyInput {
  kind: 'codex' | 'claude' | 'vertex'
  index?: number
  apiKey: string
  priority?: number | null
  prefix?: string
  baseUrl?: string
  proxyUrl?: string
  headers?: ProviderHeaderEntry[]
  models?: ProviderModelMapping[]
  excludedModels?: string[]
  websockets?: boolean | null
}

export interface SaveOpenAICompatibleProviderInput {
  kind: 'openai-compatibility'
  index?: number
  name: string
  prefix?: string
  baseUrl: string
  headers?: ProviderHeaderEntry[]
  models?: ProviderModelMapping[]
  apiKeyEntries?: ProviderApiKeyEntry[]
  priority?: number | null
  testModel?: string
}

export interface SaveAmpcodeProviderInput {
  kind: 'ampcode'
  config: AmpcodeConfigRecord
}

export type SaveAiProviderInput =
  | SaveGeminiProviderInput
  | SaveProviderKeyInput
  | SaveOpenAICompatibleProviderInput
  | SaveAmpcodeProviderInput

export interface DeleteAiProviderInput {
  kind: AiProviderKind
  index?: number
}

export interface FetchProviderModelsInput {
  apiKey?: string
  baseUrl: string
  headers?: ProviderHeaderEntry[]
}

export interface ProviderRecord {
  index: number
  name: string
  baseUrl: string
  apiKey: string
  models: ProviderModelMapping[]
}

export interface SaveProviderInput {
  index?: number
  name: string
  baseUrl: string
  apiKey: string
  models: ProviderModelMapping[]
}

export interface AuthFileDetailItem {
  label: string
  value: string
}

export interface AuthFileRecord {
  name: string
  displayName: string
  path: string
  provider: string
  type: string
  enabled: boolean
  size: number
  modifiedAt: string
  authIndex: string | null
  label: string | null
  source: string | null
  status: string | null
  statusMessage: string | null
  runtimeOnly: boolean
  unavailable: boolean
  createdAt: string | null
  updatedAt: string | null
  successCount: number
  failureCount: number
  totalRequests: number
  lastUsedAt: string | null
  planType: string | null
  detailItems: AuthFileDetailItem[]
}

export interface AuthFileQuotaItem {
  id: string
  label: string
  remainingPercent: number | null
  amountText: string | null
  resetAt: string | null
  resetText: string | null
}

export interface AuthFileQuotaMeta {
  label: string
  value: string
}

export interface AuthFileQuotaSummary {
  provider: string
  providerLabel: string
  fetchedAt: string
  planType: string | null
  metas: AuthFileQuotaMeta[]
  items: AuthFileQuotaItem[]
 }

export interface ProviderImportSummary {
  id: string
  label: string
  enabledCount: number
  disabledCount: number
  totalCount: number
  lastImportedAt: string | null
}

export type ProviderAuthProvider =
  | 'claude'
  | 'openai'
  | 'codex'
  | 'gemini'
  | 'iflow'
  | 'vertex'
  | 'kiro'
  | 'antigravity'
  | 'copilot'

export interface ProviderAuthLaunchResult {
  provider: ProviderAuthProvider
  label: string
  authUrl: string
  state: string
}

export interface ProviderAuthStatusResult {
  provider: ProviderAuthProvider
  label: string
  state: string
  status: 'wait' | 'ok' | 'error'
  error: string | null
  importedCount?: number
  importedFiles?: string[]
}

export interface ProviderAuthCallbackEvent {
  provider: ProviderAuthProvider
  state: string
  callbackUrl: string
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  source: 'app' | 'proxy'
  message: string
}

export interface UsagePoint {
  label: string
  value: number
}

export type UsageSummaryQueryPreset = '24h' | '7d' | '30d' | 'all' | 'custom'

export interface UsageSummaryQuery {
  preset?: UsageSummaryQueryPreset
  startAt?: string | null
  endAt?: string | null
}

export interface UsageModelSummary {
  model: string
  requests: number
  successCount: number
  failureCount: number
  totalTokens: number
  netTokens: number
  billableInputTokens: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
}

export interface UsageSummary {
  available: boolean
  rangePreset: UsageSummaryQueryPreset
  rangeLabel: string
  rangeStartAt: string | null
  rangeEndAt: string | null
  rangeGranularity: 'hour' | 'day'
  usedDetailRange: boolean
  totalRequests: number
  successCount: number
  failureCount: number
  totalTokens: number
  netTokens: number
  billableInputTokens: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
  requestsByDay: UsagePoint[]
  tokensByDay: UsagePoint[]
  topModels: UsageModelSummary[]
  lastUpdatedAt: string | null
  error: string | null
}

export interface ProxyStatus {
  running: boolean
  pid: number | null
  port: number
  endpoint: string
  webUiUrl: string
  binaryPath: string
  startedAt: string | null
  stoppedAt: string | null
  lastExitCode: number | null
  lastError: string | null
  lastSyncAt: string | null
}

export interface ProxyBinaryState {
  path: string
  currentVersion: string | null
  currentChannel: SidecarChannel | null
  currentBuildAt: string | null
  latestVersion: string | null
  latestTag: string | null
  selectedChannel: SidecarChannel
  updateAvailable: boolean | null
  lastCheckedAt: string | null
  lastUpdatedAt: string | null
  lastError: string | null
}

export interface AppUpdateState {
  currentVersion: string
  latestVersion: string | null
  latestTag: string | null
  latestAssetName: string | null
  updateAvailable: boolean | null
  lastCheckedAt: string | null
  lastDownloadedAt: string | null
  lastError: string | null
}

export interface AppPaths {
  baseDir: string
  configPath: string
  guiStatePath: string
  authDir: string
  logsDir: string
  binaryCandidates: string[]
  effectiveBinaryPath: string
}

export interface DesktopAppState {
  paths: AppPaths
  proxyStatus: ProxyStatus
  proxyBinary: ProxyBinaryState
  appUpdate: AppUpdateState
  knownSettings: KnownSettings
  configText: string
  configMtimeMs: number
  configParseError: string | null
  providers: ProviderRecord[]
  aiProviders: AiProvidersState
  authFiles: AuthFileRecord[]
  providerImports: ProviderImportSummary[]
  logs: LogEntry[]
  warnings: string[]
}

export interface DesktopBridge {
  getAppState: () => Promise<DesktopAppState>
  saveConfigText: (text: string) => Promise<DesktopAppState>
  saveKnownSettings: (input: SaveKnownSettingsInput) => Promise<DesktopAppState>
  startProxy: () => Promise<DesktopAppState>
  stopProxy: () => Promise<DesktopAppState>
  syncRuntimeConfig: () => Promise<DesktopAppState>
  getProviderAuthUrl: (provider: ProviderAuthProvider) => Promise<ProviderAuthLaunchResult>
  checkProviderAuthStatus: (
    provider: ProviderAuthProvider,
    state: string,
  ) => Promise<ProviderAuthStatusResult>
  checkProxyBinaryUpdate: () => Promise<DesktopAppState>
  updateProxyBinary: () => Promise<DesktopAppState>
  checkAppUpdate: () => Promise<DesktopAppState>
  updateApp: () => Promise<DesktopAppState>
  pickAuthFiles: (providerHint?: string) => Promise<DesktopAppState>
  deleteAuthFile: (name: string) => Promise<DesktopAppState>
  toggleAuthFile: (name: string) => Promise<DesktopAppState>
  getAuthFileQuota: (name: string) => Promise<AuthFileQuotaSummary>
  saveProvider: (input: SaveProviderInput) => Promise<DesktopAppState>
  deleteProvider: (index: number) => Promise<DesktopAppState>
  saveAiProvider: (input: SaveAiProviderInput) => Promise<DesktopAppState>
  deleteAiProvider: (input: DeleteAiProviderInput) => Promise<DesktopAppState>
  fetchProviderModels: (input: FetchProviderModelsInput) => Promise<string[]>
  openPath: (targetPath: string) => Promise<void>
  openExternal: (targetUrl: string) => Promise<void>
  clearLogs: () => Promise<DesktopAppState>
  stopProxyAndQuit: () => Promise<void>
  onStateChanged: (listener: () => void) => () => void
  onOAuthCallback: (listener: (payload: ProviderAuthCallbackEvent) => void) => () => void
  onLogsUpdated: (listener: (entries: LogEntry[]) => void) => () => void
}
