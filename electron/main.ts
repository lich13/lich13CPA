import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  type OpenDialogOptions,
} from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import {
  execFile,
  spawn,
  type ChildProcessByStdio,
} from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { parse, stringify } from 'yaml'

import type {
  AiProvidersState,
  AmpcodeConfigRecord,
  AmpcodeModelMappingRecord,
  AmpcodeUpstreamApiKeyMappingRecord,
  AppPaths,
  AuthFileDetailItem,
  AuthFileQuotaItem,
  AuthFileRecord,
  AuthFileQuotaSummary,
  DeleteAiProviderInput,
  DesktopAppState,
  OpenAICompatibleProviderRecord,
  ProviderApiKeyEntry,
  KnownSettings,
  LogEntry,
  LogLevel,
  ProxyBinaryState,
  ProviderAuthLaunchResult,
  ProviderAuthProvider,
  ProviderAuthStatusResult,
  ProviderHeaderEntry,
  ProviderKeyRecord,
  ProviderModelMapping,
  ProviderImportSummary,
  ProviderRecord,
  ProxyStatus,
  ReasoningEffort,
  SaveAiProviderInput,
  SaveKnownSettingsInput,
  SaveProviderInput,
  ThinkingBudgetMode,
  UsageModelSummary,
  UsagePoint,
  UsageSummary,
  UsageSummaryQuery,
  UsageSummaryQueryPreset,
} from '../shared/types'

const execFileAsync = promisify(execFile)

const APP_PRODUCT_NAME = 'lich13CPA'
const DEFAULT_PORT = 8313
const DEFAULT_PROXY_API_KEY = 'cliproxy-local'
const DEFAULT_MANAGEMENT_API_KEY = 'cliproxy-management'
const DEFAULT_THINKING_CUSTOM = 16000
const DEFAULT_REQUEST_RETRY = 5
const DEFAULT_MAX_RETRY_INTERVAL = 3
const DEFAULT_STREAM_KEEPALIVE_SECONDS = 20
const DEFAULT_STREAM_BOOTSTRAP_RETRIES = 2
const DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS = 15
const LEGACY_DEFAULT_LOGS_MAX_TOTAL_SIZE_MB = 256
const DEFAULT_LOGS_MAX_TOTAL_SIZE_MB = 100
const AUTH_DIRECTORY_NAME = 'auth-files'
const DESKTOP_METADATA_KEY = 'x-cliproxy-desktop'
const STATE_CHANGED_EVENT = 'cliproxy:state-changed'
const LOGS_UPDATED_EVENT = 'cliproxy:logs-updated'
const MAIN_LOG_NAME = 'main.log'
const USAGE_STATS_FILE_NAME = 'usage-stats.json'
const USAGE_LOG_WATCH_GLOB = 'v1-*.log'
const MIN_USAGE_LOG_FILE_AGE_MS = 1500
const MAX_USAGE_PROCESSED_FILE_IDS = 6000
const MAX_LOG_ENTRIES = 600
const CLIPROXY_REPOSITORY = 'router-for-me/CLIProxyAPI'
const CLIPROXY_RELEASES_LATEST_URL = `https://github.com/${CLIPROXY_REPOSITORY}/releases/latest`
const CLIPROXY_RELEASES_LATEST_API_URL = `https://api.github.com/repos/${CLIPROXY_REPOSITORY}/releases/latest`
const DEFAULT_ANTIGRAVITY_PROJECT_ID = 'bamboo-precept-lgxtn'
const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
  'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
] as const
const ANTIGRAVITY_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'antigravity/1.11.5 windows/amd64',
} as const
const ANTIGRAVITY_QUOTA_GROUPS = [
  {
    id: 'claude-gpt',
    label: 'Claude / GPT',
    identifiers: ['claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium'],
  },
  {
    id: 'gemini-3-pro',
    label: 'Gemini 3 Pro',
    identifiers: ['gemini-3-pro-high', 'gemini-3-pro-low'],
  },
  {
    id: 'gemini-3-1-pro-series',
    label: 'Gemini 3.1 Pro Series',
    identifiers: ['gemini-3.1-pro-high', 'gemini-3.1-pro-low'],
  },
  {
    id: 'gemini-2-5-flash',
    label: 'Gemini 2.5 Flash',
    identifiers: ['gemini-2.5-flash', 'gemini-2.5-flash-thinking'],
  },
  {
    id: 'gemini-2-5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    identifiers: ['gemini-2.5-flash-lite'],
  },
  {
    id: 'gemini-2-5-cu',
    label: 'Gemini 2.5 CU',
    identifiers: ['rev19-uic3-1p'],
  },
  {
    id: 'gemini-3-flash',
    label: 'Gemini 3 Flash',
    identifiers: ['gemini-3-flash'],
  },
  {
    id: 'gemini-image',
    label: 'Gemini Image',
    identifiers: ['gemini-3.1-flash-image'],
  },
] as const
const CLAUDE_PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CLAUDE_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
} as const
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CODEX_ACCOUNT_DISCOVERY_URLS = [
  'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27',
  'https://chatgpt.com/backend-api/accounts',
  'https://chat.openai.com/backend-api/accounts/check/v4-2023-04-27',
] as const
const CODEX_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal',
} as const
const GEMINI_CLI_QUOTA_URL =
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'
const GEMINI_CLI_CODE_ASSIST_URL =
  'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
const GEMINI_CLI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
} as const
const GEMINI_CLI_QUOTA_GROUPS = [
  {
    id: 'gemini-flash-lite-series',
    label: 'Gemini Flash Lite Series',
    preferredModelId: 'gemini-2.5-flash-lite',
    modelIds: ['gemini-2.5-flash-lite'],
  },
  {
    id: 'gemini-flash-series',
    label: 'Gemini Flash Series',
    preferredModelId: 'gemini-3-flash-preview',
    modelIds: ['gemini-3-flash-preview', 'gemini-2.5-flash'],
  },
  {
    id: 'gemini-pro-series',
    label: 'Gemini Pro Series',
    preferredModelId: 'gemini-3.1-pro-preview',
    modelIds: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-2.5-pro'],
  },
] as const
const GEMINI_CLI_IGNORED_MODEL_PREFIXES = ['gemini-2.0-flash'] as const
const GEMINI_CLI_TIER_LABELS: Record<string, string> = {
  'free-tier': '免费',
  'legacy-tier': 'Legacy',
  'standard-tier': 'Standard',
  'g1-pro-tier': 'Pro',
  'g1-ultra-tier': 'Ultra',
}
const GEMINI_CLI_G1_CREDIT_TYPE = 'GOOGLE_ONE_AI'
const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages'
const KIMI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
} as const
const CLAUDE_USAGE_WINDOW_KEYS = [
  { key: 'five_hour', id: 'five-hour', label: '5 小时窗口' },
  { key: 'seven_day', id: 'seven-day', label: '7 天窗口' },
  { key: 'seven_day_oauth_apps', id: 'seven-day-oauth-apps', label: '7 天 OAuth Apps' },
  { key: 'seven_day_opus', id: 'seven-day-opus', label: '7 天 Opus' },
  { key: 'seven_day_sonnet', id: 'seven-day-sonnet', label: '7 天 Sonnet' },
  { key: 'seven_day_cowork', id: 'seven-day-cowork', label: '7 天 Cowork' },
  { key: 'iguana_necktie', id: 'iguana-necktie', label: 'Iguana Necktie' },
] as const
const PROXY_BINARY_NAMES =
  process.platform === 'win32'
    ? [
        'cli-proxy-api.exe',
        'cli-proxy-api-aarch64-pc-windows-msvc.exe',
        'cli-proxy-api-x86_64-pc-windows-msvc.exe',
        'CLIProxyAPI.exe',
        'cli-proxy-api-plus.exe',
        'CLIProxyAPIPlus.exe',
      ]
    : process.platform === 'darwin'
      ? [
          'cli-proxy-api',
          'cli-proxy-api-aarch64-apple-darwin',
          'cliproxyapi-aarch64-apple-darwin',
          'CLIProxyAPI',
          'cli-proxy-api-plus',
          'CLIProxyAPIPlus',
        ]
      : ['cli-proxy-api', 'CLIProxyAPI', 'cli-proxy-api-plus', 'CLIProxyAPIPlus']

const SONNET_THINKING_MODELS = [
  { name: 'claude-sonnet-4-5', protocol: 'claude' },
  { name: 'claude-sonnet-4-5-thinking', protocol: 'claude' },
  { name: 'gemini-claude-sonnet-4-5', protocol: 'claude' },
  { name: 'gemini-claude-sonnet-4-5-thinking', protocol: 'claude' },
]

const OPUS_THINKING_MODELS = [
  { name: 'claude-opus-4-5', protocol: 'claude' },
  { name: 'claude-opus-4-5-thinking', protocol: 'claude' },
  { name: 'gemini-claude-opus-4-5', protocol: 'claude' },
  { name: 'gemini-claude-opus-4-5-thinking', protocol: 'claude' },
  { name: 'claude-opus-4-6', protocol: 'claude' },
  { name: 'claude-opus-4-6-thinking', protocol: 'claude' },
  { name: 'gemini-claude-opus-4-6', protocol: 'claude' },
  { name: 'gemini-claude-opus-4-6-thinking', protocol: 'claude' },
]

const MANAGED_THINKING_MODEL_NAMES = new Set(
  [...SONNET_THINKING_MODELS, ...OPUS_THINKING_MODELS].map((model) => model.name),
)
const MANAGED_REASONING_EFFORT_MARKER = 'x-cliproxy-desktop-reasoning-effort'

type PlainObject = Record<string, unknown>
type ArchiveKind = 'tar.gz' | 'zip'

interface GuiState {
  reasoningEffort: ReasoningEffort
  proxyBinaryPath: string
  autoSyncOnStop: boolean
  managementApiKey: string
  launchAtLogin: boolean
  autoStartProxyOnLaunch: boolean
  minimizeToTrayOnClose: boolean
}

interface ResolvedPaths {
  baseDir: string
  configPath: string
  guiStatePath: string
  authDir: string
  logsDir: string
  usageStatsPath: string
  binaryCandidates: string[]
}

interface BinaryVersionInfo {
  buildAt: string | null
  version: string | null
}

interface BinaryVersionCacheEntry extends BinaryVersionInfo {
  mtimeMs: number
  path: string
}

interface ReleaseAssetDescriptor {
  archiveKind: ArchiveKind
  assetName: string
  binaryNames: string[]
  defaultTargetFileName: string
  downloadUrl: string
  tag: string
  version: string
}

interface ProviderAuthEndpointDescriptor {
  endpointPath: string
  provider: ProviderAuthProvider
}

interface AuthFileUsageStats {
  failureCount: number
  lastUsedAt: string | null
  successCount: number
  totalRequests: number
}

interface ParsedUsageLogRecord {
  cachedTokens: number
  failed: boolean
  inputTokens: number
  model: string
  outputTokens: number
  reasoningTokens: number
  timestamp: string | null
  timestampMs: number | null
  totalTokens: number
}

interface ParsedUsageLogCacheEntry {
  mtimeMs: number
  record: ParsedUsageLogRecord | null
  size: number
}

interface PersistedUsageRecord extends ParsedUsageLogRecord {
  recordId: string
}

interface PersistedUsageState {
  processedFileIds: string[]
  records: PersistedUsageRecord[]
  updatedAt: string | null
  version: number
}

interface ManagementApiCallRequest {
  authIndex?: string
  data?: string
  header?: Record<string, string>
  method: string
  url: string
}

interface ManagementApiCallResponse {
  body: unknown
  bodyText: string
  headers: Record<string, string>
  statusCode: number
}

const defaultGuiState: GuiState = {
  reasoningEffort: 'xhigh',
  proxyBinaryPath: '',
  autoSyncOnStop: true,
  managementApiKey: DEFAULT_MANAGEMENT_API_KEY,
  launchAtLogin: true,
  autoStartProxyOnLaunch: true,
  minimizeToTrayOnClose: true,
}

const PROVIDER_IMPORTS = [
  { id: 'claude', label: 'Claude' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'qwen', label: 'Qwen' },
  { id: 'iflow', label: 'iFlow' },
  { id: 'vertex', label: 'Vertex' },
  { id: 'kiro', label: 'Kiro' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'copilot', label: 'Copilot' },
] as const

const PROVIDER_AUTH_ENDPOINTS: Partial<Record<ProviderAuthProvider, ProviderAuthEndpointDescriptor>> = {
  claude: {
    provider: 'claude',
    endpointPath: '/v0/management/anthropic-auth-url',
  },
  openai: {
    provider: 'openai',
    endpointPath: '/v0/management/codex-auth-url',
  },
  codex: {
    provider: 'codex',
    endpointPath: '/v0/management/codex-auth-url',
  },
  gemini: {
    provider: 'gemini',
    endpointPath: '/v0/management/gemini-cli-auth-url',
  },
  qwen: {
    provider: 'qwen',
    endpointPath: '/v0/management/qwen-auth-url',
  },
  iflow: {
    provider: 'iflow',
    endpointPath: '/v0/management/iflow-auth-url',
  },
  antigravity: {
    provider: 'antigravity',
    endpointPath: '/v0/management/antigravity-auth-url',
  },
}

const EMPTY_USAGE_SUMMARY: UsageSummary = {
  available: false,
  rangePreset: 'all',
  rangeLabel: '全部时间',
  rangeStartAt: null,
  rangeEndAt: null,
  rangeGranularity: 'day',
  usedDetailRange: false,
  totalRequests: 0,
  successCount: 0,
  failureCount: 0,
  totalTokens: 0,
  netTokens: 0,
  billableInputTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  requestsByDay: [],
  tokensByDay: [],
  topModels: [],
  lastUpdatedAt: null,
  error: null,
}

interface ResolvedUsageSummaryQuery {
  preset: UsageSummaryQueryPreset
  label: string
  startAt: string | null
  endAt: string | null
  granularity: 'hour' | 'day'
  filtered: boolean
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let cachedPaths: ResolvedPaths | null = null
let configWatcher: FSWatcher | null = null
let authWatcher: FSWatcher | null = null
let usageLogWatcher: FSWatcher | null = null
let stateChangeTimer: NodeJS.Timeout | null = null
let usageLogIngestTimer: NodeJS.Timeout | null = null
let proxyChild: ChildProcessByStdio<null, Readable, Readable> | null = null
let proxyStopRequested = false
let appQuitRequested = false
let proxyBinaryVersionCache: BinaryVersionCacheEntry | null = null
let proxyBinaryRefreshPromise: Promise<void> | null = null
let proxyBinaryInstallPromise: Promise<string> | null = null
let guiStateCache: GuiState = { ...defaultGuiState }
let usageStatsCache: PersistedUsageState | null = null
let usageStatsIngestPromise: Promise<PersistedUsageState> | null = null
const usageLogCache = new Map<string, ParsedUsageLogCacheEntry>()
const logBuffer: LogEntry[] = []

const proxyStatus: ProxyStatus = {
  running: false,
  pid: null,
  port: DEFAULT_PORT,
  endpoint: buildApiBaseUrl(DEFAULT_PORT),
  webUiUrl: buildManagementBaseUrl(DEFAULT_PORT),
  binaryPath: '',
  startedAt: null,
  stoppedAt: null,
  lastExitCode: null,
  lastError: null,
  lastSyncAt: null,
}

const proxyBinaryState: ProxyBinaryState = {
  path: '',
  currentVersion: null,
  currentBuildAt: null,
  latestVersion: null,
  latestTag: null,
  updateAvailable: null,
  lastCheckedAt: null,
  lastUpdatedAt: null,
  lastError: null,
}

function buildApiBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`
}

function buildManagementApiBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

function buildManagementBaseUrl(port: number): string {
  return `${buildManagementApiBaseUrl(port)}/management.html`
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

function resolveTrayIconPath(): string {
  const iconFileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tray-assets', iconFileName)
  }

  return path.resolve(__dirname, `../build/${iconFileName}`)
}

function loadTrayImage(): Electron.NativeImage {
  const trayImage = nativeImage.createFromPath(resolveTrayIconPath())

  if (trayImage.isEmpty()) {
    return nativeImage.createEmpty()
  }

  const iconSize = process.platform === 'darwin' ? 18 : 16
  return trayImage.resize({ width: iconSize, height: iconSize })
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? '隐藏窗口' : '显示窗口',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
          mainWindow.hide()
          return
        }

        showMainWindow()
      },
    },
    {
      label: '启动代理',
      enabled: !proxyStatus.running,
      click: () => {
        void startProxyInternalV2().catch(() => undefined)
      },
    },
    {
      label: '停止代理',
      enabled: proxyStatus.running,
      click: () => {
        void stopProxyInternalV2().catch(() => undefined)
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        appQuitRequested = true
        app.quit()
      },
    },
  ])
}

void buildTrayMenu

function buildTrayMenuV2(): Menu {
  return Menu.buildFromTemplate([
    {
      label:
        mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
          ? '隐藏窗口'
          : '显示窗口',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
          mainWindow.hide()
          return
        }

        showMainWindow()
      },
    },
    {
      label: '启动代理',
      enabled: !proxyStatus.running,
      click: () => {
        void startProxyInternalV2().catch(() => undefined)
      },
    },
    {
      label: '停止代理',
      enabled: proxyStatus.running,
      click: () => {
        void stopProxyInternalV2().catch(() => undefined)
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        appQuitRequested = true
        app.quit()
      },
    },
  ])
}

function updateTrayContextMenu(): void {
  if (!tray) {
    return
  }

  queueMicrotask(() => {
    tray?.setToolTip(
      proxyStatus.running
        ? `${APP_PRODUCT_NAME} - 代理运行中 (${proxyStatus.port})`
        : `${APP_PRODUCT_NAME} - 代理未启动`,
    )
  })

  tray.setContextMenu(buildTrayMenuV2())
  tray.setToolTip(
    proxyStatus.running
      ? `ProxyPal - 代理运行中 (${proxyStatus.port})`
      : 'ProxyPal - 代理未启动',
  )
}

function ensureTray(): void {
  if (tray) {
    updateTrayContextMenu()
    return
  }

  tray = new Tray(loadTrayImage())
  tray.on('click', () => {
    showMainWindow()
  })
  tray.on('double-click', () => {
    showMainWindow()
  })
  updateTrayContextMenu()
}

function applyLaunchAtLoginSetting(enabled: boolean): void {
  if (!app.isPackaged) {
    return
  }

  if (process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: [],
    })
    return
  }

  if (process.platform === 'darwin') {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: false,
    })
  }
}

function normalizeYamlPath(inputPath: string): string {
  return inputPath.replace(/\\/g, '/')
}

function asObject(value: unknown): PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : {}
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = readNumber(value, Number.NaN)

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function normalizeStringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

function normalizeNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (!trimmed) {
      return null
    }

    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function normalizeQuotaFraction(value: unknown): number | null {
  const direct = normalizeNumberValue(value)

  if (direct !== null) {
    return direct
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (trimmed.endsWith('%')) {
      const parsed = Number(trimmed.slice(0, -1))
      return Number.isFinite(parsed) ? parsed / 100 : null
    }
  }

  return null
}

function normalizeAuthIndex(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  return null
}

function normalizePlanType(value: unknown): string | null {
  const normalized = normalizeStringValue(value)
  return normalized ? normalized.toLowerCase() : null
}

function normalizeFlagValue(value: unknown): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value !== 0
  }

  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()

    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) {
      return true
    }

    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) {
      return false
    }
  }

  return undefined
}

function decodeBase64UrlPayload(value: string): string | null {
  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  try {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return Buffer.from(padded, 'base64').toString('utf8')
  } catch {
    return null
  }
}

function parseIdTokenPayload(value: unknown): PlainObject | null {
  if (!value) {
    return null
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as PlainObject
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed)

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as PlainObject
    }
  } catch {
    // Continue to JWT parsing.
  }

  const segments = trimmed.split('.')

  if (segments.length < 2) {
    return null
  }

  const decoded = decodeBase64UrlPayload(segments[1])

  if (!decoded) {
    return null
  }

  try {
    const parsed = JSON.parse(decoded)

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as PlainObject)
      : null
  } catch {
    return null
  }
}

function clampPort(value: number): number {
  return Math.min(65535, Math.max(1, Math.round(value)))
}

function clampNonNegativeInteger(value: number): number {
  return Math.max(0, Math.round(value))
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

function isHashedManagementApiKey(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(value.trim())
}

function readRemoteManagementConfig(config: PlainObject): PlainObject {
  return asObject(config['remote-management'])
}

function resolveManagementApiKey(config: PlainObject, guiState: GuiState): string {
  const configKey = readString(readRemoteManagementConfig(config)['secret-key']).trim()

  if (configKey && !isHashedManagementApiKey(configKey)) {
    return configKey
  }

  const guiStateKey = guiState.managementApiKey.trim()

  if (guiStateKey) {
    return guiStateKey
  }

  return DEFAULT_MANAGEMENT_API_KEY
}

async function syncGuiStateManagementApiKey(config: PlainObject): Promise<void> {
  const configKey = readString(readRemoteManagementConfig(config)['secret-key']).trim()

  if (configKey && !isHashedManagementApiKey(configKey)) {
    await writeGuiState({
      managementApiKey: configKey,
    })
  }
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? '').filter(Boolean))]
}

function parseVersionSegments(version: string | null | undefined): number[] | null {
  if (!version) {
    return null
  }

  const cleaned = version.trim().replace(/^v/i, '')

  if (!cleaned) {
    return null
  }

  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite)

  return parts.length > 0 ? parts : null
}

function compareVersions(
  latest: string | null | undefined,
  current: string | null | undefined,
): number | null {
  const latestParts = parseVersionSegments(latest)
  const currentParts = parseVersionSegments(current)

  if (!latestParts || !currentParts) {
    return null
  }

  const length = Math.max(latestParts.length, currentParts.length)

  for (let index = 0; index < length; index += 1) {
    const latestPart = latestParts[index] || 0
    const currentPart = currentParts[index] || 0

    if (latestPart > currentPart) {
      return 1
    }

    if (latestPart < currentPart) {
      return -1
    }
  }

  return 0
}

function getWindowsReleaseArchSuffix(): 'amd64' | 'arm64' {
  if (process.arch === 'x64') {
    return 'amd64'
  }

  if (process.arch === 'arm64') {
    return 'arm64'
  }

  throw new Error(`Windows 自动更新暂不支持当前架构: ${process.arch}`)
}

function getBundledBinarySubdirectories(): string[] {
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? ['win-arm64', 'win-x64'] : ['win-x64', 'win-arm64']
  }

  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? ['mac-arm64', 'mac-x64'] : ['mac-x64', 'mac-arm64']
  }

  return []
}

function getBundledBinarySourceCandidates(targetPath: string): string[] {
  const embeddedRoot = path.join(process.resourcesPath, 'embedded-binaries')
  const fileNames = [...new Set([path.basename(targetPath), ...PROXY_BINARY_NAMES])]
  const candidates = getBundledBinarySubdirectories().flatMap((subdirectory) =>
    fileNames.map((fileName) => path.join(embeddedRoot, subdirectory, fileName)),
  )

  candidates.push(...fileNames.map((fileName) => path.join(embeddedRoot, fileName)))

  return [...new Set(candidates)]
}

function getReleaseAssetDescriptor(tag: string): ReleaseAssetDescriptor {
  const normalizedTag = tag.startsWith('v') ? tag : `v${tag}`
  const version = normalizedTag.replace(/^v/i, '')

  if (process.platform === 'win32') {
    const assetName = `CLIProxyAPI_${version}_windows_${getWindowsReleaseArchSuffix()}.zip`

    return {
      tag: normalizedTag,
      version,
      assetName,
      archiveKind: 'zip',
      defaultTargetFileName: 'cli-proxy-api.exe',
      binaryNames: [
        'cli-proxy-api.exe',
        'cli-proxy-api-aarch64-pc-windows-msvc.exe',
        'cli-proxy-api-x86_64-pc-windows-msvc.exe',
        'CLIProxyAPI.exe',
        'cli-proxy-api-plus.exe',
        'CLIProxyAPIPlus.exe',
      ],
      downloadUrl: `https://github.com/${CLIPROXY_REPOSITORY}/releases/download/${normalizedTag}/${assetName}`,
    }
  }

  if (process.platform === 'darwin') {
    const archSuffix = process.arch === 'x64' ? 'amd64' : 'arm64'
    const assetName = `CLIProxyAPI_${version}_darwin_${archSuffix}.tar.gz`

    return {
      tag: normalizedTag,
      version,
      assetName,
      archiveKind: 'tar.gz',
      defaultTargetFileName: 'cli-proxy-api',
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
      downloadUrl: `https://github.com/${CLIPROXY_REPOSITORY}/releases/download/${normalizedTag}/${assetName}`,
    }
  }

  throw new Error(`当前平台暂不支持自动更新：${process.platform}/${process.arch}`)
}

function toPowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function resolvePaths(): ResolvedPaths {
  if (cachedPaths) {
    return cachedPaths
  }

  const packagedBaseDir =
    process.platform === 'win32'
      ? process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'))
      : path.dirname(app.getPath('exe'))
  const baseDir = app.isPackaged ? path.resolve(packagedBaseDir) : path.resolve(__dirname, '..')

  const binaryCandidates = [
    ...PROXY_BINARY_NAMES.map((fileName) => path.join(baseDir, fileName)),
    ...PROXY_BINARY_NAMES.map((fileName) => path.join(baseDir, 'bin', fileName)),
  ]

  cachedPaths = {
    baseDir,
    configPath: path.join(baseDir, 'proxy-config.yaml'),
    guiStatePath: path.join(baseDir, 'gui-state.json'),
    authDir: path.join(baseDir, AUTH_DIRECTORY_NAME),
    logsDir: path.join(baseDir, 'logs'),
    usageStatsPath: path.join(baseDir, USAGE_STATS_FILE_NAME),
    binaryCandidates,
  }

  return cachedPaths
}

function thinkingModeFromTokens(
  tokenBudget: number,
  fallbackMode: ThinkingBudgetMode,
): ThinkingBudgetMode {
  if (tokenBudget === 2048) {
    return 'low'
  }

  if (tokenBudget === 8192) {
    return 'medium'
  }

  if (tokenBudget === 32768) {
    return 'high'
  }

  return fallbackMode === 'custom' ? 'custom' : 'custom'
}

function resolveThinkingBudgetTokens(mode: ThinkingBudgetMode, customBudget: number): number {
  if (mode === 'low') {
    return 2048
  }

  if (mode === 'medium') {
    return 8192
  }

  if (mode === 'high') {
    return 32768
  }

  return Math.max(1024, Math.round(customBudget || DEFAULT_THINKING_CUSTOM))
}

function buildManagedThinkingEntries(tokenBudget: number): PlainObject[] {
  return [
    {
      models: SONNET_THINKING_MODELS,
      params: {
        'thinking.budget_tokens': tokenBudget,
      },
    },
    {
      models: OPUS_THINKING_MODELS,
      params: {
        'thinking.budget_tokens': tokenBudget,
      },
    },
  ]
}

function buildManagedReasoningEffortEntry(reasoningEffort: ReasoningEffort): PlainObject {
  return {
    params: {
      'reasoning.effort': reasoningEffort,
      _managedBy: MANAGED_REASONING_EFFORT_MARKER,
    },
  }
}

function isManagedThinkingEntry(entry: unknown): boolean {
  const entryObject = asObject(entry)
  const params = asObject(entryObject.params)

  if (!Object.prototype.hasOwnProperty.call(params, 'thinking.budget_tokens')) {
    return false
  }

  const models = asArray<PlainObject>(entryObject.models)
  const names = models.map((model) => readString(asObject(model).name)).filter(Boolean)

  return names.length > 0 && names.every((name) => MANAGED_THINKING_MODEL_NAMES.has(name))
}

function isManagedReasoningEffortEntry(entry: unknown): boolean {
  const entryObject = asObject(entry)
  const params = asObject(entryObject.params)

  return readString(params._managedBy) === MANAGED_REASONING_EFFORT_MARKER
}

function createDefaultConfig(): PlainObject {
  const paths = resolvePaths()

  return {
    port: DEFAULT_PORT,
    'auth-dir': normalizeYamlPath(paths.authDir),
    'api-keys': [DEFAULT_PROXY_API_KEY],
    debug: false,
    'logging-to-file': true,
    'logs-max-total-size-mb': DEFAULT_LOGS_MAX_TOTAL_SIZE_MB,
    'usage-statistics-enabled': true,
    'request-log': true,
    'request-retry': DEFAULT_REQUEST_RETRY,
    'max-retry-interval': DEFAULT_MAX_RETRY_INTERVAL,
    streaming: {
      'keepalive-seconds': DEFAULT_STREAM_KEEPALIVE_SECONDS,
      'bootstrap-retries': DEFAULT_STREAM_BOOTSTRAP_RETRIES,
    },
    'nonstream-keepalive-interval': DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS,
    routing: {
      strategy: 'round-robin',
    },
    'remote-management': {
      'allow-remote': true,
      'secret-key': DEFAULT_MANAGEMENT_API_KEY,
      'disable-control-panel': false,
    },
    payload: {
      default: [
        ...buildManagedThinkingEntries(8192),
        buildManagedReasoningEffortEntry(defaultGuiState.reasoningEffort),
      ],
    },
    [DESKTOP_METADATA_KEY]: {
      'use-system-proxy': false,
      'thinking-budget': {
        mode: 'medium',
        'custom-budget': DEFAULT_THINKING_CUSTOM,
      },
    },
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function moveFileWithFallback(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, targetPath)
  } catch {
    await fs.copyFile(sourcePath, targetPath)
    await fs.unlink(sourcePath)
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function computeProxyBinaryUpdateAvailable(
  hasBinary: boolean,
  currentVersion: string | null,
  latestVersion: string | null,
): boolean | null {
  if (!latestVersion) {
    return hasBinary ? null : null
  }

  if (!hasBinary) {
    return true
  }

  if (!currentVersion) {
    return true
  }

  const comparison = compareVersions(latestVersion, currentVersion)
  return comparison === null ? null : comparison > 0
}

function parseBinaryVersionOutput(output: string): BinaryVersionInfo {
  const normalizedOutput = output.replace(/\0/g, '')
  const versionMatch =
    normalizedOutput.match(/CLIProxyAPI\s+Version:\s*([^\s,]+)/i) ??
    normalizedOutput.match(/\bversion\b[^0-9]*([0-9]+(?:\.[0-9]+)+(?:[-+][^\s,]+)?)/i)
  const buildAtMatch = normalizedOutput.match(/\bBuiltAt:\s*([^\s,]+)/i)

  return {
    version: versionMatch?.[1]?.trim() ?? null,
    buildAt: buildAtMatch?.[1]?.trim() ?? null,
  }
}

async function getBinaryVersionInfo(binaryPath: string): Promise<BinaryVersionInfo> {
  const stats = await fs.stat(binaryPath)

  if (
    proxyBinaryVersionCache &&
    proxyBinaryVersionCache.path === binaryPath &&
    proxyBinaryVersionCache.mtimeMs === stats.mtimeMs
  ) {
    return {
      version: proxyBinaryVersionCache.version,
      buildAt: proxyBinaryVersionCache.buildAt,
    }
  }

  let combinedOutput = ''

  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, ['--help'], {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
    })
    combinedOutput = `${String(stdout ?? '')}\n${String(stderr ?? '')}`
  } catch (error) {
    const failed = error as Error & {
      stderr?: Buffer | string
      stdout?: Buffer | string
    }

    combinedOutput = [
      failed.stdout ? String(failed.stdout) : '',
      failed.stderr ? String(failed.stderr) : '',
      failed.message,
    ]
      .filter(Boolean)
      .join('\n')
  }

  const parsed = parseBinaryVersionOutput(combinedOutput)

  proxyBinaryVersionCache = {
    path: binaryPath,
    mtimeMs: stats.mtimeMs,
    version: parsed.version,
    buildAt: parsed.buildAt,
  }

  return parsed
}

async function syncProxyBinaryLocalState(binaryPath: string): Promise<void> {
  proxyBinaryState.path = binaryPath

  if (!binaryPath) {
    proxyBinaryState.currentVersion = null
    proxyBinaryState.currentBuildAt = null
    proxyBinaryState.lastUpdatedAt = null
    proxyBinaryState.updateAvailable = computeProxyBinaryUpdateAvailable(
      false,
      null,
      proxyBinaryState.latestVersion,
    )
    return
  }

  try {
    const stats = await fs.stat(binaryPath)
    const info = await getBinaryVersionInfo(binaryPath)

    proxyBinaryState.currentVersion = info.version
    proxyBinaryState.currentBuildAt = info.buildAt
    proxyBinaryState.lastUpdatedAt = new Date(stats.mtimeMs).toISOString()
    proxyBinaryState.updateAvailable = computeProxyBinaryUpdateAvailable(
      true,
      info.version,
      proxyBinaryState.latestVersion,
    )
  } catch {
    proxyBinaryState.currentVersion = null
    proxyBinaryState.currentBuildAt = null
    proxyBinaryState.lastUpdatedAt = null
    proxyBinaryState.updateAvailable = computeProxyBinaryUpdateAvailable(
      false,
      null,
      proxyBinaryState.latestVersion,
    )
  }
}

function findReleaseAssetFromApi(
  assets: Array<{ name: string; downloadUrl: string }>,
): { downloadUrl: string; name: string } | null {
  if (process.platform === 'win32') {
    const suffix = getWindowsReleaseArchSuffix()
    const matched = assets.find((asset) =>
      new RegExp(`^CLIProxyAPI_.*_windows_${suffix}\\.zip$`, 'i').test(asset.name),
    )
    return matched ?? null
  }

  if (process.platform === 'darwin') {
    const archSuffix = process.arch === 'x64' ? 'amd64' : 'arm64'
    const matched = assets.find((asset) =>
      new RegExp(`^CLIProxyAPI_.*_darwin_${archSuffix}\\.tar\\.gz$`, 'i').test(asset.name),
    )
    return matched ?? null
  }

  return null
}

function extractReleaseTagFromUrl(input: string): string | null {
  const match = input.match(/\/releases\/tag\/([^/?#]+)/i)
  return match?.[1] ?? null
}

async function fetchLatestReleaseTagFromRedirect(): Promise<string> {
  const requestInit = {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'CLIProxy Desktop',
    },
  }

  try {
    const response = await fetch(CLIPROXY_RELEASES_LATEST_URL, {
      ...requestInit,
      method: 'HEAD',
      redirect: 'manual',
    })
    const resolvedTag =
      extractReleaseTagFromUrl(response.headers.get('location') ?? '') ??
      extractReleaseTagFromUrl(response.url)

    if (resolvedTag) {
      return resolvedTag
    }
  } catch {
    // Fall through to GET fallback.
  }

  const response = await fetch(CLIPROXY_RELEASES_LATEST_URL, {
    ...requestInit,
    method: 'GET',
    redirect: 'follow',
  })
  const resolvedTag =
    extractReleaseTagFromUrl(response.url) ??
    extractReleaseTagFromUrl(response.headers.get('location') ?? '')

  if (!resolvedTag) {
    throw new Error('无法解析 CLIProxyAPI 最新发布版本。')
  }

  return resolvedTag
}

async function fetchLatestReleaseDescriptor(): Promise<ReleaseAssetDescriptor> {
  let apiError: string | null = null

  try {
    const response = await fetch(CLIPROXY_RELEASES_LATEST_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'CLIProxy Desktop',
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const payload = asObject(await response.json())
    const tag =
      normalizeStringValue(payload.tag_name) ??
      normalizeStringValue(payload.name) ??
      normalizeStringValue(payload.tag) ??
      null

    if (!tag) {
      throw new Error('缺少 tag_name')
    }

    const descriptor = getReleaseAssetDescriptor(tag)
    const assets = asArray<PlainObject>(payload.assets)
      .map((entry) => {
        const name = normalizeStringValue(entry.name)
        const downloadUrl = normalizeStringValue(
          entry.browser_download_url ?? entry.browserDownloadUrl,
        )

        if (!name || !downloadUrl) {
          return null
        }

        return { name, downloadUrl }
      })
      .filter((value): value is { name: string; downloadUrl: string } => value !== null)
    const matchedAsset = findReleaseAssetFromApi(assets)

    if (!matchedAsset) {
      return descriptor
    }

    return {
      ...descriptor,
      assetName: matchedAsset.name,
      downloadUrl: matchedAsset.downloadUrl,
    }
  } catch (error) {
    apiError = toErrorMessage(error)
  }

  try {
    const tag = await fetchLatestReleaseTagFromRedirect()
    return getReleaseAssetDescriptor(tag)
  } catch (error) {
    throw new Error(
      `无法获取 CLIProxyAPI 最新版本（API: ${apiError ?? '未知错误'}；Redirect: ${toErrorMessage(
        error,
      )}）`,
    )
  }
}

function resolveBinaryInstallTargetPath(
  guiState: GuiState,
  effectiveBinaryPath: string,
  descriptor: ReleaseAssetDescriptor,
): string {
  if (effectiveBinaryPath) {
    return effectiveBinaryPath
  }

  if (guiState.proxyBinaryPath.trim()) {
    return path.resolve(guiState.proxyBinaryPath)
  }

  return path.join(resolvePaths().baseDir, descriptor.defaultTargetFileName)
}

async function downloadReleaseAsset(
  descriptor: ReleaseAssetDescriptor,
  targetPath: string,
): Promise<void> {
  const response = await fetch(descriptor.downloadUrl, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'CLIProxy Desktop',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`下载 ${descriptor.assetName} 失败：HTTP ${response.status}`)
  }

  const payload = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(targetPath, payload)
}

async function extractArchive(
  archivePath: string,
  destinationPath: string,
  archiveKind: ArchiveKind,
): Promise<void> {
  await fs.mkdir(destinationPath, { recursive: true })

  if (archiveKind === 'zip') {
    if (process.platform !== 'win32') {
      throw new Error('zip 更新包目前只支持在 Windows 环境中解压。')
    }

    await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath ${toPowerShellLiteral(
          archivePath,
        )} -DestinationPath ${toPowerShellLiteral(destinationPath)} -Force`,
      ],
      {
        windowsHide: true,
      },
    )
    return
  }

  await execFileAsync('tar', ['-xzf', archivePath, '-C', destinationPath], {
    windowsHide: true,
  })
}

async function findExtractedBinary(
  rootDirectory: string,
  binaryNames: string[],
): Promise<string> {
  const wantedNames = new Set(binaryNames.map((name) => name.toLowerCase()))
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

  throw new Error('下载包已解压，但没有找到可执行的 CLIProxyAPI 文件。')
}

async function refreshProxyBinaryState(): Promise<void> {
  if (proxyBinaryRefreshPromise) {
    return proxyBinaryRefreshPromise
  }

  proxyBinaryRefreshPromise = (async () => {
    const guiState = await readGuiState()
    const effectiveBinaryPath = await resolveBinaryPath(guiState)

    await syncProxyBinaryLocalState(effectiveBinaryPath)

    try {
      const descriptor = await fetchLatestReleaseDescriptor()

      proxyBinaryState.latestTag = descriptor.tag
      proxyBinaryState.latestVersion = descriptor.version
      proxyBinaryState.lastCheckedAt = new Date().toISOString()
      proxyBinaryState.lastError = null
      proxyBinaryState.updateAvailable = computeProxyBinaryUpdateAvailable(
        Boolean(effectiveBinaryPath),
        proxyBinaryState.currentVersion,
        descriptor.version,
      )
    } catch (error) {
      proxyBinaryState.lastCheckedAt = new Date().toISOString()
      proxyBinaryState.lastError = toErrorMessage(error)
      proxyBinaryState.updateAvailable = computeProxyBinaryUpdateAvailable(
        Boolean(effectiveBinaryPath),
        proxyBinaryState.currentVersion,
        proxyBinaryState.latestVersion,
      )
    }
  })().finally(() => {
    proxyBinaryRefreshPromise = null
  })

  return proxyBinaryRefreshPromise
}

async function updateProxyBinaryInternal(): Promise<string> {
  if (proxyBinaryInstallPromise) {
    return proxyBinaryInstallPromise
  }

  proxyBinaryInstallPromise = (async () => {
    const guiState = await readGuiState()
    const effectiveBinaryPath = await resolveBinaryPath(guiState)
    const wasRunning = proxyStatus.running
    let tempDirectory: string | null = null

    try {
      proxyBinaryState.lastCheckedAt = new Date().toISOString()
      proxyBinaryState.lastError = null

      const descriptor = await fetchLatestReleaseDescriptor()
      const targetPath = resolveBinaryInstallTargetPath(
        guiState,
        effectiveBinaryPath,
        descriptor,
      )

      tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cliproxyapi-'))
      const archivePath = path.join(tempDirectory, descriptor.assetName)
      const extractDirectory = path.join(tempDirectory, 'extract')

      proxyBinaryState.latestTag = descriptor.tag
      proxyBinaryState.latestVersion = descriptor.version
      proxyBinaryState.lastError = null

      if (wasRunning) {
        await appendLog('info', 'app', '更新 CLIProxyAPI 前先停止当前代理进程。')
        await stopProxyInternalV2()
      }

      await appendLog(
        'info',
        'app',
        `开始下载 CLIProxyAPI ${descriptor.version}：${descriptor.assetName}`,
      )

      await downloadReleaseAsset(descriptor, archivePath)
      await extractArchive(archivePath, extractDirectory, descriptor.archiveKind)

      const extractedBinaryPath = await findExtractedBinary(
        extractDirectory,
        descriptor.binaryNames,
      )

      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.copyFile(extractedBinaryPath, targetPath)

      if (process.platform !== 'win32') {
        await fs.chmod(targetPath, 0o755)
      }

      proxyBinaryVersionCache = null
      await writeGuiState({
        proxyBinaryPath: targetPath,
      })
      await syncProxyBinaryLocalState(targetPath)

      proxyBinaryState.lastError = null
      proxyBinaryState.updateAvailable = computeProxyBinaryUpdateAvailable(
        true,
        proxyBinaryState.currentVersion,
        descriptor.version,
      )

      await appendLog('info', 'app', `CLIProxyAPI 已更新到 ${descriptor.version}：${targetPath}`)

      if (wasRunning) {
        try {
          await startProxyInternalV2()
          await appendLog('info', 'app', 'CLIProxyAPI 更新完成，代理已自动重新启动。')
        } catch (error) {
          const restartError = `CLIProxyAPI 已更新，但自动重启失败：${toErrorMessage(error)}`
          proxyBinaryState.lastError = restartError
          await appendLog('error', 'app', restartError)
          throw new Error(restartError)
        }
      }

      return targetPath
    } catch (error) {
      proxyBinaryState.lastError = toErrorMessage(error)
      await appendLog('error', 'app', `CLIProxyAPI 更新失败：${proxyBinaryState.lastError}`)
      throw error
    } finally {
      if (tempDirectory) {
        await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  })().finally(() => {
    proxyBinaryInstallPromise = null
  })

  return proxyBinaryInstallPromise
}

async function ensureProxyBinaryInstalled(): Promise<string> {
  const guiState = await readGuiState()
  const effectiveBinaryPath = await resolveBinaryPath(guiState)

  if (effectiveBinaryPath) {
    await syncProxyBinaryLocalState(effectiveBinaryPath)
    return effectiveBinaryPath
  }

  return updateProxyBinaryInternal()
}

async function readGuiState(): Promise<GuiState> {
  const { guiStatePath } = resolvePaths()

  try {
    const raw = await fs.readFile(guiStatePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<GuiState>

    guiStateCache = {
      reasoningEffort: parsed.reasoningEffort ?? defaultGuiState.reasoningEffort,
      proxyBinaryPath: parsed.proxyBinaryPath ?? defaultGuiState.proxyBinaryPath,
      autoSyncOnStop: parsed.autoSyncOnStop ?? defaultGuiState.autoSyncOnStop,
      managementApiKey: parsed.managementApiKey ?? defaultGuiState.managementApiKey,
      launchAtLogin: parsed.launchAtLogin ?? defaultGuiState.launchAtLogin,
      autoStartProxyOnLaunch:
        parsed.autoStartProxyOnLaunch ?? defaultGuiState.autoStartProxyOnLaunch,
      minimizeToTrayOnClose:
        parsed.minimizeToTrayOnClose ?? defaultGuiState.minimizeToTrayOnClose,
    }

    return { ...guiStateCache }
  } catch {
    guiStateCache = { ...defaultGuiState }
    return { ...guiStateCache }
  }
}

async function writeGuiState(
  partialState: Partial<GuiState>,
  replace = false,
): Promise<GuiState> {
  const { guiStatePath } = resolvePaths()
  const nextState = replace
    ? ({ ...defaultGuiState, ...partialState } as GuiState)
    : ({ ...(await readGuiState()), ...partialState } as GuiState)

  await fs.writeFile(guiStatePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8')
  guiStateCache = { ...nextState }
  return { ...guiStateCache }
}

async function readConfigText(): Promise<string> {
  const { configPath } = resolvePaths()
  return fs.readFile(configPath, 'utf8')
}

function parseConfigObject(configText: string): PlainObject {
  const parsed = parse(configText)

  if (parsed === null || parsed === undefined) {
    return {}
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('YAML 根节点必须是对象。')
  }

  return parsed as PlainObject
}

function stringifyConfigObject(config: PlainObject): string {
  return ensureTrailingNewline(
    stringify(config, {
      lineWidth: 0,
    }),
  )
}

async function writeConfigObject(config: PlainObject): Promise<void> {
  const { configPath } = resolvePaths()
  ensureRequiredConfigFields(config)
  await fs.writeFile(configPath, stringifyConfigObject(config), 'utf8')
}

async function migrateLegacyAuthFilesToDedicatedDirectory(): Promise<void> {
  const { baseDir, authDir } = resolvePaths()

  if (path.resolve(baseDir) === path.resolve(authDir)) {
    return
  }

  const entries = await fs.readdir(baseDir, { withFileTypes: true })
  let migratedCount = 0

  for (const entry of entries) {
    if (!entry.isFile() || !isCandidateAuthFileNameV2(entry.name)) {
      continue
    }

    const sourcePath = path.join(baseDir, entry.name)
    const payload = await readAuthFilePayload(sourcePath)

    if (!looksLikeAuthFilePayload(entry.name, payload)) {
      continue
    }

    const directTargetPath = path.join(authDir, entry.name)
    const targetPath =
      (await pathExists(directTargetPath)) ? await nextAvailableAuthPath(entry.name) : directTargetPath

    await moveFileWithFallback(sourcePath, targetPath)
    migratedCount += 1
  }

  if (migratedCount > 0) {
    await appendLog(
      'info',
      'app',
      `已将 ${migratedCount} 个旧认证文件迁移到 ${AUTH_DIRECTORY_NAME} 目录。`,
    )
  }
}

async function ensureAppFiles(): Promise<void> {
  const paths = resolvePaths()

  await fs.mkdir(paths.baseDir, { recursive: true })
  await fs.mkdir(paths.authDir, { recursive: true })
  await fs.mkdir(paths.logsDir, { recursive: true })
  await migrateLegacyAuthFilesToDedicatedDirectory()
  await ensureBundledBinaryInBaseDir()

  if (!(await pathExists(paths.configPath))) {
    await writeConfigObject(createDefaultConfig())
  }

  if (!(await pathExists(paths.guiStatePath))) {
    await writeGuiState(defaultGuiState, true)
  }

  if (!(await pathExists(paths.usageStatsPath))) {
    await fs.writeFile(
      paths.usageStatsPath,
      JSON.stringify(
        {
          version: 1,
          updatedAt: null,
          processedFileIds: [],
          records: [],
        },
        null,
        2,
      ),
      'utf8',
    )
  }
}

async function ensureBundledBinaryInBaseDir(): Promise<void> {
  const targetPath = resolvePaths().binaryCandidates[0]

  if (!targetPath || (await pathExists(targetPath))) {
    return
  }

  const sourceCandidates = getBundledBinarySourceCandidates(targetPath)

  for (const sourcePath of sourceCandidates) {
    if (!(await pathExists(sourcePath))) {
      continue
    }

    await fs.copyFile(sourcePath, targetPath)

    if (process.platform !== 'win32') {
      await fs.chmod(targetPath, 0o755).catch(() => undefined)
    }

    return
  }
}

function getDesktopMetadata(config: PlainObject): PlainObject {
  return asObject(config[DESKTOP_METADATA_KEY])
}

function extractThinkingBudget(
  config: PlainObject,
): { customBudget: number; mode: ThinkingBudgetMode } {
  const desktop = getDesktopMetadata(config)
  const thinkingBudget = asObject(desktop['thinking-budget'])
  const fallbackMode = (readString(thinkingBudget.mode, 'medium') ||
    'medium') as ThinkingBudgetMode
  const fallbackCustomBudget = readNumber(
    thinkingBudget['custom-budget'],
    DEFAULT_THINKING_CUSTOM,
  )

  const payload = asObject(config.payload)
  const payloadDefaults = asArray<PlainObject>(payload.default)
  const managedEntry = payloadDefaults.find(isManagedThinkingEntry)
  const managedParams = asObject(managedEntry?.params)
  const tokenBudget = readNumber(
    managedParams['thinking.budget_tokens'],
    resolveThinkingBudgetTokens(fallbackMode, fallbackCustomBudget),
  )

  return {
    mode: thinkingModeFromTokens(tokenBudget, fallbackMode),
    customBudget:
      thinkingModeFromTokens(tokenBudget, fallbackMode) === 'custom'
        ? tokenBudget
        : fallbackCustomBudget,
  }
}

function applyThinkingBudget(
  config: PlainObject,
  mode: ThinkingBudgetMode,
  customBudget: number,
): void {
  const tokenBudget = resolveThinkingBudgetTokens(mode, customBudget)
  const payload = asObject(config.payload)
  const payloadDefaults = asArray<PlainObject>(payload.default).filter(
    (entry) => !isManagedThinkingEntry(entry),
  )
  payload.default = [...buildManagedThinkingEntries(tokenBudget), ...payloadDefaults]
  config.payload = payload

  const desktop = getDesktopMetadata(config)
  desktop['thinking-budget'] = {
    mode,
    'custom-budget': Math.max(1024, Math.round(customBudget || DEFAULT_THINKING_CUSTOM)),
  }
  config[DESKTOP_METADATA_KEY] = desktop
}

function extractReasoningEffort(config: PlainObject, guiState: GuiState): ReasoningEffort {
  const payload = asObject(config.payload)
  const payloadDefaults = asArray<PlainObject>(payload.default)
  const managedEntry = payloadDefaults.find(isManagedReasoningEffortEntry)
  const managedParams = asObject(managedEntry?.params)
  const reasoningEffort = readString(managedParams['reasoning.effort']) as ReasoningEffort

  if (
    reasoningEffort === 'minimal' ||
    reasoningEffort === 'low' ||
    reasoningEffort === 'medium' ||
    reasoningEffort === 'high' ||
    reasoningEffort === 'xhigh'
  ) {
    return reasoningEffort
  }

  return guiState.reasoningEffort
}

function extractKnownSettings(config: PlainObject, guiState: GuiState): KnownSettings {
  const thinkingBudget = extractThinkingBudget(config)
  const desktop = getDesktopMetadata(config)
  const port = clampPort(readNumber(config.port, DEFAULT_PORT))
  const streaming = asObject(config.streaming)

  const apiKeys = asArray<string>(config['api-keys'])
  const proxyApiKey = apiKeys.find((item) => typeof item === 'string' && item.trim())?.trim()

  return {
    port,
    useSystemProxy: readBoolean(desktop['use-system-proxy'], false),
    proxyUrl: readString(config['proxy-url']),
    proxyApiKey: proxyApiKey || DEFAULT_PROXY_API_KEY,
    managementApiKey: resolveManagementApiKey(config, guiState),
    requestRetry: clampNonNegativeInteger(
      readNumber(config['request-retry'], DEFAULT_REQUEST_RETRY),
    ),
    maxRetryInterval: clampNonNegativeInteger(
      readNumber(config['max-retry-interval'], DEFAULT_MAX_RETRY_INTERVAL),
    ),
    streamKeepaliveSeconds: clampNonNegativeInteger(
      readNumber(streaming['keepalive-seconds'], DEFAULT_STREAM_KEEPALIVE_SECONDS),
    ),
    streamBootstrapRetries: clampNonNegativeInteger(
      readNumber(streaming['bootstrap-retries'], DEFAULT_STREAM_BOOTSTRAP_RETRIES),
    ),
    nonStreamKeepaliveIntervalSeconds: clampNonNegativeInteger(
      readNumber(
        config['nonstream-keepalive-interval'],
        DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS,
      ),
    ),
    thinkingBudgetMode: thinkingBudget.mode,
    thinkingBudgetCustom: thinkingBudget.customBudget,
    reasoningEffort: extractReasoningEffort(config, guiState),
    autoSyncOnStop: guiState.autoSyncOnStop,
    launchAtLogin: guiState.launchAtLogin,
    autoStartProxyOnLaunch: guiState.autoStartProxyOnLaunch,
    minimizeToTrayOnClose: guiState.minimizeToTrayOnClose,
    apiBaseUrl: buildApiBaseUrl(port),
    managementBaseUrl: buildManagementBaseUrl(port),
  }
}

function ensureRequiredConfigFields(config: PlainObject): void {
  const paths = resolvePaths()
  const apiKeys = asArray<string>(config['api-keys']).filter(
    (item) => typeof item === 'string' && item.trim(),
  )
  config.port = clampPort(readNumber(config.port, DEFAULT_PORT))
  config['api-keys'] = apiKeys.length > 0 ? apiKeys : [DEFAULT_PROXY_API_KEY]
  config['auth-dir'] = normalizeYamlPath(paths.authDir)

  const routing = asObject(config.routing)
  routing.strategy = readString(routing.strategy, 'round-robin') || 'round-robin'
  config.routing = routing

  const remoteManagement = readRemoteManagementConfig(config)
  remoteManagement['allow-remote'] = readBoolean(
    remoteManagement['allow-remote'],
    true,
  )
  remoteManagement['secret-key'] =
    readString(remoteManagement['secret-key']).trim() || DEFAULT_MANAGEMENT_API_KEY
  remoteManagement['disable-control-panel'] = readBoolean(
    remoteManagement['disable-control-panel'],
    false,
  )
  config['remote-management'] = remoteManagement

  config['request-log'] = readBoolean(config['request-log'], true)
  config['logging-to-file'] = readBoolean(config['logging-to-file'], true)
  config['usage-statistics-enabled'] = readBoolean(
    config['usage-statistics-enabled'],
    true,
  )
  const logsMaxTotalSizeMb = readNumber(
    config['logs-max-total-size-mb'],
    DEFAULT_LOGS_MAX_TOTAL_SIZE_MB,
  )
  config['logs-max-total-size-mb'] =
    logsMaxTotalSizeMb === LEGACY_DEFAULT_LOGS_MAX_TOTAL_SIZE_MB
      ? DEFAULT_LOGS_MAX_TOTAL_SIZE_MB
      : logsMaxTotalSizeMb
  config['request-retry'] = clampNonNegativeInteger(
    readNumber(config['request-retry'], DEFAULT_REQUEST_RETRY),
  )
  config['max-retry-interval'] = clampNonNegativeInteger(
    readNumber(config['max-retry-interval'], DEFAULT_MAX_RETRY_INTERVAL),
  )

  const streaming = asObject(config.streaming)
  streaming['keepalive-seconds'] = clampNonNegativeInteger(
    readNumber(streaming['keepalive-seconds'], DEFAULT_STREAM_KEEPALIVE_SECONDS),
  )
  streaming['bootstrap-retries'] = clampNonNegativeInteger(
    readNumber(streaming['bootstrap-retries'], DEFAULT_STREAM_BOOTSTRAP_RETRIES),
  )
  config.streaming = streaming
  config['nonstream-keepalive-interval'] = clampNonNegativeInteger(
    readNumber(
      config['nonstream-keepalive-interval'],
      DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS,
    ),
  )
}

async function applyKnownSettings(
  config: PlainObject,
  input: SaveKnownSettingsInput,
): Promise<void> {
  ensureRequiredConfigFields(config)

  config.port = clampPort(input.port)
  config['api-keys'] = [input.proxyApiKey.trim() || DEFAULT_PROXY_API_KEY]

  const remoteManagement = asObject(config['remote-management'])
  remoteManagement['allow-remote'] = readBoolean(remoteManagement['allow-remote'], true)
  remoteManagement['disable-control-panel'] = readBoolean(
    remoteManagement['disable-control-panel'],
    false,
  )
  remoteManagement['secret-key'] =
    input.managementApiKey.trim() || DEFAULT_MANAGEMENT_API_KEY
  config['remote-management'] = remoteManagement

  const desktop = getDesktopMetadata(config)
  desktop['use-system-proxy'] = input.useSystemProxy
  config[DESKTOP_METADATA_KEY] = desktop

  if (input.useSystemProxy) {
    const systemProxyUrl = await detectSystemProxyUrl()
    const existingProxyUrl = readString(config['proxy-url']).trim()

    if (systemProxyUrl) {
      config['proxy-url'] = systemProxyUrl
    } else if (existingProxyUrl) {
      config['proxy-url'] = existingProxyUrl
    } else {
      delete config['proxy-url']
    }
  } else {
    const nextProxyUrl = input.proxyUrl.trim()

    if (nextProxyUrl) {
      config['proxy-url'] = nextProxyUrl
    } else {
      delete config['proxy-url']
    }
  }

  config['request-retry'] = clampNonNegativeInteger(input.requestRetry)
  config['max-retry-interval'] = clampNonNegativeInteger(input.maxRetryInterval)
  config['nonstream-keepalive-interval'] = clampNonNegativeInteger(
    input.nonStreamKeepaliveIntervalSeconds,
  )

  const streaming = asObject(config.streaming)
  streaming['keepalive-seconds'] = clampNonNegativeInteger(input.streamKeepaliveSeconds)
  streaming['bootstrap-retries'] = clampNonNegativeInteger(input.streamBootstrapRetries)
  config.streaming = streaming

  applyThinkingBudget(config, input.thinkingBudgetMode, input.thinkingBudgetCustom)
  applyReasoningEffort(config, input.reasoningEffort)
}

function applyReasoningEffort(config: PlainObject, reasoningEffort: ReasoningEffort): void {
  const payload = asObject(config.payload)
  const payloadDefaults = asArray<PlainObject>(payload.default).filter(
    (entry) => !isManagedReasoningEffortEntry(entry),
  )

  payload.default = [buildManagedReasoningEffortEntry(reasoningEffort), ...payloadDefaults]
  config.payload = payload
}

function normalizeProviderModels(models: ProviderModelMapping[]): ProviderModelMapping[] {
  const deduped = new Map<string, ProviderModelMapping>()

  for (const model of models) {
    const name = model.name.trim()
    const alias = (model.alias || model.name).trim()

    if (!name) {
      continue
    }

    deduped.set(alias.toLowerCase(), {
      alias,
      name,
    })
  }

  return [...deduped.values()]
}

function readOptionalNumber(value: unknown): number | null {
  const parsed = readNumber(value, Number.NaN)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

function readStringArray(value: unknown): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const item of asArray<unknown>(value)) {
    const normalized = String(item ?? '').trim()

    if (!normalized) {
      continue
    }

    const dedupeKey = normalized.toLowerCase()

    if (seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    result.push(normalized)
  }

  return result
}

function normalizeHeaderEntries(entries: ProviderHeaderEntry[]): ProviderHeaderEntry[] {
  const deduped = new Map<string, ProviderHeaderEntry>()

  for (const entry of entries) {
    const key = entry.key.trim()

    if (!key) {
      continue
    }

    deduped.set(key.toLowerCase(), {
      key,
      value: entry.value.trim(),
    })
  }

  return [...deduped.values()]
}

function readHeaderEntries(value: unknown): ProviderHeaderEntry[] {
  return normalizeHeaderEntries(
    Object.entries(asObject(value)).map(([key, headerValue]) => ({
      key,
      value: readString(headerValue),
    })),
  )
}

function buildHeadersObject(entries: ProviderHeaderEntry[]): PlainObject | undefined {
  const normalized = normalizeHeaderEntries(entries)

  if (normalized.length === 0) {
    return undefined
  }

  const headers: PlainObject = {}

  for (const entry of normalized) {
    headers[entry.key] = entry.value
  }

  return headers
}

function readProviderModels(value: unknown): ProviderModelMapping[] {
  return normalizeProviderModels(
    asArray<PlainObject>(value).map((entry) => ({
      alias: readString(entry.alias) || readString(entry.name),
      name: readString(entry.name),
    })),
  )
}

function readProviderApiKeyEntries(value: unknown): ProviderApiKeyEntry[] {
  const deduped = new Map<string, ProviderApiKeyEntry>()

  for (const entry of asArray<PlainObject>(value)) {
    const apiKey = readString(entry['api-key']).trim()

    if (!apiKey) {
      continue
    }

    deduped.set(apiKey.toLowerCase(), {
      apiKey,
      proxyUrl: readString(entry['proxy-url']).trim(),
      headers: readHeaderEntries(entry.headers),
    })
  }

  return [...deduped.values()]
}

function buildProviderApiKeyEntries(entries: ProviderApiKeyEntry[]): PlainObject[] {
  return entries
    .map((entry) => {
      const apiKey = entry.apiKey.trim()

      if (!apiKey) {
        return null
      }

      const nextEntry: PlainObject = {
        'api-key': apiKey,
      }

      const proxyUrl = entry.proxyUrl.trim()

      if (proxyUrl) {
        nextEntry['proxy-url'] = proxyUrl
      } else {
        delete nextEntry['proxy-url']
      }

      const headers = buildHeadersObject(entry.headers)

      if (headers) {
        nextEntry.headers = headers
      } else {
        delete nextEntry.headers
      }

      return nextEntry
    })
    .filter((entry): entry is PlainObject => entry !== null)
}

function readProviderBaseFields(
  entry: PlainObject,
  index: number,
): Omit<ProviderKeyRecord, 'websockets' | 'index'> & { index: number } {
  return {
    index,
    apiKey: readString(entry['api-key']).trim(),
    priority: readOptionalNumber(entry.priority),
    prefix: readString(entry.prefix).trim(),
    baseUrl: readString(entry['base-url']).trim(),
    proxyUrl: readString(entry['proxy-url']).trim(),
    headers: readHeaderEntries(entry.headers),
    models: readProviderModels(entry.models),
    excludedModels: readStringArray(entry['excluded-models']),
  }
}

function readProviderKeySection(config: PlainObject, sectionName: string): ProviderKeyRecord[] {
  return asArray<PlainObject>(config[sectionName]).map((entry, index) => ({
    ...readProviderBaseFields(entry, index),
    websockets:
      typeof entry.websockets === 'boolean' ? readBoolean(entry.websockets) : null,
  }))
}

function readOpenAICompatibilityProviders(config: PlainObject): OpenAICompatibleProviderRecord[] {
  return asArray<PlainObject>(config['openai-compatibility']).map((entry, index) => ({
    index,
    name: readString(entry.name, `provider-${index + 1}`).trim(),
    prefix: readString(entry.prefix).trim(),
    baseUrl: readString(entry['base-url']).trim(),
    headers: readHeaderEntries(entry.headers),
    models: readProviderModels(entry.models),
    apiKeyEntries: readProviderApiKeyEntries(entry['api-key-entries']),
    priority: readOptionalNumber(entry.priority),
    testModel: readString(entry['test-model']).trim(),
  }))
}

function readAmpcodeConfig(config: PlainObject): AmpcodeConfigRecord | null {
  const ampcode = asObject(config.ampcode)

  if (Object.keys(ampcode).length === 0) {
    return null
  }

  return {
    upstreamUrl: readString(ampcode['upstream-url']).trim(),
    upstreamApiKey: readString(ampcode['upstream-api-key']).trim(),
    upstreamApiKeys: asArray<PlainObject>(ampcode['upstream-api-keys'])
      .map((entry) => {
        const upstreamApiKey = readString(entry['upstream-api-key']).trim()
        const apiKeys = readStringArray(entry['api-keys'])

        if (!upstreamApiKey || apiKeys.length === 0) {
          return null
        }

        return {
          upstreamApiKey,
          apiKeys,
        }
      })
      .filter((entry): entry is AmpcodeUpstreamApiKeyMappingRecord => entry !== null),
    modelMappings: asArray<PlainObject>(ampcode['model-mappings'])
      .map((entry) => {
        const from = readString(entry.from).trim()
        const to = readString(entry.to).trim()

        if (!from || !to) {
          return null
        }

        return {
          from,
          to,
        }
      })
      .filter((entry): entry is AmpcodeModelMappingRecord => entry !== null),
    forceModelMappings: readBoolean(ampcode['force-model-mappings'], false),
  }
}

function readAiProviders(config: PlainObject): AiProvidersState {
  return {
    gemini: readProviderKeySection(config, 'gemini-api-key'),
    codex: readProviderKeySection(config, 'codex-api-key'),
    claude: readProviderKeySection(config, 'claude-api-key'),
    vertex: readProviderKeySection(config, 'vertex-api-key'),
    openaiCompatibility: readOpenAICompatibilityProviders(config),
    ampcode: readAmpcodeConfig(config),
  }
}

function applyProviderBaseFields(
  baseEntry: PlainObject,
  input: {
    apiKey: string
    priority?: number | null
    prefix?: string
    baseUrl?: string
    proxyUrl?: string
    headers?: ProviderHeaderEntry[]
    models?: ProviderModelMapping[]
    excludedModels?: string[]
  },
): PlainObject {
  const nextEntry: PlainObject = {
    ...baseEntry,
    'api-key': input.apiKey.trim(),
  }

  if (typeof input.priority === 'number' && Number.isFinite(input.priority)) {
    nextEntry.priority = Math.trunc(input.priority)
  } else {
    delete nextEntry.priority
  }

  const prefix = readString(input.prefix).trim()

  if (prefix) {
    nextEntry.prefix = prefix
  } else {
    delete nextEntry.prefix
  }

  const baseUrl = readString(input.baseUrl).trim()

  if (baseUrl) {
    nextEntry['base-url'] = baseUrl
  } else {
    delete nextEntry['base-url']
  }

  const proxyUrl = readString(input.proxyUrl).trim()

  if (proxyUrl) {
    nextEntry['proxy-url'] = proxyUrl
  } else {
    delete nextEntry['proxy-url']
  }

  const headers = buildHeadersObject(input.headers ?? [])

  if (headers) {
    nextEntry.headers = headers
  } else {
    delete nextEntry.headers
  }

  const models = normalizeProviderModels(input.models ?? [])

  if (models.length > 0) {
    nextEntry.models = models
  } else {
    delete nextEntry.models
  }

  const excludedModels = readStringArray(input.excludedModels ?? [])

  if (excludedModels.length > 0) {
    nextEntry['excluded-models'] = excludedModels
  } else {
    delete nextEntry['excluded-models']
  }

  return nextEntry
}

function upsertSectionEntry(
  config: PlainObject,
  sectionName: string,
  index: number | undefined,
  nextEntry: PlainObject,
): void {
  const entries = asArray<PlainObject>(config[sectionName]).map((entry) => ({
    ...entry,
  }))

  if (typeof index === 'number' && index >= 0 && index < entries.length) {
    entries[index] = nextEntry
  } else {
    entries.push(nextEntry)
  }

  config[sectionName] = entries
}

function deleteSectionEntry(config: PlainObject, sectionName: string, index: number): void {
  const entries = asArray<PlainObject>(config[sectionName]).map((entry) => ({
    ...entry,
  }))

  if (index < 0 || index >= entries.length) {
    throw new Error('配置索引不存在。')
  }

  entries.splice(index, 1)

  if (entries.length === 0) {
    delete config[sectionName]
    return
  }

  config[sectionName] = entries
}

function applyAiProvider(config: PlainObject, input: SaveAiProviderInput): void {
  if (input.kind === 'ampcode') {
    const { config: ampcodeInput } = input
    const nextAmpcode: PlainObject = {
      ...asObject(config.ampcode),
    }

    const upstreamUrl = ampcodeInput.upstreamUrl.trim()
    const upstreamApiKey = ampcodeInput.upstreamApiKey.trim()
    const upstreamApiKeys = ampcodeInput.upstreamApiKeys
      .map((entry) => ({
        upstreamApiKey: entry.upstreamApiKey.trim(),
        apiKeys: readStringArray(entry.apiKeys),
      }))
      .filter((entry) => entry.upstreamApiKey && entry.apiKeys.length > 0)
    const modelMappings = ampcodeInput.modelMappings
      .map((entry) => ({
        from: entry.from.trim(),
        to: entry.to.trim(),
      }))
      .filter((entry) => entry.from && entry.to)

    if (!upstreamUrl && !upstreamApiKey && upstreamApiKeys.length === 0 && modelMappings.length === 0) {
      throw new Error('Ampcode 至少需要填写上游地址、上游 API Key、Key 映射或模型映射中的一项。')
    }

    if (upstreamUrl) {
      nextAmpcode['upstream-url'] = upstreamUrl
    } else {
      delete nextAmpcode['upstream-url']
    }

    if (upstreamApiKey) {
      nextAmpcode['upstream-api-key'] = upstreamApiKey
    } else {
      delete nextAmpcode['upstream-api-key']
    }

    if (upstreamApiKeys.length > 0) {
      nextAmpcode['upstream-api-keys'] = upstreamApiKeys.map((entry) => ({
        'upstream-api-key': entry.upstreamApiKey,
        'api-keys': entry.apiKeys,
      }))
    } else {
      delete nextAmpcode['upstream-api-keys']
    }

    if (modelMappings.length > 0) {
      nextAmpcode['model-mappings'] = modelMappings
    } else {
      delete nextAmpcode['model-mappings']
    }

    if (ampcodeInput.forceModelMappings) {
      nextAmpcode['force-model-mappings'] = true
    } else {
      delete nextAmpcode['force-model-mappings']
    }

    config.ampcode = nextAmpcode
    return
  }

  if (input.kind === 'openai-compatibility') {
    const providers = asArray<PlainObject>(config['openai-compatibility']).map((entry) => ({
      ...entry,
    }))
    const baseEntry =
      typeof input.index === 'number' && input.index >= 0 && input.index < providers.length
        ? providers[input.index]
        : {}
    const apiKeyEntries = buildProviderApiKeyEntries(input.apiKeyEntries ?? [])

    if (!input.name.trim() || !input.baseUrl.trim() || apiKeyEntries.length === 0) {
      throw new Error('OpenAI 兼容提供商需要名称、Base URL，且至少提供一个 API Key。')
    }

    const nextEntry: PlainObject = {
      ...baseEntry,
      name: input.name.trim(),
      'base-url': input.baseUrl.trim(),
      'schema-cleaner': readBoolean(baseEntry['schema-cleaner'], true),
      'api-key-entries': apiKeyEntries,
    }

    const prefix = readString(input.prefix).trim()
    if (prefix) nextEntry.prefix = prefix
    else delete nextEntry.prefix

    const headers = buildHeadersObject(input.headers ?? [])
    if (headers) nextEntry.headers = headers
    else delete nextEntry.headers

    const models = normalizeProviderModels(input.models ?? [])
    if (models.length > 0) nextEntry.models = models
    else delete nextEntry.models

    if (typeof input.priority === 'number' && Number.isFinite(input.priority)) {
      nextEntry.priority = Math.trunc(input.priority)
    } else {
      delete nextEntry.priority
    }

    const testModel = readString(input.testModel).trim()
    if (testModel) nextEntry['test-model'] = testModel
    else delete nextEntry['test-model']

    if (typeof input.index === 'number' && input.index >= 0 && input.index < providers.length) {
      providers[input.index] = nextEntry
    } else {
      providers.push(nextEntry)
    }

    config['openai-compatibility'] = providers
    return
  }

  const sectionName =
    input.kind === 'gemini'
      ? 'gemini-api-key'
      : input.kind === 'codex'
        ? 'codex-api-key'
        : input.kind === 'claude'
          ? 'claude-api-key'
          : 'vertex-api-key'
  const baseEntries = asArray<PlainObject>(config[sectionName]).map((entry) => ({
    ...entry,
  }))
  const baseEntry =
    typeof input.index === 'number' && input.index >= 0 && input.index < baseEntries.length
      ? baseEntries[input.index]
      : {}

  if (!input.apiKey.trim()) {
    throw new Error('API Key 不能为空。')
  }

  const nextEntry = applyProviderBaseFields(baseEntry, input)

  if (input.kind !== 'gemini') {
    if (input.websockets) {
      nextEntry.websockets = true
    } else {
      delete nextEntry.websockets
    }
  }

  upsertSectionEntry(config, sectionName, input.index, nextEntry)
}

function deleteAiProvider(config: PlainObject, input: DeleteAiProviderInput): void {
  if (input.kind === 'ampcode') {
    delete config.ampcode
    return
  }

  if (typeof input.index !== 'number') {
    throw new Error('缺少要删除的配置索引。')
  }

  const sectionName =
    input.kind === 'gemini'
      ? 'gemini-api-key'
      : input.kind === 'codex'
        ? 'codex-api-key'
        : input.kind === 'claude'
          ? 'claude-api-key'
          : input.kind === 'vertex'
            ? 'vertex-api-key'
            : 'openai-compatibility'

  deleteSectionEntry(config, sectionName, input.index)
}

function aiProviderKindLabel(kind: DeleteAiProviderInput['kind']): string {
  switch (kind) {
    case 'gemini':
      return 'Gemini API 密钥'
    case 'codex':
      return 'Codex API 配置'
    case 'claude':
      return 'Claude API 配置'
    case 'vertex':
      return 'Vertex API 配置'
    case 'openai-compatibility':
      return 'OpenAI 兼容提供商'
    case 'ampcode':
      return 'Ampcode'
    default:
      return kind
  }
}

function readProviders(config: PlainObject): ProviderRecord[] {
  return asArray<PlainObject>(config['openai-compatibility']).map((entry, index) => {
    const apiKeyEntries = asArray<PlainObject>(entry['api-key-entries'])
    const firstApiKeyEntry = asObject(apiKeyEntries[0])

    return {
      index,
      name: readString(entry.name, `provider-${index + 1}`),
      baseUrl: readString(entry['base-url']),
      apiKey: readString(firstApiKeyEntry['api-key']),
      models: asArray<PlainObject>(entry.models).map((modelEntry) => ({
        alias: readString(modelEntry.alias) || readString(modelEntry.name),
        name: readString(modelEntry.name),
      })),
    }
  })
}

function applyProvider(config: PlainObject, input: SaveProviderInput): void {
  const providers = asArray<PlainObject>(config['openai-compatibility']).map((entry) => ({
    ...entry,
  }))

  const normalizedModels = normalizeProviderModels(input.models)
  const baseEntry =
    typeof input.index === 'number' && input.index >= 0 && input.index < providers.length
      ? providers[input.index]
      : {}

  const nextEntry: PlainObject = {
    ...baseEntry,
    name: input.name.trim(),
    'base-url': input.baseUrl.trim(),
    'schema-cleaner': readBoolean(baseEntry['schema-cleaner'], true),
    'api-key-entries': [
      {
        'api-key': input.apiKey.trim(),
      },
    ],
  }

  if (normalizedModels.length > 0) {
    nextEntry.models = normalizedModels
  } else {
    delete nextEntry.models
  }

  if (typeof input.index === 'number' && input.index >= 0 && input.index < providers.length) {
    providers[input.index] = nextEntry
  } else {
    providers.push(nextEntry)
  }

  config['openai-compatibility'] = providers
}

function deleteProviderAtIndex(config: PlainObject, index: number): void {
  const providers = asArray<PlainObject>(config['openai-compatibility'])

  if (index < 0 || index >= providers.length) {
    throw new Error('提供商索引不存在。')
  }

  providers.splice(index, 1)

  if (providers.length === 0) {
    delete config['openai-compatibility']
    return
  }

  config['openai-compatibility'] = providers
}

function parsePersistedLogLine(line: string): LogEntry | null {
  const match = line.match(/^\[(.+?)\] \[(.+?)\/(.+?)\] (.*)$/)

  if (!match) {
    return null
  }

  const [, timestamp, source, level, message] = match
  const normalizedLevel = level.toLowerCase() as LogLevel

  if (!['info', 'warn', 'error', 'debug'].includes(normalizedLevel)) {
    return null
  }

  if (source !== 'app' && source !== 'proxy') {
    return null
  }

  return {
    timestamp,
    level: normalizedLevel,
    source: source as 'app' | 'proxy',
    message,
  }
}

async function readPersistedLogs(): Promise<LogEntry[]> {
  const logPath = path.join(resolvePaths().logsDir, MAIN_LOG_NAME)

  try {
    const raw = await fs.readFile(logPath, 'utf8')
    return raw
      .split(/\r?\n/)
      .map((line) => parsePersistedLogLine(line))
      .filter((entry): entry is LogEntry => entry !== null)
      .slice(-MAX_LOG_ENTRIES)
  } catch {
    return []
  }
}

async function appendLog(
  level: LogLevel,
  source: 'app' | 'proxy',
  message: string,
): Promise<void> {
  const normalizedLines = message
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)

  if (normalizedLines.length === 0) {
    return
  }

  const entries = normalizedLines.map<LogEntry>((line) => ({
    timestamp: new Date().toISOString(),
    level,
    source,
    message: line,
  }))

  logBuffer.push(...entries)

  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES)
  }

  const logPath = path.join(resolvePaths().logsDir, MAIN_LOG_NAME)
  const serialized = entries
    .map((entry) => `[${entry.timestamp}] [${entry.source}/${entry.level}] ${entry.message}`)
    .join('\n')

  void fs.appendFile(logPath, `${serialized}\n`, 'utf8')
  emitToRenderer(LOGS_UPDATED_EVENT, entries)
}

function emitToRenderer(channel: string, payload?: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send(channel, payload)
}

function scheduleStateChanged(): void {
  if (stateChangeTimer) {
    clearTimeout(stateChangeTimer)
  }

  stateChangeTimer = setTimeout(() => {
    updateTrayContextMenu()
    emitToRenderer(STATE_CHANGED_EVENT)
    stateChangeTimer = null
  }, 180)
}

function detectProviderFromFileName(fileName: string): string {
  const normalized = fileName.toLowerCase()

  if (normalized.includes('gemini')) {
    return 'gemini'
  }

  if (normalized.includes('codex')) {
    return 'codex'
  }

  if (normalized.includes('openai') || normalized.includes('chatgpt') || normalized.includes('gpt')) {
    return 'openai'
  }

  if (normalized.includes('claude')) {
    return 'claude'
  }

  if (normalized.includes('vertex')) {
    return 'vertex'
  }

  if (normalized.includes('qwen')) {
    return 'qwen'
  }

  if (normalized.includes('iflow')) {
    return 'iflow'
  }

  if (normalized.includes('kimi')) {
    return 'kimi'
  }

  if (normalized.includes('kiro')) {
    return 'kiro'
  }

  if (normalized.includes('copilot')) {
    return 'copilot'
  }

  if (normalized.includes('antigravity')) {
    return 'antigravity'
  }

  return 'unknown'
}

function getProviderImportLabel(providerId: string): string {
  return PROVIDER_IMPORTS.find((entry) => entry.id === providerId)?.label ?? '其他'
}

function normalizeAuthProviderHint(value: unknown): string | null {
  const raw = normalizeStringValue(value)

  if (!raw) {
    return null
  }

  const normalized = raw.toLowerCase()

  if (!normalized) {
    return null
  }

  if (normalized.includes('anthropic') || normalized.includes('claude')) {
    return 'claude'
  }

  if (normalized.includes('codex')) {
    return 'codex'
  }

  if (normalized.includes('openai') || normalized.includes('chatgpt')) {
    return 'openai'
  }

  if (normalized.includes('gemini')) {
    return 'gemini'
  }

  if (normalized.includes('vertex')) {
    return 'vertex'
  }

  if (normalized.includes('qwen')) {
    return 'qwen'
  }

  if (normalized.includes('iflow')) {
    return 'iflow'
  }

  if (normalized.includes('kimi')) {
    return 'kimi'
  }

  if (normalized.includes('kiro')) {
    return 'kiro'
  }

  if (normalized.includes('copilot')) {
    return 'copilot'
  }

  if (normalized.includes('antigravity')) {
    return 'antigravity'
  }

  return null
}

function payloadContainsAuthHints(payload: PlainObject): boolean {
  return Boolean(
    normalizeStringValue(payload.access_token) ||
      normalizeStringValue(payload.refresh_token) ||
      normalizeStringValue(payload.id_token) ||
      normalizeStringValue(payload.session_token) ||
      normalizeStringValue(payload.client_secret) ||
      normalizeStringValue(payload.private_key) ||
      normalizeStringValue(payload.private_key_id) ||
      normalizeStringValue(payload.device_code) ||
      normalizeStringValue(payload.BXAuth) ||
      normalizeStringValue(payload.bxauth) ||
      normalizeStringValue(payload.chatgpt_account_id) ||
      normalizeStringValue(payload.chatgptAccountId) ||
      normalizeStringValue(payload.workspace_id) ||
      normalizeStringValue(payload.workspaceId) ||
      normalizeStringValue(payload.account_id) ||
      normalizeStringValue(payload.accountId),
  )
}

function looksLikeAuthFilePayload(fileName: string, payload: PlainObject | null): boolean {
  if (!payload) {
    return false
  }

  const metadata = asObject(payload.metadata)
  const attributes = asObject(payload.attributes)
  const tokens = asObject(payload.tokens)
  const account = asObject(payload.account)
  const user = asObject(payload.user)
  const installed = asObject(payload.installed)
  const web = asObject(payload.web)
  const cookies = asObject(payload.cookies)
  const providerHints = [
    normalizeAuthProviderHint(detectProviderFromFileName(fileName)),
    normalizeAuthProviderHint(payload.type),
    normalizeAuthProviderHint(payload.provider),
    normalizeAuthProviderHint(metadata.type),
    normalizeAuthProviderHint(metadata.provider),
    normalizeAuthProviderHint(attributes.type),
    normalizeAuthProviderHint(attributes.provider),
  ].filter(Boolean)
  const payloadObjects = [payload, metadata, attributes, tokens, account, user, installed, web, cookies]
  const hasAuthHints = payloadObjects.some((entry) => payloadContainsAuthHints(entry))
  const hasGoogleCredentialShape = Boolean(
    (normalizeStringValue(payload.type) === 'service_account' ||
      normalizeStringValue(payload.type) === 'authorized_user' ||
      normalizeStringValue(payload.client_email) ||
      normalizeStringValue(installed.client_email) ||
      normalizeStringValue(web.client_email)) &&
      (normalizeStringValue(payload.private_key) ||
        normalizeStringValue(payload.private_key_id) ||
        normalizeStringValue(payload.client_secret) ||
        normalizeStringValue(payload.refresh_token)),
  )
  const hasCookieAuth = Boolean(
    normalizeStringValue(payload.BXAuth) ||
      normalizeStringValue(payload.bxauth) ||
      normalizeStringValue(cookies.BXAuth) ||
      normalizeStringValue(cookies.bxauth),
  )
  const hasAccountIdentity = Boolean(
    normalizeStringValue(payload.email) ||
      normalizeStringValue(account.email) ||
      normalizeStringValue(user.email) ||
      normalizeStringValue(payload.account) ||
      normalizeStringValue(account.name) ||
      normalizeStringValue(account.display_name) ||
      normalizeStringValue(user.name) ||
      normalizeStringValue(user.display_name) ||
      resolveCodexChatgptAccountIdFromPayload(payload) ||
      resolveCodexPlanTypeFromPayload(payload) ||
      resolveGeminiCliProjectIdFromPayload(payload) ||
      normalizeStringValue(payload.client_email) ||
      normalizeStringValue(installed.client_email) ||
      normalizeStringValue(web.client_email),
  )

  return (
    hasAuthHints ||
    hasGoogleCredentialShape ||
    hasCookieAuth ||
    (providerHints.length > 0 && hasAccountIdentity)
  )
}

function isCandidateAuthFileName(fileName: string): boolean {
  const normalized = fileName.toLowerCase()
  return normalized.endsWith('.json') || normalized.endsWith('.disabled.json') || normalized.endsWith('.json.disabled')
}

function buildAuthWatchPatterns(): string[] {
  const { authDir } = resolvePaths()
  return [
    path.join(authDir, '*.json'),
    path.join(authDir, '*.disabled.json'),
    path.join(authDir, '*.json.disabled'),
  ]
}

function isDisabledAuthFile(fileName: string): boolean {
  const normalized = fileName.toLowerCase()
  return normalized.endsWith('.disabled.json') || normalized.endsWith('.json.disabled')
}

function toEnabledAuthName(fileName: string): string {
  if (fileName.toLowerCase().endsWith('.disabled.json')) {
    return `${fileName.slice(0, -'.disabled.json'.length)}.json`
  }

  if (fileName.toLowerCase().endsWith('.json.disabled')) {
    return fileName.slice(0, -'.disabled'.length)
  }

  return fileName
}

function toDisabledAuthName(fileName: string): string {
  if (isDisabledAuthFile(fileName)) {
    return fileName
  }

  if (fileName.toLowerCase().endsWith('.json')) {
    return `${fileName.slice(0, -'.json'.length)}.disabled.json`
  }

  return `${fileName}.disabled`
}

function stripDisabledMarker(fileName: string): string {
  return toEnabledAuthName(fileName)
}

function formatDisplayTimestamp(value: string | null): string | null {
  if (!value) {
    return null
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toLocaleString('zh-CN', { hour12: false })
}

function pushAuthFileDetail(
  details: AuthFileDetailItem[],
  label: string,
  value: string | null | undefined,
): void {
  const normalizedValue = normalizeStringValue(value)

  if (!normalizedValue) {
    return
  }

  if (details.some((item) => item.label === label && item.value === normalizedValue)) {
    return
  }

  details.push({
    label,
    value: normalizedValue,
  })
}

function parseObjectLikeValue(value: unknown): PlainObject | null {
  const parsed = parseIdTokenPayload(value)
  return parsed && Object.keys(parsed).length > 0 ? parsed : null
}

function pushUniquePlainObject(
  target: PlainObject[],
  candidate: PlainObject | null | undefined,
): void {
  if (!candidate || Object.keys(candidate).length === 0) {
    return
  }

  if (target.some((entry) => entry === candidate)) {
    return
  }

  target.push(candidate)
}

function readCodexNamedAccountId(candidate: PlainObject): string | null {
  const nestedAccount = asObject(candidate.account)
  const nestedWorkspace = asObject(candidate.workspace)
  const authClaim = parseObjectLikeValue(candidate['https://api.openai.com/auth'])

  return (
    normalizeStringValue(candidate.chatgpt_account_id) ||
    normalizeStringValue(candidate.chatgptAccountId) ||
    normalizeStringValue(candidate.account_id) ||
    normalizeStringValue(candidate.accountId) ||
    normalizeStringValue(candidate.workspace_id) ||
    normalizeStringValue(candidate.workspaceId) ||
    normalizeStringValue(nestedAccount.chatgpt_account_id) ||
    normalizeStringValue(nestedAccount.chatgptAccountId) ||
    normalizeStringValue(nestedAccount.account_id) ||
    normalizeStringValue(nestedAccount.accountId) ||
    normalizeStringValue(nestedAccount.workspace_id) ||
    normalizeStringValue(nestedAccount.workspaceId) ||
    normalizeStringValue(nestedWorkspace.chatgpt_account_id) ||
    normalizeStringValue(nestedWorkspace.chatgptAccountId) ||
    normalizeStringValue(nestedWorkspace.account_id) ||
    normalizeStringValue(nestedWorkspace.accountId) ||
    normalizeStringValue(nestedWorkspace.workspace_id) ||
    normalizeStringValue(nestedWorkspace.workspaceId) ||
    normalizeStringValue(authClaim?.chatgpt_account_id) ||
    normalizeStringValue(authClaim?.chatgptAccountId) ||
    normalizeStringValue(authClaim?.account_id) ||
    normalizeStringValue(authClaim?.accountId) ||
    normalizeStringValue(authClaim?.workspace_id) ||
    normalizeStringValue(authClaim?.workspaceId) ||
    null
  )
}

function collectCodexPayloadObjects(payload: PlainObject): PlainObject[] {
  const metadata = asObject(payload.metadata)
  const attributes = asObject(payload.attributes)
  const tokens = asObject(payload.tokens)
  const candidates: unknown[] = [
    payload,
    metadata,
    attributes,
    tokens,
    payload.id_token,
    payload.access_token,
    payload.token,
    payload.session_token,
    payload.auth_info,
    metadata.id_token,
    metadata.access_token,
    metadata.token,
    metadata.session_token,
    metadata.auth_info,
    attributes.id_token,
    attributes.access_token,
    attributes.token,
    attributes.session_token,
    attributes.auth_info,
    tokens.id_token,
    tokens.access_token,
    tokens.token,
    tokens.session_token,
    tokens.auth_info,
    payload['https://api.openai.com/auth'],
    metadata['https://api.openai.com/auth'],
    attributes['https://api.openai.com/auth'],
    tokens['https://api.openai.com/auth'],
  ]
  const objects: PlainObject[] = []

  for (const candidate of candidates) {
    pushUniquePlainObject(objects, parseObjectLikeValue(candidate))
  }

  return objects
}

function resolveCodexChatgptAccountIdFromPayload(payload: PlainObject): string | null {
  const candidates = collectCodexPayloadObjects(payload)

  for (const candidate of candidates) {
    const accountId = readCodexNamedAccountId(candidate)

    if (accountId) {
      return accountId
    }
  }

  return null
}

function resolveCodexAccountIdFromEntry(
  entry: PlainObject,
  fallbackKey: string | null = null,
): string | null {
  const nestedAccount = asObject(entry.account)

  return (
    readCodexNamedAccountId(entry) ||
    readCodexNamedAccountId(nestedAccount) ||
    normalizeStringValue(entry.id) ||
    normalizeStringValue(nestedAccount.id) ||
    fallbackKey
  )
}

function isCodexAccountEntryPreferred(entry: PlainObject): boolean {
  return (
    readBoolean(entry.selected, false) ||
    readBoolean(entry.is_selected, false) ||
    readBoolean(entry.isSelected, false) ||
    readBoolean(entry.current, false) ||
    readBoolean(entry.is_current, false) ||
    readBoolean(entry.isCurrent, false) ||
    readBoolean(entry.active, false) ||
    readBoolean(entry.is_active, false) ||
    readBoolean(entry.isActive, false) ||
    readBoolean(entry.default, false) ||
    readBoolean(entry.is_default, false) ||
    readBoolean(entry.isDefault, false)
  )
}

function isCodexAccountEntryUnavailable(entry: PlainObject): boolean {
  const status = normalizeStringValue(entry.status)?.toLowerCase()

  return (
    readBoolean(entry.disabled, false) ||
    readBoolean(entry.suspended, false) ||
    status === 'disabled' ||
    status === 'inactive' ||
    status === 'suspended'
  )
}

function resolveCodexChatgptAccountIdFromAccountsPayload(payload: unknown): string | null {
  const root = asObject(payload)
  const directCandidates = [
    readCodexNamedAccountId(root),
    normalizeStringValue(root.default_workspace_id),
    normalizeStringValue(root.defaultWorkspaceId),
    normalizeStringValue(root.current_account_id),
    normalizeStringValue(root.currentAccountId),
    normalizeStringValue(root.active_account_id),
    normalizeStringValue(root.activeAccountId),
    normalizeStringValue(root.default_account_id),
    normalizeStringValue(root.defaultAccountId),
    resolveCodexAccountIdFromEntry(asObject(root.account)),
    resolveCodexAccountIdFromEntry(asObject(root.active_account)),
    resolveCodexAccountIdFromEntry(asObject(root.current_account)),
    resolveCodexAccountIdFromEntry(asObject(root.default_account)),
  ]

  for (const candidate of directCandidates) {
    if (candidate) {
      return candidate
    }
  }

  const accounts: Array<{ entry: PlainObject; fallbackKey: string | null }> = []
  const accountMap = asObject(root.accounts)

  for (const [key, value] of Object.entries(accountMap)) {
    accounts.push({
      entry: asObject(value),
      fallbackKey: normalizeStringValue(key),
    })
  }

  for (const value of asArray<PlainObject>(root.accounts)) {
    accounts.push({
      entry: asObject(value),
      fallbackKey: null,
    })
  }

  const preferredAccount = accounts.find(
    ({ entry, fallbackKey }) =>
      !isCodexAccountEntryUnavailable(entry) &&
      isCodexAccountEntryPreferred(entry) &&
      resolveCodexAccountIdFromEntry(entry, fallbackKey),
  )

  if (preferredAccount) {
    return resolveCodexAccountIdFromEntry(
      preferredAccount.entry,
      preferredAccount.fallbackKey,
    )
  }

  const availableAccount = accounts.find(
    ({ entry, fallbackKey }) =>
      !isCodexAccountEntryUnavailable(entry) &&
      resolveCodexAccountIdFromEntry(entry, fallbackKey),
  )

  if (availableAccount) {
    return resolveCodexAccountIdFromEntry(
      availableAccount.entry,
      availableAccount.fallbackKey,
    )
  }

  const anyAccount = accounts.find(
    ({ entry, fallbackKey }) => resolveCodexAccountIdFromEntry(entry, fallbackKey),
  )

  if (anyAccount) {
    return resolveCodexAccountIdFromEntry(anyAccount.entry, anyAccount.fallbackKey)
  }

  return null
}

function resolveCodexPlanTypeFromPayload(payload: PlainObject): string | null {
  const metadata = asObject(payload.metadata)
  const attributes = asObject(payload.attributes)
  const payloadIdToken = parseIdTokenPayload(payload.id_token)
  const metadataIdToken = parseIdTokenPayload(metadata.id_token)
  const attributeIdToken = parseIdTokenPayload(attributes.id_token)

  return (
    normalizePlanType(payload.plan_type) ||
    normalizePlanType(payload.planType) ||
    normalizePlanType(payloadIdToken?.plan_type) ||
    normalizePlanType(payloadIdToken?.planType) ||
    normalizePlanType(metadata.plan_type) ||
    normalizePlanType(metadata.planType) ||
    normalizePlanType(metadataIdToken?.plan_type) ||
    normalizePlanType(metadataIdToken?.planType) ||
    normalizePlanType(attributes.plan_type) ||
    normalizePlanType(attributes.planType) ||
    normalizePlanType(attributeIdToken?.plan_type) ||
    normalizePlanType(attributeIdToken?.planType) ||
    null
  )
}

function resolveGeminiCliProjectIdFromPayload(payload: PlainObject): string | null {
  const metadata = asObject(payload.metadata)
  const attributes = asObject(payload.attributes)
  const accountCandidates = [
    payload.account,
    metadata.account,
    attributes.account,
    payload.project_id,
    payload.projectId,
    asObject(payload.installed).project_id,
    asObject(payload.installed).projectId,
    asObject(payload.web).project_id,
    asObject(payload.web).projectId,
  ]

  for (const candidate of accountCandidates) {
    const direct = normalizeStringValue(candidate)

    if (direct) {
      const matches = Array.from(direct.matchAll(/\(([^()]+)\)/g))
      const projectInParens = matches.at(-1)?.[1]?.trim()

      if (projectInParens) {
        return projectInParens
      }
    }

    const normalized = normalizeStringValue(candidate)

    if (normalized && !normalized.includes('@') && !normalized.includes(' ')) {
      return normalized
    }
  }

  return null
}

function resolveAntigravityProjectIdFromPayload(payload: PlainObject): string {
  return (
    normalizeStringValue(payload.project_id) ||
    normalizeStringValue(payload.projectId) ||
    normalizeStringValue(asObject(payload.installed).project_id) ||
    normalizeStringValue(asObject(payload.installed).projectId) ||
    normalizeStringValue(asObject(payload.web).project_id) ||
    normalizeStringValue(asObject(payload.web).projectId) ||
    DEFAULT_ANTIGRAVITY_PROJECT_ID
  )
}

function buildLocalAuthFileDetails(
  payload: PlainObject | null,
  provider: string,
  type: string,
): { detailItems: AuthFileDetailItem[]; planType: string | null } {
  const details: AuthFileDetailItem[] = []

  if (!payload) {
    return {
      detailItems: details,
      planType: null,
    }
  }

  const metadata = asObject(payload.metadata)
  const attributes = asObject(payload.attributes)
  const accountObject = asObject(payload.account)
  const userObject = asObject(payload.user)
  const organizationObject = asObject(payload.organization)
  const installed = asObject(payload.installed)
  const web = asObject(payload.web)

  const email =
    normalizeStringValue(payload.email) ||
    normalizeStringValue(accountObject.email) ||
    normalizeStringValue(userObject.email) ||
    normalizeStringValue(installed.client_email) ||
    normalizeStringValue(payload.client_email) ||
    null
  const account =
    normalizeStringValue(payload.account) ||
    normalizeStringValue(payload.username) ||
    normalizeStringValue(payload.name) ||
    normalizeStringValue(accountObject.name) ||
    normalizeStringValue(accountObject.display_name) ||
    normalizeStringValue(userObject.name) ||
    normalizeStringValue(userObject.display_name) ||
    null
  const organization =
    normalizeStringValue(organizationObject.name) ||
    normalizeStringValue(payload.organization_name) ||
    null
  const planType =
    resolveCodexPlanTypeFromPayload(payload) ||
    normalizePlanType(payload.plan_type) ||
    normalizePlanType(payload.planType) ||
    null
  const chatgptAccountId = resolveCodexChatgptAccountIdFromPayload(payload)
  const geminiProjectId = resolveGeminiCliProjectIdFromPayload(payload)
  const antigravityProjectId = resolveAntigravityProjectIdFromPayload(payload)

  pushAuthFileDetail(details, '文件类型', type)
  pushAuthFileDetail(details, '邮箱', email)
  pushAuthFileDetail(details, '账户', account)
  pushAuthFileDetail(details, '组织', organization)
  pushAuthFileDetail(details, '套餐', planType)

  if (provider === 'codex' || type === 'codex' || provider === 'openai') {
    pushAuthFileDetail(details, 'ChatGPT 账户 ID', chatgptAccountId)
  }

  if (provider === 'gemini' || type === 'gemini-cli') {
    pushAuthFileDetail(details, '项目 ID', geminiProjectId)
  }

  if (provider === 'antigravity' || type === 'antigravity') {
    pushAuthFileDetail(details, '项目 ID', antigravityProjectId)
  }

  pushAuthFileDetail(
    details,
    '标签',
    normalizeStringValue(payload.label) || normalizeStringValue(metadata.label),
  )
  pushAuthFileDetail(
    details,
    '备注',
    normalizeStringValue(payload.note) || normalizeStringValue(attributes.note),
  )
  pushAuthFileDetail(
    details,
    '优先级',
    normalizeStringValue(payload.priority) || normalizeStringValue(attributes.priority),
  )
  pushAuthFileDetail(
    details,
    '服务账号',
    normalizeStringValue(installed.client_email) || normalizeStringValue(web.client_email),
  )

  return {
    detailItems: details,
    planType,
  }
}

async function readAuthFilePayload(fullPath: string): Promise<PlainObject | null> {
  try {
    const raw = await fs.readFile(fullPath, 'utf8')
    const normalized = raw.replace(/^\uFEFF/, '').trim()

    if (!normalized) {
      return null
    }

    const parsed = JSON.parse(normalized)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as PlainObject)
      : null
  } catch {
    return null
  }
}

async function buildLocalAuthFileRecord(entry: { name: string }, fullPath: string): Promise<AuthFileRecord> {
  const stats = await fs.stat(fullPath)
  const provider = detectProviderFromFileName(entry.name)
  const payload = await readAuthFilePayload(fullPath)
  const payloadType =
    normalizeStringValue(payload?.type) ||
    normalizeStringValue(payload?.provider) ||
    provider
  const type = payloadType ? payloadType.toLowerCase() : provider
  const details = buildLocalAuthFileDetails(payload, provider, type)

  return {
    name: entry.name,
    displayName: stripDisabledMarker(entry.name),
    path: fullPath,
    provider,
    type,
    enabled: !isDisabledAuthFile(entry.name),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    authIndex: null,
    label: null,
    source: null,
    status: null,
    statusMessage: null,
    runtimeOnly: false,
    unavailable: false,
    createdAt: null,
    updatedAt: null,
    successCount: 0,
    failureCount: 0,
    totalRequests: 0,
    lastUsedAt: null,
    planType: details.planType,
    detailItems: details.detailItems,
  }
}

const EMPTY_AUTH_FILE_USAGE_STATS: AuthFileUsageStats = {
  totalRequests: 0,
  successCount: 0,
  failureCount: 0,
  lastUsedAt: null,
}

function mergeAuthFileDetailItems(...groups: AuthFileDetailItem[][]): AuthFileDetailItem[] {
  const merged: AuthFileDetailItem[] = []
  const seen = new Set<string>()

  for (const group of groups) {
    for (const item of group) {
      const label = item.label.trim()
      const value = item.value.trim()

      if (!label || !value) {
        continue
      }

      const key = `${label}\u0000${value}`

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      merged.push({ label, value })
    }
  }

  return merged
}

function normalizeRemoteAuthFileBaseName(value: unknown): string | null {
  const rawValue = normalizeStringValue(value)

  if (!rawValue) {
    return null
  }

  const normalized = rawValue.replace(/[\\/]+/g, '/').trim()
  const baseName = normalized.split('/').at(-1)?.trim()

  return baseName || null
}

function extractRemoteAuthFileEntries(payload: unknown): PlainObject[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => asObject(entry))
      .filter((entry) => Object.keys(entry).length > 0)
  }

  const root = asObject(payload)
  const candidates = [
    root.files,
    root.auth_files,
    root.authFiles,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((entry) => asObject(entry))
        .filter((entry) => Object.keys(entry).length > 0)
    }
  }

  return []
}

function indexRemoteAuthFilesByName(entries: PlainObject[]): Map<string, PlainObject> {
  const indexed = new Map<string, PlainObject>()

  for (const entry of entries) {
    const candidates = [
      normalizeRemoteAuthFileBaseName(entry.name),
      normalizeRemoteAuthFileBaseName(entry.id),
      normalizeRemoteAuthFileBaseName(entry.path),
    ].filter((value): value is string => Boolean(value))

    for (const candidate of candidates) {
      indexed.set(candidate.toLowerCase(), entry)
    }
  }

  return indexed
}

function pickLaterTimestamp(current: string | null, next: string | null): string | null {
  if (!current) {
    return next
  }

  if (!next) {
    return current
  }

  const currentTime = Date.parse(current)
  const nextTime = Date.parse(next)

  if (!Number.isFinite(currentTime)) {
    return next
  }

  if (!Number.isFinite(nextTime)) {
    return current
  }

  return nextTime > currentTime ? next : current
}

function collectUsageStatsByAuthIndex(payload: unknown): Map<string, AuthFileUsageStats> {
  const usageRoot = asObject(asObject(payload).usage)
  const root = Object.keys(usageRoot).length > 0 ? usageRoot : asObject(payload)
  const apis = asObject(root.apis)
  const statsByAuthIndex = new Map<string, AuthFileUsageStats>()

  const ensureStats = (authIndex: string): AuthFileUsageStats => {
    const existing = statsByAuthIndex.get(authIndex)

    if (existing) {
      return existing
    }

    const created = { ...EMPTY_AUTH_FILE_USAGE_STATS }
    statsByAuthIndex.set(authIndex, created)
    return created
  }

  for (const apiEntry of Object.values(apis)) {
    const models = asObject(asObject(apiEntry).models)

    for (const modelEntry of Object.values(models)) {
      const details = asArray<PlainObject>(asObject(modelEntry).details)

      for (const detail of details) {
        const authIndex = normalizeAuthIndex(detail.auth_index ?? detail.authIndex)

        if (!authIndex) {
          continue
        }

        const stats = ensureStats(authIndex)
        const failed = readBoolean(detail.failed, false)
        const timestamp = normalizeStringValue(detail.timestamp)

        stats.totalRequests += 1
        stats.successCount += failed ? 0 : 1
        stats.failureCount += failed ? 1 : 0
        stats.lastUsedAt = pickLaterTimestamp(stats.lastUsedAt, timestamp)
      }
    }
  }

  return statsByAuthIndex
}

function buildRemoteAuthFileDetails(
  entry: PlainObject,
  provider: string,
  type: string,
): { detailItems: AuthFileDetailItem[]; planType: string | null } {
  const base = buildLocalAuthFileDetails(entry, provider, type)
  const details = [...base.detailItems]

  pushAuthFileDetail(details, '认证索引', normalizeAuthIndex(entry.auth_index ?? entry.authIndex))
  pushAuthFileDetail(details, '标签', normalizeStringValue(entry.label))
  pushAuthFileDetail(details, '来源', normalizeStringValue(entry.source))
  pushAuthFileDetail(details, '状态', normalizeStringValue(entry.status))
  pushAuthFileDetail(
    details,
    '状态说明',
    normalizeStringValue(entry.status_message ?? entry.statusMessage),
  )
  pushAuthFileDetail(
    details,
    '创建时间',
    formatDisplayTimestamp(normalizeStringValue(entry.created_at ?? entry.createdAt)),
  )
  pushAuthFileDetail(
    details,
    '更新时间',
    formatDisplayTimestamp(
      normalizeStringValue(entry.updated_at ?? entry.updatedAt ?? entry.modtime),
    ),
  )

  return {
    detailItems: details,
    planType: base.planType,
  }
}

function mergeRemoteAuthFileRecord(
  localRecord: AuthFileRecord,
  remoteEntry: PlainObject | null,
  usageStatsByAuthIndex: Map<string, AuthFileUsageStats>,
): AuthFileRecord {
  if (!remoteEntry) {
    return localRecord
  }

  const provider =
    normalizeStringValue(remoteEntry.provider)?.toLowerCase() || localRecord.provider
  const type =
    normalizeStringValue(remoteEntry.type)?.toLowerCase() || localRecord.type
  const authIndex = normalizeAuthIndex(remoteEntry.auth_index ?? remoteEntry.authIndex)
  const usageStats = authIndex
    ? usageStatsByAuthIndex.get(authIndex) ?? EMPTY_AUTH_FILE_USAGE_STATS
    : EMPTY_AUTH_FILE_USAGE_STATS
  const remoteDetails = buildRemoteAuthFileDetails(remoteEntry, provider, type)

  return {
    ...localRecord,
    provider,
    type,
    authIndex,
    label: normalizeStringValue(remoteEntry.label) || localRecord.label,
    source: normalizeStringValue(remoteEntry.source) || localRecord.source,
    status: normalizeStringValue(remoteEntry.status) || localRecord.status,
    statusMessage:
      normalizeStringValue(remoteEntry.status_message ?? remoteEntry.statusMessage) ||
      localRecord.statusMessage,
    runtimeOnly: readBoolean(remoteEntry.runtime_only ?? remoteEntry.runtimeOnly, localRecord.runtimeOnly),
    unavailable: readBoolean(remoteEntry.unavailable, localRecord.unavailable),
    createdAt:
      normalizeStringValue(remoteEntry.created_at ?? remoteEntry.createdAt) ||
      localRecord.createdAt,
    updatedAt:
      normalizeStringValue(remoteEntry.updated_at ?? remoteEntry.updatedAt ?? remoteEntry.modtime) ||
      localRecord.updatedAt,
    successCount: usageStats.successCount,
    failureCount: usageStats.failureCount,
    totalRequests: usageStats.totalRequests,
    lastUsedAt: usageStats.lastUsedAt,
    planType: remoteDetails.planType || localRecord.planType,
    detailItems: mergeAuthFileDetailItems(localRecord.detailItems, remoteDetails.detailItems),
  }
}

function resolveInsideDirectory(directory: string, fileName: string): string {
  const base = path.resolve(directory)
  const target = path.resolve(directory, fileName)

  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error('目标文件不在允许的目录内。')
  }

  return target
}

async function listAuthFiles(): Promise<AuthFileRecord[]> {
  const { authDir } = resolvePaths()
  await fs.mkdir(authDir, { recursive: true })

  const entries = await fs.readdir(authDir, { withFileTypes: true })
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isCandidateAuthFileName(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(authDir, entry.name)
        return buildLocalAuthFileRecord(entry, fullPath)
      }),
  )

  return files.sort(
    (left, right) =>
      new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime(),
  )
}

function buildProviderImportSummaries(authFiles: AuthFileRecord[]): ProviderImportSummary[] {
  const summaryMap = new Map<string, ProviderImportSummary>()

  for (const provider of PROVIDER_IMPORTS) {
    summaryMap.set(provider.id, {
      id: provider.id,
      label: provider.label,
      enabledCount: 0,
      disabledCount: 0,
      totalCount: 0,
      lastImportedAt: null,
    })
  }

  for (const file of authFiles) {
    const providerId = summaryMap.has(file.provider) ? file.provider : 'unknown'

    if (!summaryMap.has(providerId)) {
      summaryMap.set(providerId, {
        id: providerId,
        label: getProviderImportLabel(providerId),
        enabledCount: 0,
        disabledCount: 0,
        totalCount: 0,
        lastImportedAt: null,
      })
    }

    const current = summaryMap.get(providerId)

    if (!current) {
      continue
    }

    current.totalCount += 1
    current.enabledCount += file.enabled ? 1 : 0
    current.disabledCount += file.enabled ? 0 : 1

    if (
      !current.lastImportedAt ||
      new Date(file.modifiedAt).getTime() > new Date(current.lastImportedAt).getTime()
    ) {
      current.lastImportedAt = file.modifiedAt
    }
  }

  return [...summaryMap.values()].sort((left, right) => {
    if (left.totalCount !== right.totalCount) {
      return right.totalCount - left.totalCount
    }

    return left.label.localeCompare(right.label, 'zh-CN')
  })
}

async function nextAvailableAuthPath(fileName: string): Promise<string> {
  const { authDir } = resolvePaths()
  const parsedName = path.parse(fileName)
  let attempt = 0

  while (attempt < 500) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`
    const candidateName = `${parsedName.name}${suffix}${parsedName.ext}`
    const candidatePath = path.join(authDir, candidateName)

    if (!(await pathExists(candidatePath))) {
      return candidatePath
    }

    attempt += 1
  }

  throw new Error('认证文件重名过多，无法自动生成新名称。')
}

function buildImportedAuthFileName(sourcePath: string, providerHint?: string): string {
  const parsed = path.parse(path.basename(sourcePath))
  const sanitizedBase =
    parsed.name
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'auth'
  const normalizedProviderHint = providerHint?.trim().toLowerCase() ?? ''
  const prefix =
    normalizedProviderHint && !sanitizedBase.toLowerCase().includes(normalizedProviderHint)
      ? `${normalizedProviderHint}-`
      : ''

  return `${prefix}${sanitizedBase}${parsed.ext || '.json'}`
}

async function copyAuthFiles(sourcePaths: string[], providerHint?: string): Promise<void> {
  const { authDir } = resolvePaths()
  await fs.mkdir(authDir, { recursive: true })

  for (const sourcePath of sourcePaths) {
    const targetPath = await nextAvailableAuthPath(
      buildImportedAuthFileName(sourcePath, providerHint),
    )
    await fs.copyFile(sourcePath, targetPath)
  }
}

async function detectSystemProxyUrl(): Promise<string> {
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy

  if (envProxy?.trim()) {
    return envProxy.trim()
  }

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('scutil', ['--proxy'])
      const pairs = new Map<string, string>()

      for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.+)\s*$/)

        if (!match) {
          continue
        }

        pairs.set(match[1], match[2].trim())
      }

      const readEnabled = (key: string): boolean => {
        const value = pairs.get(key)
        return value === '1' || value?.toLowerCase() === 'true'
      }
      const readEndpoint = (hostKey: string, portKey: string): string | null => {
        const host = pairs.get(hostKey)?.trim()
        const port = pairs.get(portKey)?.trim()

        if (!host) {
          return null
        }

        const normalizedPort = port && /^\d+$/.test(port) ? `:${port}` : ''
        return `${host}${normalizedPort}`
      }

      if (readEnabled('HTTPEnable')) {
        const endpoint = readEndpoint('HTTPProxy', 'HTTPPort')

        if (endpoint) {
          return `http://${endpoint}`
        }
      }

      if (readEnabled('HTTPSEnable')) {
        const endpoint = readEndpoint('HTTPSProxy', 'HTTPSPort')

        if (endpoint) {
          return `http://${endpoint}`
        }
      }

      if (readEnabled('SOCKSEnable')) {
        const endpoint = readEndpoint('SOCKSProxy', 'SOCKSPort')

        if (endpoint) {
          return `socks5://${endpoint}`
        }
      }
    } catch {
      return ''
    }

    return ''
  }

  if (process.platform !== 'win32') {
    return ''
  }

  try {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$settings = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer) { Write-Output $settings.ProxyServer }",
      ],
      {
        windowsHide: true,
      },
    )

    const rawProxy = stdout.trim()

    if (!rawProxy) {
      return ''
    }

    if (rawProxy.includes('=')) {
      const segments = rawProxy
        .split(';')
        .map((segment) => segment.trim())
        .filter(Boolean)

      const entries = new Map<string, string>()

      for (const segment of segments) {
        const [key, value] = segment.split('=')

        if (!key || !value) {
          continue
        }

        entries.set(key.toLowerCase(), value.trim())
      }

      const candidate =
        entries.get('http') ?? entries.get('https') ?? entries.get('socks') ?? ''

      if (candidate) {
        if (/^[a-z]+:\/\//i.test(candidate)) {
          return candidate
        }

        if (entries.has('socks')) {
          return `socks5://${candidate}`
        }

        return `http://${candidate}`
      }
    }

    if (/^[a-z]+:\/\//i.test(rawProxy)) {
      return rawProxy
    }

    return `http://${rawProxy}`
  } catch {
    // Fall through to winhttp fallback.
  }

  try {
    const { stdout } = await execFileAsync('netsh', ['winhttp', 'show', 'proxy'], {
      windowsHide: true,
    })
    const lines = stdout.split(/\r?\n/).map((line) => line.trim())
    const proxyLine =
      lines.find((line) => /^Proxy Server\(s\)\s*:/i.test(line)) ??
      lines.find((line) => /^代理服务器\s*:/i.test(line))

    if (!proxyLine) {
      return ''
    }

    const rawProxy = proxyLine.replace(/^.*?:\s*/, '').trim()

    if (!rawProxy || /direct access/i.test(rawProxy) || /直接访问/i.test(rawProxy)) {
      return ''
    }

    if (/^[a-z]+:\/\//i.test(rawProxy)) {
      return rawProxy
    }

    return `http://${rawProxy}`
  } catch {
    return ''
  }
}

async function resolveBinaryPath(guiState: GuiState): Promise<string> {
  if (guiState.proxyBinaryPath && (await pathExists(guiState.proxyBinaryPath))) {
    return guiState.proxyBinaryPath
  }

  for (const candidatePath of resolvePaths().binaryCandidates) {
    if (await pathExists(candidatePath)) {
      return candidatePath
    }
  }

  return ''
}

async function fetchManagementText(
  port: number,
  managementApiKey: string,
  endpointPath: string,
): Promise<string> {
  const requestUrl = `${buildManagementApiBaseUrl(port)}${endpointPath}`
  let lastError: Error | null = null

  for (const candidateKey of dedupeStrings([managementApiKey, DEFAULT_MANAGEMENT_API_KEY])) {
    try {
      const response = await fetch(requestUrl, {
        headers: {
          'X-Management-Key': candidateKey,
        },
        signal: AbortSignal.timeout(5000),
      })

      if (response.status === 401) {
        lastError = new Error('管理密钥无效。')
        continue
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      return await response.text()
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(typeof error === 'string' ? error : '请求失败。')
    }
  }

  throw lastError ?? new Error('管理接口请求失败。')
}

async function fetchManagementJson<T>(
  port: number,
  managementApiKey: string,
  endpointPath: string,
): Promise<T> {
  const rawText = await fetchManagementText(port, managementApiKey, endpointPath)
  return JSON.parse(rawText) as T
}

function toUsagePoints(entriesObject: PlainObject): UsagePoint[] {
  return Object.entries(entriesObject)
    .map(([label, value]) => ({
      label,
      value: readNumber(value, 0),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
}

function parseUsageTimestamp(value: string | null): number | null {
  if (!value) {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatUsageBucketLabel(timestampMs: number, granularity: 'hour' | 'day'): string {
  const value = new Date(timestampMs)
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')

  if (granularity === 'hour') {
    const hour = `${value.getHours()}`.padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:00`
  }

  return `${year}-${month}-${day}`
}

function buildUsagePointsFromMap(entries: Map<string, number>): UsagePoint[] {
  return [...entries.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'))
    .map(([label, value]) => ({ label, value }))
}

function resolveUsageSummaryQuery(query?: UsageSummaryQuery | null): ResolvedUsageSummaryQuery {
  const preset = query?.preset ?? 'all'
  const now = new Date()

  if (preset === '24h') {
    return {
      preset,
      label: '近 24 小时',
      startAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      endAt: now.toISOString(),
      granularity: 'hour',
      filtered: true,
    }
  }

  if (preset === '7d') {
    return {
      preset,
      label: '近 7 天',
      startAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      endAt: now.toISOString(),
      granularity: 'day',
      filtered: true,
    }
  }

  if (preset === '30d') {
    return {
      preset,
      label: '近 30 天',
      startAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      endAt: now.toISOString(),
      granularity: 'day',
      filtered: true,
    }
  }

  if (preset === 'custom') {
    let startTime = parseUsageTimestamp(normalizeStringValue(query?.startAt))
    let endTime = parseUsageTimestamp(normalizeStringValue(query?.endAt))

    if (startTime !== null && endTime !== null && startTime > endTime) {
      ;[startTime, endTime] = [endTime, startTime]
    }

    const duration = startTime !== null && endTime !== null ? endTime - startTime : null

    return {
      preset,
      label: '自定义时间段',
      startAt: startTime === null ? null : new Date(startTime).toISOString(),
      endAt: endTime === null ? null : new Date(endTime).toISOString(),
      granularity: duration !== null && duration <= 48 * 60 * 60 * 1000 ? 'hour' : 'day',
      filtered: startTime !== null || endTime !== null,
    }
  }

  return {
    preset: 'all',
    label: '全部时间',
    startAt: null,
    endAt: null,
    granularity: 'day',
    filtered: false,
  }
}

function isUsageTimestampWithinRange(
  timestampMs: number | null,
  query: ResolvedUsageSummaryQuery,
): boolean {
  if (!query.filtered) {
    return true
  }

  if (timestampMs === null) {
    return false
  }

  const startTime = parseUsageTimestamp(query.startAt)
  const endTime = parseUsageTimestamp(query.endAt)

  if (startTime !== null && timestampMs < startTime) {
    return false
  }

  if (endTime !== null && timestampMs > endTime) {
    return false
  }

  return true
}

function recordUsageBucket(
  bucketMap: Map<string, number>,
  timestampMs: number | null,
  granularity: 'hour' | 'day',
  amount: number,
): void {
  if (timestampMs === null) {
    return
  }

  const bucketLabel = formatUsageBucketLabel(timestampMs, granularity)
  bucketMap.set(bucketLabel, (bucketMap.get(bucketLabel) ?? 0) + amount)
}

function emptyUsageSummary(error: string | null = null, query?: UsageSummaryQuery | null): UsageSummary {
  const resolvedQuery = resolveUsageSummaryQuery(query)

  return {
    ...EMPTY_USAGE_SUMMARY,
    rangePreset: resolvedQuery.preset,
    rangeLabel: resolvedQuery.label,
    rangeStartAt: resolvedQuery.startAt,
    rangeEndAt: resolvedQuery.endAt,
    rangeGranularity: resolvedQuery.granularity,
    error,
  }
}

function buildUsageSummary(payload: unknown, queryInput?: UsageSummaryQuery | null): UsageSummary {
  const query = resolveUsageSummaryQuery(queryInput)
  const responseObject = asObject(payload)
  const usageObject = asObject(responseObject.usage)
  const root = Object.keys(usageObject).length > 0 ? usageObject : responseObject
  const apis = asObject(root.apis)
  const modelMap = new Map<string, UsageModelSummary>()
  const requestsByBucket = new Map<string, number>()
  const tokensByBucket = new Map<string, number>()
  let aggregatedRequests = 0
  let aggregatedSuccessCount = 0
  let aggregatedFailureCount = 0
  let aggregatedTotalTokens = 0
  let aggregatedNetTokens = 0
  let aggregatedBillableInputTokens = 0
  let aggregatedInputTokens = 0
  let aggregatedOutputTokens = 0
  let aggregatedCachedTokens = 0
  let aggregatedReasoningTokens = 0

  for (const [, apiEntry] of Object.entries(apis)) {
    const models = asObject(asObject(apiEntry).models)

    for (const [modelName, modelEntry] of Object.entries(models)) {
      const modelObject = asObject(modelEntry)
      const details = asArray<PlainObject>(modelObject.details)
      let modelSummary = modelMap.get(modelName)

      if (!modelSummary) {
        modelSummary = {
          model: modelName,
          requests: 0,
          successCount: 0,
          failureCount: 0,
          totalTokens: 0,
          netTokens: 0,
          billableInputTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          reasoningTokens: 0,
        }
        modelMap.set(modelName, modelSummary)
      }

      if (details.length > 0) {
        for (const detail of details) {
          const timestamp = normalizeStringValue(detail.timestamp)
          const timestampMs = parseUsageTimestamp(timestamp)

          if (!isUsageTimestampWithinRange(timestampMs, query)) {
            continue
          }

          const tokens = asObject(detail.tokens)
          const inputTokenDetails = asObject(tokens.input_tokens_details)
          const promptTokenDetails = asObject(tokens.prompt_tokens_details)
          const outputTokenDetails = asObject(tokens.output_tokens_details)
          const completionTokenDetails = asObject(tokens.completion_tokens_details)
          const inputTokens =
            firstFiniteNumber(tokens.input_tokens, tokens.prompt_tokens, detail.input_tokens) ?? 0
          const outputTokens =
            firstFiniteNumber(
              tokens.output_tokens,
              tokens.completion_tokens,
              detail.output_tokens,
            ) ?? 0
          const cachedTokens = Math.max(
            firstFiniteNumber(
              tokens.cached_tokens,
              tokens.cache_tokens,
              tokens.cache_read_input_tokens,
              inputTokenDetails.cached_tokens,
              promptTokenDetails.cached_tokens,
              detail.cached_tokens,
            ) ?? 0,
            0,
          )
          const reasoningTokens = Math.max(
            firstFiniteNumber(
              tokens.reasoning_tokens,
              outputTokenDetails.reasoning_tokens,
              completionTokenDetails.reasoning_tokens,
              detail.reasoning_tokens,
            ) ?? 0,
            0,
          )
          const explicitTotalTokens = firstFiniteNumber(tokens.total_tokens, detail.total_tokens)
          const totalTokens =
            explicitTotalTokens !== null && explicitTotalTokens > 0
              ? explicitTotalTokens
              : inputTokens + outputTokens
          const billableInputTokens = Math.max(inputTokens - cachedTokens, 0)
          const netTokens = Math.max(totalTokens - cachedTokens, 0)
          const failed = readBoolean(detail.failed, false)

          modelSummary.requests += 1
          modelSummary.successCount += failed ? 0 : 1
          modelSummary.failureCount += failed ? 1 : 0
          modelSummary.totalTokens += totalTokens
          modelSummary.netTokens += netTokens
          modelSummary.billableInputTokens += billableInputTokens
          modelSummary.inputTokens += inputTokens
          modelSummary.outputTokens += outputTokens
          modelSummary.cachedTokens += cachedTokens
          modelSummary.reasoningTokens += reasoningTokens

          aggregatedRequests += 1
          aggregatedSuccessCount += failed ? 0 : 1
          aggregatedFailureCount += failed ? 1 : 0
          aggregatedTotalTokens += totalTokens
          aggregatedNetTokens += netTokens
          aggregatedBillableInputTokens += billableInputTokens
          aggregatedInputTokens += inputTokens
          aggregatedOutputTokens += outputTokens
          aggregatedCachedTokens += cachedTokens
          aggregatedReasoningTokens += reasoningTokens
          recordUsageBucket(requestsByBucket, timestampMs, query.granularity, 1)
          recordUsageBucket(tokensByBucket, timestampMs, query.granularity, netTokens)
        }

        continue
      }

      if (query.filtered) {
        continue
      }

      const requests = readNumber(modelObject.total_requests, 0)
      const successCount = readNumber(modelObject.success_count, Math.max(0, requests))
      const failureCount = readNumber(modelObject.failure_count, 0)
      const modelInputTokenDetails = asObject(modelObject.input_tokens_details)
      const modelPromptTokenDetails = asObject(modelObject.prompt_tokens_details)
      const modelOutputTokenDetails = asObject(modelObject.output_tokens_details)
      const modelCompletionTokenDetails = asObject(modelObject.completion_tokens_details)
      const inputTokens =
        firstFiniteNumber(modelObject.input_tokens, modelObject.prompt_tokens) ?? 0
      const outputTokens =
        firstFiniteNumber(modelObject.output_tokens, modelObject.completion_tokens) ?? 0
      const cachedTokens = Math.max(
        firstFiniteNumber(
          modelObject.cached_tokens,
          modelObject.cache_tokens,
          modelObject.cache_read_input_tokens,
          modelInputTokenDetails.cached_tokens,
          modelPromptTokenDetails.cached_tokens,
        ) ?? 0,
        0,
      )
      const reasoningTokens = Math.max(
        firstFiniteNumber(
          modelObject.reasoning_tokens,
          modelOutputTokenDetails.reasoning_tokens,
          modelCompletionTokenDetails.reasoning_tokens,
        ) ?? 0,
        0,
      )
      const explicitTotalTokens = firstFiniteNumber(modelObject.total_tokens)
      const totalTokens =
        explicitTotalTokens !== null && explicitTotalTokens > 0
          ? explicitTotalTokens
          : inputTokens + outputTokens
      const billableInputTokens = Math.max(inputTokens - cachedTokens, 0)
      const netTokens = Math.max(totalTokens - cachedTokens, 0)

      modelSummary.requests += requests
      modelSummary.successCount += successCount
      modelSummary.failureCount += failureCount
      modelSummary.totalTokens += totalTokens
      modelSummary.netTokens += netTokens
      modelSummary.billableInputTokens += billableInputTokens
      modelSummary.inputTokens += inputTokens
      modelSummary.outputTokens += outputTokens
      modelSummary.cachedTokens += cachedTokens
      modelSummary.reasoningTokens += reasoningTokens

      aggregatedRequests += requests
      aggregatedSuccessCount += successCount
      aggregatedFailureCount += failureCount
      aggregatedTotalTokens += totalTokens
      aggregatedNetTokens += netTokens
      aggregatedBillableInputTokens += billableInputTokens
      aggregatedInputTokens += inputTokens
      aggregatedOutputTokens += outputTokens
      aggregatedCachedTokens += cachedTokens
      aggregatedReasoningTokens += reasoningTokens
    }
  }

  const detailRequestsByPeriod = buildUsagePointsFromMap(requestsByBucket)
  const detailTokensByPeriod = buildUsagePointsFromMap(tokensByBucket)

  if (query.filtered) {
    return {
      available: true,
      rangePreset: query.preset,
      rangeLabel: query.label,
      rangeStartAt: query.startAt,
      rangeEndAt: query.endAt,
      rangeGranularity: query.granularity,
      usedDetailRange: true,
      totalRequests: aggregatedRequests,
      successCount: aggregatedSuccessCount,
      failureCount: aggregatedFailureCount,
      totalTokens: aggregatedTotalTokens,
      netTokens: aggregatedNetTokens,
      billableInputTokens: aggregatedBillableInputTokens,
      inputTokens: aggregatedInputTokens,
      outputTokens: aggregatedOutputTokens,
      cachedTokens: aggregatedCachedTokens,
      reasoningTokens: aggregatedReasoningTokens,
      requestsByDay: detailRequestsByPeriod,
      tokensByDay: detailTokensByPeriod,
      topModels: [...modelMap.values()]
        .filter((item) => item.requests > 0 || item.totalTokens > 0)
        .sort((left, right) => {
          if (left.netTokens !== right.netTokens) {
            return right.netTokens - left.netTokens
          }

          if (left.requests !== right.requests) {
            return right.requests - left.requests
          }

          return right.totalTokens - left.totalTokens
        })
        .slice(0, 6),
      lastUpdatedAt: new Date().toISOString(),
      error: null,
    }
  }

  const rootInputTokenDetails = asObject(root.input_tokens_details)
  const rootPromptTokenDetails = asObject(root.prompt_tokens_details)
  const rootOutputTokenDetails = asObject(root.output_tokens_details)
  const rootCompletionTokenDetails = asObject(root.completion_tokens_details)
  const inputTokens =
    firstFiniteNumber(root.input_tokens, root.prompt_tokens) ?? aggregatedInputTokens
  const outputTokens =
    firstFiniteNumber(root.output_tokens, root.completion_tokens) ?? aggregatedOutputTokens
  const cachedTokens = Math.max(
    firstFiniteNumber(
      root.cached_tokens,
      root.cache_tokens,
      root.cache_read_input_tokens,
      rootInputTokenDetails.cached_tokens,
      rootPromptTokenDetails.cached_tokens,
    ) ?? aggregatedCachedTokens,
    0,
  )
  const reasoningTokens = Math.max(
    firstFiniteNumber(
      root.reasoning_tokens,
      rootOutputTokenDetails.reasoning_tokens,
      rootCompletionTokenDetails.reasoning_tokens,
    ) ?? aggregatedReasoningTokens,
    0,
  )
  const explicitTotalTokens = firstFiniteNumber(root.total_tokens)
  const totalTokens =
    explicitTotalTokens !== null && explicitTotalTokens > 0
      ? explicitTotalTokens
      : aggregatedTotalTokens > 0
        ? aggregatedTotalTokens
        : inputTokens + outputTokens
  const billableInputTokens = Math.max(inputTokens - cachedTokens, 0)
  const netTokens =
    totalTokens > 0 || cachedTokens > 0 ? Math.max(totalTokens - cachedTokens, 0) : aggregatedNetTokens

  return {
    available: true,
    rangePreset: query.preset,
    rangeLabel: query.label,
    rangeStartAt: query.startAt,
    rangeEndAt: query.endAt,
    rangeGranularity: query.granularity,
    usedDetailRange: detailRequestsByPeriod.length > 0 || detailTokensByPeriod.length > 0,
    totalRequests: readNumber(root.total_requests, aggregatedRequests),
    successCount: readNumber(root.success_count, aggregatedSuccessCount),
    failureCount: readNumber(root.failure_count, aggregatedFailureCount),
    totalTokens,
    netTokens,
    billableInputTokens:
      billableInputTokens > 0 || inputTokens > 0
        ? billableInputTokens
        : aggregatedBillableInputTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    requestsByDay:
      detailRequestsByPeriod.length > 0
        ? detailRequestsByPeriod
        : toUsagePoints(asObject(root.requests_by_day)),
    tokensByDay:
      detailTokensByPeriod.length > 0 ? detailTokensByPeriod : toUsagePoints(asObject(root.tokens_by_day)),
    topModels: [...modelMap.values()]
      .filter((item) => item.requests > 0 || item.totalTokens > 0)
      .sort((left, right) => {
        if (left.netTokens !== right.netTokens) {
          return right.netTokens - left.netTokens
        }

        if (left.requests !== right.requests) {
          return right.requests - left.requests
        }

        return right.totalTokens - left.totalTokens
      })
      .slice(0, 6),
    lastUpdatedAt: new Date().toISOString(),
    error: null,
  }
}

function shouldUseUsageLogFallback(summary: UsageSummary): boolean {
  if (!summary.available) {
    return true
  }

  return (
    summary.totalRequests <= 0 &&
    summary.totalTokens <= 0 &&
    summary.netTokens <= 0 &&
    summary.inputTokens <= 0 &&
    summary.outputTokens <= 0 &&
    summary.topModels.length === 0 &&
    summary.requestsByDay.length === 0 &&
    summary.tokensByDay.length === 0
  )
}

function isUsageLogFileName(fileName: string): boolean {
  return /^(v1-(responses|chat-completions|completions))-.+\.log$/i.test(fileName)
}

function buildUsageLogWatchPattern(): string {
  return path.join(resolvePaths().logsDir, USAGE_LOG_WATCH_GLOB)
}

function buildUsageLogFileId(fileName: string, size: number, mtimeMs: number): string {
  return `${fileName}:${size}:${Math.round(mtimeMs)}`
}

function createEmptyPersistedUsageState(): PersistedUsageState {
  return {
    version: 1,
    updatedAt: null,
    processedFileIds: [],
    records: [],
  }
}

function normalizePersistedUsageRecord(value: unknown): PersistedUsageRecord | null {
  const entry = asObject(value)
  const recordId = normalizeStringValue(entry.recordId)

  if (!recordId) {
    return null
  }

  const timestamp = normalizeStringValue(entry.timestamp)
  const parsedTimestampMs = parseUsageTimestamp(timestamp)
  const storedTimestampMs = readNumber(entry.timestampMs, Number.NaN)

  return {
    recordId,
    model: normalizeStringValue(entry.model) || 'unknown',
    timestamp,
    timestampMs: Number.isFinite(storedTimestampMs) ? storedTimestampMs : parsedTimestampMs,
    totalTokens: Math.max(readNumber(entry.totalTokens, 0), 0),
    inputTokens: Math.max(readNumber(entry.inputTokens, 0), 0),
    outputTokens: Math.max(readNumber(entry.outputTokens, 0), 0),
    cachedTokens: Math.max(readNumber(entry.cachedTokens, 0), 0),
    reasoningTokens: Math.max(readNumber(entry.reasoningTokens, 0), 0),
    failed: readBoolean(entry.failed, false),
  }
}

function normalizePersistedUsageState(value: unknown): PersistedUsageState {
  const root = asObject(value)
  const processedFileIds = dedupeStrings(
    asArray<string>(root.processedFileIds)
      .map((item) => normalizeStringValue(item))
      .filter((item): item is string => Boolean(item)),
  ).slice(-MAX_USAGE_PROCESSED_FILE_IDS)
  const records = asArray(root.records)
    .map((item) => normalizePersistedUsageRecord(item))
    .filter((item): item is PersistedUsageRecord => Boolean(item))

  return {
    version: Math.max(readNumber(root.version, 1), 1),
    updatedAt: normalizeStringValue(root.updatedAt),
    processedFileIds,
    records,
  }
}

async function readPersistedUsageState(): Promise<PersistedUsageState> {
  if (usageStatsCache) {
    return usageStatsCache
  }

  try {
    const raw = await fs.readFile(resolvePaths().usageStatsPath, 'utf8')
    usageStatsCache = normalizePersistedUsageState(JSON.parse(raw))
  } catch {
    usageStatsCache = createEmptyPersistedUsageState()
  }

  return usageStatsCache
}

async function writePersistedUsageState(state: PersistedUsageState): Promise<void> {
  usageStatsCache = {
    version: Math.max(state.version || 1, 1),
    updatedAt: new Date().toISOString(),
    processedFileIds: dedupeStrings(state.processedFileIds).slice(-MAX_USAGE_PROCESSED_FILE_IDS),
    records: state.records,
  }

  await fs.writeFile(
    resolvePaths().usageStatsPath,
    JSON.stringify(usageStatsCache, null, 2),
    'utf8',
  )
}

async function deleteProcessedUsageLogFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
  } catch {
    // Ignore cleanup failures after successful ingestion.
  }

  usageLogCache.delete(filePath)
}

async function ingestUsageLogsToStore(): Promise<PersistedUsageState> {
  if (usageStatsIngestPromise) {
    return usageStatsIngestPromise
  }

  usageStatsIngestPromise = (async () => {
    const store = await readPersistedUsageState()
    const { logsDir } = resolvePaths()
    let entries: Array<{ isFile(): boolean; name: string }> = []

    try {
      entries = await fs.readdir(logsDir, { withFileTypes: true })
    } catch {
      return store
    }

    const existingRecordIds = new Set(store.records.map((record) => record.recordId))
    const processedFileIds = new Set(store.processedFileIds)
    let changed = false

    for (const entry of entries) {
      if (!entry.isFile() || !isUsageLogFileName(entry.name)) {
        continue
      }

      const filePath = path.join(logsDir, entry.name)
      let stat: Awaited<ReturnType<typeof fs.stat>>

      try {
        stat = await fs.stat(filePath)
      } catch {
        usageLogCache.delete(filePath)
        continue
      }

      if (Date.now() - stat.mtimeMs < MIN_USAGE_LOG_FILE_AGE_MS) {
        continue
      }

      const fileId = buildUsageLogFileId(entry.name, stat.size, stat.mtimeMs)

      if (processedFileIds.has(fileId)) {
        await deleteProcessedUsageLogFile(filePath)
        continue
      }

      let raw: string

      try {
        raw = await fs.readFile(filePath, 'utf8')
      } catch {
        continue
      }

      const record = parseUsageLogRecord(entry.name, raw, stat.mtimeMs)

      if (!record) {
        continue
      }

      if (!existingRecordIds.has(fileId)) {
        store.records.push({
          recordId: fileId,
          ...record,
        })
        existingRecordIds.add(fileId)
        changed = true
      }

      if (!processedFileIds.has(fileId)) {
        store.processedFileIds.push(fileId)
        processedFileIds.add(fileId)
        changed = true
      }

      await deleteProcessedUsageLogFile(filePath)
    }

    if (store.processedFileIds.length > MAX_USAGE_PROCESSED_FILE_IDS) {
      store.processedFileIds = store.processedFileIds.slice(-MAX_USAGE_PROCESSED_FILE_IDS)
      changed = true
    }

    if (changed) {
      await writePersistedUsageState(store)
    }

    return store
  })().finally(() => {
    usageStatsIngestPromise = null
  })

  return usageStatsIngestPromise
}

function scheduleUsageLogIngestion(delayMs = 900): void {
  if (usageLogIngestTimer) {
    clearTimeout(usageLogIngestTimer)
  }

  usageLogIngestTimer = setTimeout(() => {
    usageLogIngestTimer = null

    void ingestUsageLogsToStore()
      .then(() => {
        scheduleStateChanged()
      })
      .catch((error) => {
        void appendLog('warn', 'app', `归档用量日志失败：${toErrorMessage(error)}`)
      })
  }, delayMs)
}

function parseUsageLogJsonLine(line: string): PlainObject | null {
  const trimmed = line.trim()

  if (!trimmed.startsWith('data: ')) {
    return null
  }

  const payload = trimmed.slice(6).trim()

  if (!payload || payload === '[DONE]') {
    return null
  }

  try {
    const parsed = JSON.parse(payload)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PlainObject) : null
  } catch {
    return null
  }
}

function extractUsageLogSection(
  raw: string,
  startMarker: string,
  endMarker?: string,
): string | null {
  const startIndex = raw.indexOf(startMarker)

  if (startIndex < 0) {
    return null
  }

  const contentStart = startIndex + startMarker.length
  const endIndex = endMarker ? raw.indexOf(endMarker, contentStart) : -1
  const section = raw.slice(contentStart, endIndex >= 0 ? endIndex : undefined).trim()

  return section || null
}

function extractUsageLogResponseBody(raw: string): string | null {
  const responseSection = extractUsageLogSection(raw, '=== RESPONSE ===')

  if (!responseSection) {
    return null
  }

  const bodyMatch = responseSection.match(/(?:^|\r?\n)Body:\r?\n([\s\S]*)$/)
  return bodyMatch?.[1]?.trim() || null
}

function parseUsageLogTimestamp(raw: string, fallbackTimestampMs: number): string {
  const timestampMatch = raw.match(/^Timestamp:\s*(.+)$/m)
  const timestampValue = normalizeStringValue(timestampMatch?.[1])

  if (timestampValue) {
    return timestampValue
  }

  return new Date(fallbackTimestampMs).toISOString()
}

function parseUsageLogRequestPayload(raw: string): PlainObject {
  const requestBody = extractUsageLogSection(raw, '=== REQUEST BODY ===', '=== RESPONSE ===')

  if (!requestBody) {
    return {}
  }

  try {
    const parsed = JSON.parse(requestBody)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PlainObject) : {}
  } catch {
    return {}
  }
}

function normalizeUsagePayload(payload: unknown): {
  cachedTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
} | null {
  const root = asObject(payload)

  if (Object.keys(root).length === 0) {
    return null
  }

  const inputTokenDetails = asObject(root.input_tokens_details)
  const promptTokenDetails = asObject(root.prompt_tokens_details)
  const outputTokenDetails = asObject(root.output_tokens_details)
  const completionTokenDetails = asObject(root.completion_tokens_details)
  const inputTokens = firstFiniteNumber(root.input_tokens, root.prompt_tokens) ?? 0
  const outputTokens = firstFiniteNumber(root.output_tokens, root.completion_tokens) ?? 0
  const cachedTokens = Math.max(
    firstFiniteNumber(
      root.cached_tokens,
      root.cache_tokens,
      root.cache_read_input_tokens,
      inputTokenDetails.cached_tokens,
      promptTokenDetails.cached_tokens,
    ) ?? 0,
    0,
  )
  const reasoningTokens = Math.max(
    firstFiniteNumber(
      root.reasoning_tokens,
      outputTokenDetails.reasoning_tokens,
      completionTokenDetails.reasoning_tokens,
    ) ?? 0,
    0,
  )
  const explicitTotalTokens = firstFiniteNumber(root.total_tokens)
  const totalTokens =
    explicitTotalTokens !== null && explicitTotalTokens > 0
      ? explicitTotalTokens
      : inputTokens + outputTokens

  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
    return null
  }

  return {
    cachedTokens,
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  }
}

function createParsedUsageLogRecord(
  model: string | null,
  timestamp: string,
  usagePayload: unknown,
  failed: boolean,
): ParsedUsageLogRecord | null {
  const usage = normalizeUsagePayload(usagePayload)

  if (!usage) {
    return null
  }

  return {
    model: normalizeStringValue(model) || 'unknown',
    timestamp,
    timestampMs: parseUsageTimestamp(timestamp),
    totalTokens: usage.totalTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
    reasoningTokens: usage.reasoningTokens,
    failed,
  }
}

function parseResponsesUsageLog(
  raw: string,
  fallbackTimestampMs: number,
): ParsedUsageLogRecord | null {
  const requestPayload = parseUsageLogRequestPayload(raw)
  const responseBody = extractUsageLogResponseBody(raw)
  const timestamp = parseUsageLogTimestamp(raw, fallbackTimestampMs)
  let model = normalizeStringValue(requestPayload.model)

  if (!responseBody) {
    return null
  }

  const lines = responseBody.split(/\r?\n/)
  let usagePayload: unknown = null
  let failed = false

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== 'event: response.completed') {
      continue
    }

    const payload = parseUsageLogJsonLine(lines[index + 1] ?? '')

    if (!payload) {
      continue
    }

    const responseObject = asObject(payload.response)
    const candidateUsage = asObject(responseObject.usage)

    if (Object.keys(candidateUsage).length === 0) {
      continue
    }

    usagePayload = candidateUsage
    model = normalizeStringValue(responseObject.model) || model
    failed =
      readBoolean(responseObject.failed, false) ||
      Object.keys(asObject(responseObject.error)).length > 0 ||
      normalizeStringValue(responseObject.status)?.toLowerCase() === 'failed'
  }

  if (!usagePayload) {
    const directPayload = parseUsageLogJsonLine(lines[0] ?? '')

    if (directPayload) {
      usagePayload = asObject(directPayload.usage)
      model = normalizeStringValue(directPayload.model) || model
    }
  }

  return createParsedUsageLogRecord(model, timestamp, usagePayload, failed)
}

function parseChatCompletionsUsageLog(
  raw: string,
  fallbackTimestampMs: number,
): ParsedUsageLogRecord | null {
  const requestPayload = parseUsageLogRequestPayload(raw)
  const responseBody = extractUsageLogResponseBody(raw)
  const timestamp = parseUsageLogTimestamp(raw, fallbackTimestampMs)
  let model = normalizeStringValue(requestPayload.model)

  if (!responseBody) {
    return null
  }

  let usagePayload: unknown = null
  let failed = false
  const directBody = responseBody.trim()

  if (directBody.startsWith('{')) {
    try {
      const parsed = JSON.parse(directBody) as PlainObject
      const directUsage = asObject(parsed.usage)

      if (Object.keys(directUsage).length > 0) {
        usagePayload = directUsage
        model = normalizeStringValue(parsed.model) || model
        failed = Object.keys(asObject(parsed.error)).length > 0
      }
    } catch {
      // Ignore parse failures and continue with SSE parsing.
    }
  }

  if (!usagePayload) {
    const lines = responseBody.split(/\r?\n/)

    for (const line of lines) {
      const payload = parseUsageLogJsonLine(line)

      if (!payload) {
        continue
      }

      const candidateUsage = asObject(payload.usage)

      if (Object.keys(candidateUsage).length === 0) {
        failed = failed || Object.keys(asObject(payload.error)).length > 0
        continue
      }

      usagePayload = candidateUsage
      model = normalizeStringValue(payload.model) || model
      failed = failed || Object.keys(asObject(payload.error)).length > 0
    }
  }

  return createParsedUsageLogRecord(model, timestamp, usagePayload, failed)
}

function parseUsageLogRecord(
  fileName: string,
  raw: string,
  fallbackTimestampMs: number,
): ParsedUsageLogRecord | null {
  if (/^v1-responses-/i.test(fileName)) {
    return parseResponsesUsageLog(raw, fallbackTimestampMs)
  }

  if (/^v1-(chat-completions|completions)-/i.test(fileName)) {
    return parseChatCompletionsUsageLog(raw, fallbackTimestampMs)
  }

  return null
}

async function readUsageLogRecords(): Promise<ParsedUsageLogRecord[]> {
  const { logsDir } = resolvePaths()
  let entries: Array<{ isFile(): boolean; name: string }> = []

  try {
    entries = await fs.readdir(logsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const candidates = entries.filter((entry) => entry.isFile() && isUsageLogFileName(entry.name))
  const activePaths = new Set<string>()
  const records: ParsedUsageLogRecord[] = []

  for (const entry of candidates) {
    const filePath = path.join(logsDir, entry.name)
    activePaths.add(filePath)

    let stat: Awaited<ReturnType<typeof fs.stat>>

    try {
      stat = await fs.stat(filePath)
    } catch {
      usageLogCache.delete(filePath)
      continue
    }

    const cached = usageLogCache.get(filePath)

    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      if (cached.record) {
        records.push(cached.record)
      }
      continue
    }

    let raw: string

    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch {
      usageLogCache.set(filePath, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        record: null,
      })
      continue
    }

    const record = parseUsageLogRecord(entry.name, raw, stat.mtimeMs)
    usageLogCache.set(filePath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      record,
    })

    if (record) {
      records.push(record)
    }
  }

  for (const cachedPath of usageLogCache.keys()) {
    if (!activePaths.has(cachedPath)) {
      usageLogCache.delete(cachedPath)
    }
  }

  return records
}

void readUsageLogRecords

function buildUsageSummaryFromRecords(
  records: ParsedUsageLogRecord[],
  queryInput?: UsageSummaryQuery,
): UsageSummary | null {
  if (records.length === 0) {
    return null
  }

  const query = resolveUsageSummaryQuery(queryInput)
  const modelMap = new Map<string, UsageModelSummary>()
  const requestsByBucket = new Map<string, number>()
  const tokensByBucket = new Map<string, number>()
  let totalRequests = 0
  let successCount = 0
  let failureCount = 0
  let totalTokens = 0
  let netTokens = 0
  let billableInputTokens = 0
  let inputTokens = 0
  let outputTokens = 0
  let cachedTokens = 0
  let reasoningTokens = 0

  for (const record of records) {
    if (!isUsageTimestampWithinRange(record.timestampMs, query)) {
      continue
    }

    const modelName = record.model || 'unknown'
    const modelSummary =
      modelMap.get(modelName) ??
      (() => {
        const created: UsageModelSummary = {
          model: modelName,
          requests: 0,
          successCount: 0,
          failureCount: 0,
          totalTokens: 0,
          netTokens: 0,
          billableInputTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          reasoningTokens: 0,
        }
        modelMap.set(modelName, created)
        return created
      })()
    const recordNetTokens = Math.max(record.totalTokens - record.cachedTokens, 0)
    const recordBillableInputTokens = Math.max(record.inputTokens - record.cachedTokens, 0)

    modelSummary.requests += 1
    modelSummary.successCount += record.failed ? 0 : 1
    modelSummary.failureCount += record.failed ? 1 : 0
    modelSummary.totalTokens += record.totalTokens
    modelSummary.netTokens += recordNetTokens
    modelSummary.billableInputTokens += recordBillableInputTokens
    modelSummary.inputTokens += record.inputTokens
    modelSummary.outputTokens += record.outputTokens
    modelSummary.cachedTokens += record.cachedTokens
    modelSummary.reasoningTokens += record.reasoningTokens

    totalRequests += 1
    successCount += record.failed ? 0 : 1
    failureCount += record.failed ? 1 : 0
    totalTokens += record.totalTokens
    netTokens += recordNetTokens
    billableInputTokens += recordBillableInputTokens
    inputTokens += record.inputTokens
    outputTokens += record.outputTokens
    cachedTokens += record.cachedTokens
    reasoningTokens += record.reasoningTokens
    recordUsageBucket(requestsByBucket, record.timestampMs, query.granularity, 1)
    recordUsageBucket(tokensByBucket, record.timestampMs, query.granularity, recordNetTokens)
  }

  if (totalRequests <= 0) {
    return null
  }

  return {
    available: true,
    rangePreset: query.preset,
    rangeLabel: query.label,
    rangeStartAt: query.startAt,
    rangeEndAt: query.endAt,
    rangeGranularity: query.granularity,
    usedDetailRange: true,
    totalRequests,
    successCount,
    failureCount,
    totalTokens,
    netTokens,
    billableInputTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    requestsByDay: buildUsagePointsFromMap(requestsByBucket),
    tokensByDay: buildUsagePointsFromMap(tokensByBucket),
    topModels: [...modelMap.values()]
      .sort((left, right) => {
        if (left.netTokens !== right.netTokens) {
          return right.netTokens - left.netTokens
        }

        if (left.requests !== right.requests) {
          return right.requests - left.requests
        }

        return right.totalTokens - left.totalTokens
      })
      .slice(0, 6),
    lastUpdatedAt: new Date().toISOString(),
    error: null,
  }
}

async function buildUsageSummaryFromLogs(query?: UsageSummaryQuery): Promise<UsageSummary | null> {
  const store = await ingestUsageLogsToStore()
  return buildUsageSummaryFromRecords(store.records, query)
}

async function resolveUsageSummaryWithFallback(
  managementPayload: unknown,
  query?: UsageSummaryQuery,
  localSummary?: UsageSummary | null,
): Promise<{
  managementSummary: UsageSummary
  summary: UsageSummary
}> {
  const managementSummary = buildUsageSummary(managementPayload, query)
  const fallbackSummary = localSummary ?? (await buildUsageSummaryFromLogs(query))

  return {
    managementSummary,
    summary: fallbackSummary ?? managementSummary,
  }
}

async function fetchUsageSummary(
  port: number,
  managementApiKey: string,
  query?: UsageSummaryQuery,
): Promise<UsageSummary> {
  const payload = await fetchManagementJson<PlainObject>(
    port,
    managementApiKey,
    '/v0/management/usage',
  )

  return buildUsageSummary(payload, query)
}

function parseConfigObjectV2(configText: string): PlainObject {
  const parsed = parse(configText)

  if (parsed === null || parsed === undefined) {
    return {}
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('YAML 根节点必须是对象。')
  }

  return parsed as PlainObject
}

async function writeConfigObjectV2(config: PlainObject): Promise<void> {
  ensureRequiredConfigFields(config)
  await fs.writeFile(resolvePaths().configPath, stringifyConfigObject(config), 'utf8')
}

function getProviderImportLabelV2(providerId: string): string {
  return PROVIDER_IMPORTS.find((entry) => entry.id === providerId)?.label ?? '其他'
}

function resolveProviderAuthEndpointV2(
  provider: ProviderAuthProvider,
): ProviderAuthEndpointDescriptor {
  const descriptor = PROVIDER_AUTH_ENDPOINTS[provider]

  if (!descriptor) {
    throw new Error(`${getProviderImportLabelV2(provider)} 暂不支持一键网页授权，请先在“认证文件”页导入。`)
  }

  return descriptor
}

function buildManagementHeaderCandidates(
  managementApiKey: string,
): Array<Record<string, string>> {
  return dedupeStrings([managementApiKey, DEFAULT_MANAGEMENT_API_KEY]).flatMap((key) => {
    const keyHeader: Record<string, string> = { 'X-Management-Key': key }
    const bearerHeader: Record<string, string> = { Authorization: `Bearer ${key}` }
    return [keyHeader, bearerHeader]
  })
}

function inferAuthStateFromUrl(authUrl: string): string {
  try {
    return new URL(authUrl).searchParams.get('state')?.trim() ?? ''
  } catch {
    return ''
  }
}

function parseProviderAuthLaunchPayloadV2(payload: PlainObject): {
  authUrl: string
  state: string
} {
  const authUrl =
    readString(payload.auth_url).trim() ||
    readString(payload.authUrl).trim() ||
    readString(payload.url).trim()
  const state =
    readString(payload.state).trim() ||
    readString(asObject(payload.data).state).trim() ||
    inferAuthStateFromUrl(authUrl)

  if (!authUrl) {
    throw new Error('管理接口没有返回可用的授权链接。')
  }

  if (!state) {
    throw new Error('管理接口没有返回授权状态标识，请稍后再试。')
  }

  return {
    authUrl,
    state,
  }
}

async function resolveManagementRuntimeV2(): Promise<{
  managementApiKey: string
  port: number
}> {
  const guiState = await readGuiState()
  const config = parseConfigObjectV2(await readConfigText())
  const knownSettings = extractKnownSettings(config, guiState)

  return {
    port: proxyStatus.running ? proxyStatus.port : knownSettings.port,
    managementApiKey: knownSettings.managementApiKey,
  }
}

async function fetchManagementTextCompatV2(
  port: number,
  managementApiKey: string,
  endpointPath: string,
): Promise<string> {
  const requestUrl = `${buildManagementApiBaseUrl(port)}${endpointPath}`
  let lastError: Error | null = null

  for (const headers of buildManagementHeaderCandidates(managementApiKey)) {
    try {
      const response = await fetch(requestUrl, {
        headers,
        signal: AbortSignal.timeout(5000),
      })

      if (response.status === 401) {
        lastError = new Error('管理密钥无效。')
        continue
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      return await response.text()
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(typeof error === 'string' ? error : '请求失败。')
    }
  }

  throw lastError ?? new Error('管理接口请求失败。')
}

async function fetchManagementJsonCompatV2<T>(
  port: number,
  managementApiKey: string,
  endpointPath: string,
): Promise<T> {
  const rawText = await fetchManagementTextCompatV2(port, managementApiKey, endpointPath)
  return JSON.parse(rawText) as T
}

function isCandidateAuthFileNameV2(fileName: string): boolean {
  const normalized = fileName.toLowerCase()

  if (
    normalized === 'gui-state.json' ||
    normalized === 'package.json' ||
    normalized === 'package-lock.json' ||
    normalized.startsWith('_tmp_') ||
    normalized.endsWith('.lock.json') ||
    normalized.startsWith('tsconfig')
  ) {
    return false
  }

  return (
    normalized.endsWith('.json') ||
    normalized.endsWith('.disabled.json') ||
    normalized.endsWith('.json.disabled')
  )
}

async function listAuthFilesV2(): Promise<AuthFileRecord[]> {
  const { authDir } = resolvePaths()
  await fs.mkdir(authDir, { recursive: true })

  const entries = await fs.readdir(authDir, { withFileTypes: true })
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isCandidateAuthFileNameV2(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(authDir, entry.name)
        return buildLocalAuthFileRecord(entry, fullPath)
      }),
  )

  return files.sort(
    (left, right) =>
      new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime(),
  )
}

function buildProviderImportSummariesV2(authFiles: AuthFileRecord[]): ProviderImportSummary[] {
  const summaryMap = new Map<string, ProviderImportSummary>()

  for (const provider of PROVIDER_IMPORTS) {
    summaryMap.set(provider.id, {
      id: provider.id,
      label: provider.label,
      enabledCount: 0,
      disabledCount: 0,
      totalCount: 0,
      lastImportedAt: null,
    })
  }

  for (const file of authFiles) {
    const providerId = summaryMap.has(file.provider) ? file.provider : 'unknown'

    if (!summaryMap.has(providerId)) {
      summaryMap.set(providerId, {
        id: providerId,
        label: getProviderImportLabelV2(providerId),
        enabledCount: 0,
        disabledCount: 0,
        totalCount: 0,
        lastImportedAt: null,
      })
    }

    const current = summaryMap.get(providerId)

    if (!current) {
      continue
    }

    current.totalCount += 1
    current.enabledCount += file.enabled ? 1 : 0
    current.disabledCount += file.enabled ? 0 : 1

    if (
      !current.lastImportedAt ||
      new Date(file.modifiedAt).getTime() > new Date(current.lastImportedAt).getTime()
    ) {
      current.lastImportedAt = file.modifiedAt
    }
  }

  return [...summaryMap.values()].sort((left, right) => {
    if (left.totalCount !== right.totalCount) {
      return right.totalCount - left.totalCount
    }

    return left.label.localeCompare(right.label, 'zh-CN')
  })
}

async function fetchManagementTextV2(
  port: number,
  managementApiKey: string,
  endpointPath: string,
): Promise<string> {
  const requestUrl = `${buildManagementApiBaseUrl(port)}${endpointPath}`
  let lastError: Error | null = null

  for (const candidateKey of dedupeStrings([managementApiKey, DEFAULT_MANAGEMENT_API_KEY])) {
    try {
      const response = await fetch(requestUrl, {
        headers: {
          'X-Management-Key': candidateKey,
        },
        signal: AbortSignal.timeout(5000),
      })

      if (response.status === 401) {
        lastError = new Error('管理密钥无效。')
        continue
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      return await response.text()
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(typeof error === 'string' ? error : '请求失败。')
    }
  }

  throw lastError ?? new Error('管理接口请求失败。')
}

async function fetchManagementJsonV2<T>(
  port: number,
  managementApiKey: string,
  endpointPath: string,
): Promise<T> {
  const rawText = await fetchManagementTextV2(port, managementApiKey, endpointPath)
  return JSON.parse(rawText) as T
}

async function ensureProxyReadyForProviderAuthV2(): Promise<void> {
  if (proxyStatus.running && proxyChild && proxyChild.exitCode === null) {
    return
  }

  await appendLog('info', 'app', '供应商网页登录前自动启动代理。')
  await startProxyInternalV2()
}

async function getProviderAuthUrlV2(
  provider: ProviderAuthProvider,
): Promise<ProviderAuthLaunchResult> {
  await ensureProxyReadyForProviderAuthV2()

  if (!proxyStatus.running) {
    throw new Error('请先启动代理，再进行网页授权。')
  }

  const descriptor = resolveProviderAuthEndpointV2(provider)
  const runtime = await resolveManagementRuntimeV2()
  const payload = await fetchManagementJsonCompatV2<PlainObject>(
    runtime.port,
    runtime.managementApiKey,
    descriptor.endpointPath,
  )
  const launch = parseProviderAuthLaunchPayloadV2(payload)
  const label = getProviderImportLabelV2(provider)

  await appendLog('info', 'app', `已生成 ${label} 的网页授权链接。`)

  return {
    provider,
    label,
    authUrl: launch.authUrl,
    state: launch.state,
  }
}

async function checkProviderAuthStatusV2(
  provider: ProviderAuthProvider,
  state: string,
): Promise<ProviderAuthStatusResult> {
  await ensureProxyReadyForProviderAuthV2()

  if (!proxyStatus.running) {
    throw new Error('请先启动代理，再检查授权结果。')
  }

  const normalizedState = state.trim()

  if (!normalizedState) {
    throw new Error('缺少授权状态标识，无法确认网页登录结果。')
  }

  const runtime = await resolveManagementRuntimeV2()
  const payload = await fetchManagementJsonCompatV2<PlainObject>(
    runtime.port,
    runtime.managementApiKey,
    `/v0/management/get-auth-status?state=${encodeURIComponent(normalizedState)}`,
  )
  const label = getProviderImportLabelV2(provider)
  const normalizedStatus = readString(payload.status).trim().toLowerCase()
  const errorMessage = readString(payload.error).trim() || null

  if (normalizedStatus === 'ok' || normalizedStatus === 'success') {
    await new Promise((resolve) => setTimeout(resolve, 450))
    scheduleStateChanged()
    await appendLog('info', 'app', `检测到 ${label} 已完成网页授权。`)

    return {
      provider,
      label,
      state: normalizedState,
      status: 'ok',
      error: null,
    }
  }

  if (normalizedStatus === 'error') {
    return {
      provider,
      label,
      state: normalizedState,
      status: 'error',
      error: errorMessage || `${label} 授权失败，请重新生成授权链接后再试。`,
    }
  }

  return {
    provider,
    label,
    state: normalizedState,
    status: 'wait',
    error: errorMessage,
  }
}

async function fetchUsageSummaryV2(
  port: number,
  managementApiKey: string,
  query?: UsageSummaryQuery,
): Promise<UsageSummary> {
  let managementError: unknown = null

  try {
    const payload = await fetchManagementJsonV2<PlainObject>(
      port,
      managementApiKey,
      '/v0/management/usage',
    )

    const { summary } = await resolveUsageSummaryWithFallback(payload, query)
    return summary
  } catch (error) {
    managementError = error
  }

  const fallbackSummary = await buildUsageSummaryFromLogs(query)

  if (fallbackSummary) {
    return fallbackSummary
  }

  throw managementError instanceof Error ? managementError : new Error(String(managementError))
}

void fetchUsageSummaryV2

async function readKnownSettingsV2(): Promise<KnownSettings> {
  const guiState = await readGuiState()
  const config = parseConfigObjectV2(await readConfigText())
  return extractKnownSettings(config, guiState)
}

function createQuotaSummary(
  record: AuthFileRecord,
  provider: string,
  providerLabel: string,
): AuthFileQuotaSummary {
  return {
    provider,
    providerLabel,
    fetchedAt: new Date().toISOString(),
    planType: record.planType,
    metas: [],
    items: [],
  }
}

function appendQuotaMeta(
  summary: AuthFileQuotaSummary,
  label: string,
  value: string | null | undefined,
): void {
  const normalizedValue = normalizeStringValue(value)

  if (!normalizedValue) {
    return
  }

  if (summary.metas.some((item) => item.label === label && item.value === normalizedValue)) {
    return
  }

  summary.metas.push({
    label,
    value: normalizedValue,
  })
}

function normalizePercentValue(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null
  }

  const normalized = value <= 1 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(normalized)))
}

function normalizePercentLikeValue(value: unknown): number | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (!trimmed) {
      return null
    }

    if (trimmed.endsWith('%')) {
      const parsed = Number(trimmed.slice(0, -1))
      return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : null
    }
  }

  const normalized = normalizeNumberValue(value)

  if (normalized === null) {
    return null
  }

  return Math.max(0, Math.min(100, Math.round(normalized <= 1 ? normalized * 100 : normalized)))
}

function toRemainingPercentFromUsed(value: unknown): number | null {
  const normalized = normalizePercentLikeValue(value)

  if (normalized === null) {
    return null
  }

  return Math.max(0, Math.min(100, 100 - normalized))
}

function resolveRemainingPercentFromQuotaWindow(
  window: PlainObject,
  limitReached?: unknown,
): number | null {
  const explicitRemainingPercent = normalizePercentLikeValue(
    window.remaining_percent ??
      window.remainingPercent ??
      window.remaining_percentage ??
      window.remainingPercentage ??
      window.remaining_fraction ??
      window.remainingFraction ??
      window.remaining,
  )

  if (explicitRemainingPercent !== null) {
    return explicitRemainingPercent
  }

  const usedPercent = normalizePercentLikeValue(
    window.used_percent ??
      window.usedPercent ??
      window.used_percentage ??
      window.usedPercentage ??
      window.utilization,
  )

  if (usedPercent !== null) {
    return Math.max(0, Math.min(100, 100 - usedPercent))
  }

  return limitReached === true ? 0 : null
}

function formatQuotaResetTimeLabel(value?: string | null): string | null {
  const normalized = normalizeStringValue(value)

  if (!normalized) {
    return null
  }

  const parsed = new Date(normalized.replace(/(\.\d{6})\d+/, '$1'))

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatUnixSecondsLabel(value: number | null): string | null {
  if (value === null || value <= 0) {
    return null
  }

  return formatQuotaResetTimeLabel(new Date(value * 1000).toISOString())
}

function formatCodexResetLabelV2(window: PlainObject): string | null {
  const resetAt = normalizeNumberValue(window.reset_at ?? window.resetAt)

  if (resetAt !== null && resetAt > 0) {
    return formatUnixSecondsLabel(resetAt)
  }

  const resetAfterSeconds = normalizeNumberValue(
    window.reset_after_seconds ?? window.resetAfterSeconds,
  )

  if (resetAfterSeconds !== null && resetAfterSeconds > 0) {
    return formatUnixSecondsLabel(Math.floor(Date.now() / 1000 + resetAfterSeconds))
  }

  return null
}

function formatKimiResetHintV2(data: PlainObject): string | null {
  const absoluteKeys = ['reset_at', 'resetAt', 'reset_time', 'resetTime']

  for (const key of absoluteKeys) {
    const value = normalizeStringValue(data[key])
    const formatted = formatQuotaResetTimeLabel(value)

    if (formatted) {
      return formatted
    }
  }

  const relativeSeconds = normalizeNumberValue(data.reset_in ?? data.resetIn ?? data.ttl)

  if (relativeSeconds !== null && relativeSeconds > 0) {
    const hours = Math.floor(relativeSeconds / 3600)
    const minutes = Math.floor((relativeSeconds % 3600) / 60)

    if (hours > 0 && minutes > 0) {
      return `${hours}h ${minutes}m`
    }

    if (hours > 0) {
      return `${hours}h`
    }

    if (minutes > 0) {
      return `${minutes}m`
    }

    return '<1m'
  }

  return null
}

function getApiCallErrorMessageV2(result: ManagementApiCallResponse): string {
  const bodyObject = asObject(result.body)

  return (
    normalizeStringValue(bodyObject.error_description) ||
    normalizeStringValue(bodyObject.error) ||
    normalizeStringValue(bodyObject.message) ||
    normalizeStringValue(bodyObject.detail) ||
    normalizeStringValue(result.bodyText) ||
    `HTTP ${result.statusCode}`
  )
}

function normalizeApiCallHeaders(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    const headers: Record<string, string> = {}

    for (const item of value) {
      const entry = asObject(item)
      const key = normalizeStringValue(entry.key ?? entry.name)
      const headerValue = normalizeStringValue(entry.value)

      if (key && headerValue) {
        headers[key] = headerValue
      }
    }

    return headers
  }

  return Object.fromEntries(
    Object.entries(asObject(value)).flatMap(([key, headerValue]) => {
      const normalizedValue = normalizeStringValue(headerValue)
      return normalizedValue ? [[key, normalizedValue]] : []
    }),
  )
}

function parseApiCallBody(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function normalizeApiCallResponse(payload: unknown): ManagementApiCallResponse {
  const root = asObject(payload)
  const rawBodyText =
    typeof root.bodyText === 'string'
      ? root.bodyText
      : typeof root.body === 'string'
        ? root.body
        : ''

  return {
    statusCode: readNumber(root.status_code ?? root.statusCode, 0),
    headers: normalizeApiCallHeaders(root.header ?? root.headers),
    body: parseApiCallBody(root.body ?? rawBodyText),
    bodyText: rawBodyText,
  }
}

async function postManagementApiCallV2(
  runtime: { managementApiKey: string; port: number },
  request: ManagementApiCallRequest,
): Promise<ManagementApiCallResponse> {
  const requestUrl = `${buildManagementApiBaseUrl(runtime.port)}/v0/management/api-call`
  let lastError: Error | null = null

  for (const headers of buildManagementHeaderCandidates(runtime.managementApiKey)) {
    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(15000),
      })

      if (response.status === 401) {
        lastError = new Error('管理密钥无效。')
        continue
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const rawText = await response.text()

      if (!rawText.trim()) {
        return {
          statusCode: response.status,
          headers: {},
          body: '',
          bodyText: '',
        }
      }

      try {
        return normalizeApiCallResponse(JSON.parse(rawText))
      } catch {
        return {
          statusCode: response.status,
          headers: {},
          body: rawText,
          bodyText: rawText,
        }
      }
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(typeof error === 'string' ? error : '请求失败。')
    }
  }

  throw lastError ?? new Error('管理接口请求失败。')
}

function resolveQuotaProvider(record: AuthFileRecord): 'antigravity' | 'claude' | 'codex' | 'gemini-cli' | 'kimi' | null {
  const candidates = [record.provider, record.type, record.displayName]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  if (candidates.some((value) => value.includes('antigravity'))) {
    return 'antigravity'
  }

  if (candidates.some((value) => value.includes('claude'))) {
    return 'claude'
  }

  if (candidates.some((value) => value.includes('kimi'))) {
    return 'kimi'
  }

  if (candidates.some((value) => value.includes('gemini'))) {
    return 'gemini-cli'
  }

  if (
    candidates.some(
      (value) => value.includes('codex') || value.includes('openai') || value.includes('chatgpt'),
    )
  ) {
    return 'codex'
  }

  return null
}

function classifyCodexWindows(limitInfo: PlainObject): {
  fiveHourWindow: PlainObject | null
  weeklyWindow: PlainObject | null
} {
  const FIVE_HOUR_SECONDS = 18000
  const WEEK_SECONDS = 604800
  const primaryWindow = asObject(limitInfo.primary_window ?? limitInfo.primaryWindow)
  const secondaryWindow = asObject(limitInfo.secondary_window ?? limitInfo.secondaryWindow)
  const windows = [primaryWindow, secondaryWindow].filter((window) => Object.keys(window).length > 0)

  let fiveHourWindow: PlainObject | null = null
  let weeklyWindow: PlainObject | null = null

  for (const window of windows) {
    const seconds = normalizeNumberValue(window.limit_window_seconds ?? window.limitWindowSeconds)

    if (seconds === FIVE_HOUR_SECONDS && !fiveHourWindow) {
      fiveHourWindow = window
    } else if (seconds === WEEK_SECONDS && !weeklyWindow) {
      weeklyWindow = window
    }
  }

  if (!fiveHourWindow && !weeklyWindow && Object.keys(primaryWindow).length > 0) {
    fiveHourWindow = primaryWindow
  }

  if (
    !weeklyWindow &&
    Object.keys(secondaryWindow).length > 0 &&
    secondaryWindow !== fiveHourWindow
  ) {
    weeklyWindow = secondaryWindow
  }

  return {
    fiveHourWindow,
    weeklyWindow,
  }
}

function parseManagementApiBodyObject(result: ManagementApiCallResponse): PlainObject {
  const parseAsObject = (value: unknown): PlainObject | null => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return asObject(value)
    }

    if (typeof value === 'string') {
      const trimmed = value.trim()

      if (!trimmed) {
        return null
      }

      try {
        const parsed = JSON.parse(trimmed)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? asObject(parsed)
          : null
      } catch {
        return null
      }
    }

    return null
  }

  const topLevel =
    parseAsObject(result.body) ??
    parseAsObject(result.bodyText) ??
    parseAsObject((asObject(result.body).body)) ??
    {}
  const nestedBody = parseAsObject(topLevel.body)

  if (nestedBody && Object.keys(nestedBody).length > 0) {
    return nestedBody
  }

  return topLevel
}

function addCodexQuotaItem(
  items: AuthFileQuotaItem[],
  id: string,
  label: string,
  window: PlainObject | null,
  limitReached?: unknown,
): void {
  if (!window) {
    return
  }

  const remainingPercent = resolveRemainingPercentFromQuotaWindow(window, limitReached)

  items.push({
    id,
    label,
    remainingPercent,
    amountText: null,
    resetText: formatCodexResetLabelV2(window),
  })
}

function buildCodexQuotaSummary(record: AuthFileRecord, payload: PlainObject): AuthFileQuotaSummary {
  const summary = createQuotaSummary(record, 'codex', 'Codex')
  const items: AuthFileQuotaItem[] = []
  const planType =
    normalizePlanType(payload.plan_type ?? payload.planType) || record.planType

  summary.planType = planType
  appendQuotaMeta(summary, '认证文件', record.displayName)
  appendQuotaMeta(summary, '认证索引', record.authIndex)
  appendQuotaMeta(summary, '套餐', planType)

  const rateLimit = asObject(payload.rate_limit ?? payload.rateLimit)
  const codeReviewRateLimit = asObject(
    payload.code_review_rate_limit ?? payload.codeReviewRateLimit,
  )
  const primary = classifyCodexWindows(rateLimit)
  const review = classifyCodexWindows(codeReviewRateLimit)

  addCodexQuotaItem(
    items,
    'five-hour',
    '主额度 5 小时',
    primary.fiveHourWindow,
    rateLimit.limit_reached ?? rateLimit.limitReached,
  )
  addCodexQuotaItem(
    items,
    'weekly',
    '主额度 7 天',
    primary.weeklyWindow,
    rateLimit.limit_reached ?? rateLimit.limitReached,
  )
  addCodexQuotaItem(
    items,
    'code-review-five-hour',
    'Code Review 5 小时',
    review.fiveHourWindow,
    codeReviewRateLimit.limit_reached ?? codeReviewRateLimit.limitReached,
  )
  addCodexQuotaItem(
    items,
    'code-review-weekly',
    'Code Review 7 天',
    review.weeklyWindow,
    codeReviewRateLimit.limit_reached ?? codeReviewRateLimit.limitReached,
  )

  const additionalRateLimits = asArray<PlainObject>(
    payload.additional_rate_limits ?? payload.additionalRateLimits,
  )

  additionalRateLimits.forEach((item, index) => {
    const rateInfo = asObject(item.rate_limit ?? item.rateLimit)

    if (Object.keys(rateInfo).length === 0) {
      return
    }

    const label =
      normalizeStringValue(item.limit_name ?? item.limitName) ||
      normalizeStringValue(item.metered_feature ?? item.meteredFeature) ||
      `附加额度 ${index + 1}`
    const windows = classifyCodexWindows(rateInfo)

    addCodexQuotaItem(
      items,
      `additional-${index + 1}-five-hour`,
      `${label} 5 小时`,
      windows.fiveHourWindow,
      rateInfo.limit_reached ?? rateInfo.limitReached,
    )
    addCodexQuotaItem(
      items,
      `additional-${index + 1}-weekly`,
      `${label} 7 天`,
      windows.weeklyWindow,
      rateInfo.limit_reached ?? rateInfo.limitReached,
    )
  })

  summary.items = items
  return summary
}

function isSuccessfulApiCallResult(result: ManagementApiCallResponse): boolean {
  return result.statusCode >= 200 && result.statusCode < 300
}

function looksLikeCodexAccountSelectionError(result: ManagementApiCallResponse): boolean {
  const message = getApiCallErrorMessageV2(result).toLowerCase()

  return (
    message.includes('chatgpt-account-id') ||
    message.includes('chatgpt account id') ||
    message.includes('account id') ||
    message.includes('workspace') ||
    message.includes('account')
  )
}

async function requestCodexUsageV2(
  runtime: { managementApiKey: string; port: number },
  authIndex: string,
  chatgptAccountId: string | null,
): Promise<ManagementApiCallResponse> {
  const header: Record<string, string> = {
    ...CODEX_REQUEST_HEADERS,
  }

  if (chatgptAccountId) {
    header['Chatgpt-Account-Id'] = chatgptAccountId
  }

  return postManagementApiCallV2(runtime, {
    authIndex,
    method: 'GET',
    url: CODEX_USAGE_URL,
    header,
  })
}

async function resolveCodexChatgptAccountIdViaApiV2(
  runtime: { managementApiKey: string; port: number },
  authIndex: string,
): Promise<string | null> {
  for (const url of CODEX_ACCOUNT_DISCOVERY_URLS) {
    try {
      const result = await postManagementApiCallV2(runtime, {
        authIndex,
        method: 'GET',
        url,
        header: {
          ...CODEX_REQUEST_HEADERS,
        },
      })

      if (!isSuccessfulApiCallResult(result)) {
        continue
      }

      const accountId = resolveCodexChatgptAccountIdFromAccountsPayload(result.body)

      if (accountId) {
        return accountId
      }
    } catch {
      // Ignore and continue trying the next discovery endpoint.
    }
  }

  return null
}

function resolveClaudePlanTypeFromProfile(profile: PlainObject | null): string | null {
  if (!profile) {
    return null
  }

  const account = asObject(profile.account)
  const hasClaudeMax = normalizeFlagValue(account.has_claude_max)
  const hasClaudePro = normalizeFlagValue(account.has_claude_pro)

  if (hasClaudeMax) {
    return 'max'
  }

  if (hasClaudePro) {
    return 'pro'
  }

  if (hasClaudeMax === false && hasClaudePro === false) {
    return 'free'
  }

  return null
}

function buildClaudeQuotaSummary(
  record: AuthFileRecord,
  usagePayload: PlainObject,
  profilePayload: PlainObject | null,
): AuthFileQuotaSummary {
  const summary = createQuotaSummary(record, 'claude', 'Claude')
  const items: AuthFileQuotaItem[] = []
  const planType = resolveClaudePlanTypeFromProfile(profilePayload) || record.planType

  summary.planType = planType
  appendQuotaMeta(summary, '认证文件', record.displayName)
  appendQuotaMeta(summary, '认证索引', record.authIndex)
  appendQuotaMeta(summary, '套餐', planType)

  const extraUsage = asObject(usagePayload.extra_usage ?? usagePayload.extraUsage)

  if (readBoolean(extraUsage.is_enabled, false)) {
    const usedCredits = normalizeNumberValue(extraUsage.used_credits ?? extraUsage.usedCredits)
    const monthlyLimit = normalizeNumberValue(
      extraUsage.monthly_limit ?? extraUsage.monthlyLimit,
    )

    if (usedCredits !== null && monthlyLimit !== null) {
      appendQuotaMeta(
        summary,
        '附加额度',
        `$${(usedCredits / 100).toFixed(2)} / $${(monthlyLimit / 100).toFixed(2)}`,
      )
    }
  }

  for (const meta of CLAUDE_USAGE_WINDOW_KEYS) {
    const window = asObject(usagePayload[meta.key])

    if (Object.keys(window).length === 0 || !Object.prototype.hasOwnProperty.call(window, 'utilization')) {
      continue
    }

    items.push({
      id: meta.id,
      label: meta.label,
      remainingPercent: toRemainingPercentFromUsed(window.utilization),
      amountText: null,
      resetText: formatQuotaResetTimeLabel(
        normalizeStringValue(window.resets_at ?? window.resetsAt),
      ),
    })
  }

  summary.items = items
  return summary
}

function pickEarlierResetTime(current?: string, next?: string): string | undefined {
  if (!current) {
    return next
  }

  if (!next) {
    return current
  }

  const currentTime = Date.parse(current)
  const nextTime = Date.parse(next)

  if (!Number.isFinite(currentTime)) {
    return next
  }

  if (!Number.isFinite(nextTime)) {
    return current
  }

  return currentTime <= nextTime ? current : next
}

function minNullableNumber(current: number | null, next: number | null): number | null {
  if (current === null) {
    return next
  }

  if (next === null) {
    return current
  }

  return Math.min(current, next)
}

function normalizeGeminiCliModelIdV2(value: unknown): string | null {
  const modelId = normalizeStringValue(value)

  if (!modelId) {
    return null
  }

  return modelId.endsWith('_vertex') ? modelId.slice(0, -'_vertex'.length) : modelId
}

function buildGeminiCliQuotaItems(payload: PlainObject): AuthFileQuotaItem[] {
  type GeminiBucket = {
    id: string
    label: string
    modelIds: string[]
    preferredModelId?: string
    preferredBucket?: {
      modelId: string
      remainingAmount: number | null
      remainingFraction: number | null
      resetTime?: string
      tokenType: string | null
    }
    remainingAmount: number | null
    remainingFraction: number | null
    resetTime?: string
    tokenType: string | null
  }

  const grouped = new Map<string, GeminiBucket>()
  const buckets = asArray<PlainObject>(payload.buckets)

  for (const bucket of buckets) {
    const modelId = normalizeGeminiCliModelIdV2(bucket.modelId ?? bucket.model_id)

    if (!modelId || GEMINI_CLI_IGNORED_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix))) {
      continue
    }

    const tokenType = normalizeStringValue(bucket.tokenType ?? bucket.token_type)
    const remainingFractionRaw = normalizeQuotaFraction(
      bucket.remainingFraction ?? bucket.remaining_fraction,
    )
    const remainingAmount = normalizeNumberValue(
      bucket.remainingAmount ?? bucket.remaining_amount,
    )
    const resetTime = normalizeStringValue(bucket.resetTime ?? bucket.reset_time) ?? undefined
    const fallbackFraction =
      remainingFractionRaw ??
      (remainingAmount !== null ? (remainingAmount <= 0 ? 0 : null) : resetTime ? 0 : null)
    const groupDefinition =
      GEMINI_CLI_QUOTA_GROUPS.find((entry) =>
        entry.modelIds.some((candidateModelId) => candidateModelId === modelId),
      ) ?? null
    const groupId = groupDefinition?.id ?? modelId
    const key = `${groupId}::${tokenType ?? ''}`
    const existing = grouped.get(key)

    if (!existing) {
      const nextBucket: GeminiBucket = {
        id: `${groupId}${tokenType ? `-${tokenType}` : ''}`,
        label: groupDefinition?.label ?? modelId,
        modelIds: [modelId],
        preferredModelId: groupDefinition?.preferredModelId,
        remainingFraction: fallbackFraction,
        remainingAmount,
        resetTime,
        tokenType,
      }

      if (groupDefinition?.preferredModelId === modelId) {
        nextBucket.preferredBucket = {
          modelId,
          tokenType,
          remainingFraction: fallbackFraction,
          remainingAmount,
          resetTime,
        }
      }

      grouped.set(key, nextBucket)
      continue
    }

    existing.modelIds.push(modelId)
    existing.remainingFraction = minNullableNumber(existing.remainingFraction, fallbackFraction)
    existing.remainingAmount = minNullableNumber(existing.remainingAmount, remainingAmount)
    existing.resetTime = pickEarlierResetTime(existing.resetTime, resetTime)

    if (existing.preferredModelId === modelId) {
      existing.preferredBucket = {
        modelId,
        tokenType,
        remainingFraction: fallbackFraction,
        remainingAmount,
        resetTime,
      }
    }
  }

  return [...grouped.values()]
    .sort((left, right) => left.label.localeCompare(right.label, 'en'))
    .map((bucket) => {
      const preferred = bucket.preferredBucket
      const remainingFraction = preferred?.remainingFraction ?? bucket.remainingFraction
      const remainingAmount = preferred?.remainingAmount ?? bucket.remainingAmount
      const resetTime = preferred?.resetTime ?? bucket.resetTime

      return {
        id: bucket.id,
        label: bucket.label,
        remainingPercent: normalizePercentValue(remainingFraction),
        amountText:
          remainingAmount === null ? null : `${Math.round(remainingAmount).toLocaleString()} 次`,
        resetText: formatQuotaResetTimeLabel(resetTime),
      }
    })
}

function resolveGeminiCliTierInfo(payload: PlainObject | null): {
  creditBalance: number | null
  tierId: string | null
  tierLabel: string | null
} {
  if (!payload) {
    return {
      tierId: null,
      tierLabel: null,
      creditBalance: null,
    }
  }

  const paidTier = asObject(payload.paidTier ?? payload.paid_tier)
  const currentTier = asObject(payload.currentTier ?? payload.current_tier)
  const tier = Object.keys(paidTier).length > 0 ? paidTier : currentTier
  const tierId = normalizeStringValue(tier.id)?.toLowerCase() ?? null
  let creditBalance: number | null = null
  const availableCredits = asArray<PlainObject>(tier.availableCredits ?? tier.available_credits)

  for (const credit of availableCredits) {
    const creditType = normalizeStringValue(credit.creditType ?? credit.credit_type)

    if (creditType !== GEMINI_CLI_G1_CREDIT_TYPE) {
      continue
    }

    const amount = normalizeNumberValue(credit.creditAmount ?? credit.credit_amount)

    if (amount !== null) {
      creditBalance = (creditBalance ?? 0) + amount
    }
  }

  return {
    tierId,
    tierLabel: tierId ? GEMINI_CLI_TIER_LABELS[tierId] ?? tierId : null,
    creditBalance,
  }
}

function buildGeminiCliQuotaSummary(
  record: AuthFileRecord,
  quotaPayload: PlainObject,
  codeAssistPayload: PlainObject | null,
): AuthFileQuotaSummary {
  const summary = createQuotaSummary(record, 'gemini-cli', 'Gemini CLI')
  const tierInfo = resolveGeminiCliTierInfo(codeAssistPayload)

  appendQuotaMeta(summary, '认证文件', record.displayName)
  appendQuotaMeta(summary, '认证索引', record.authIndex)
  appendQuotaMeta(summary, '项目 ID', resolveGeminiCliProjectIdFromPayload(quotaPayload))
  appendQuotaMeta(summary, '套餐', record.planType)
  appendQuotaMeta(summary, '会员等级', tierInfo.tierLabel)
  appendQuotaMeta(
    summary,
    'G1 积分',
    tierInfo.creditBalance === null ? null : `${tierInfo.creditBalance}`,
  )
  summary.items = buildGeminiCliQuotaItems(quotaPayload)
  return summary
}

function getAntigravityQuotaInfoV2(entry: PlainObject): {
  displayName?: string
  remainingFraction: number | null
  resetTime?: string
} {
  const quotaInfo = asObject(entry.quotaInfo ?? entry.quota_info)
  const remainingFraction = normalizeQuotaFraction(
    quotaInfo.remainingFraction ?? quotaInfo.remaining_fraction ?? quotaInfo.remaining,
  )
  const resetTime =
    normalizeStringValue(quotaInfo.resetTime ?? quotaInfo.reset_time) ?? undefined
  const displayName = normalizeStringValue(entry.displayName) ?? undefined

  return {
    remainingFraction,
    resetTime,
    displayName,
  }
}

function findAntigravityModelV2(
  models: PlainObject,
  identifier: string,
): { entry: PlainObject; id: string } | null {
  const direct = asObject(models[identifier])

  if (Object.keys(direct).length > 0) {
    return { id: identifier, entry: direct }
  }

  for (const [id, value] of Object.entries(models)) {
    const entry = asObject(value)
    const name = normalizeStringValue(entry.displayName)

    if (name?.toLowerCase() === identifier.toLowerCase()) {
      return { id, entry }
    }
  }

  return null
}

function buildAntigravityQuotaSummary(
  record: AuthFileRecord,
  payload: PlainObject,
  projectId: string,
): AuthFileQuotaSummary {
  const summary = createQuotaSummary(record, 'antigravity', 'Antigravity')
  const items: AuthFileQuotaItem[] = []
  const models = asObject(payload.models)

  appendQuotaMeta(summary, '认证文件', record.displayName)
  appendQuotaMeta(summary, '认证索引', record.authIndex)
  appendQuotaMeta(summary, '项目 ID', projectId)

  for (const group of ANTIGRAVITY_QUOTA_GROUPS) {
    const matches = group.identifiers
      .map((identifier) => findAntigravityModelV2(models, identifier))
      .filter((value): value is { entry: PlainObject; id: string } => Boolean(value))

    const quotaEntries = matches
      .map(({ entry, id }) => {
        const quotaInfo = getAntigravityQuotaInfoV2(entry)
        const remainingFraction = quotaInfo.remainingFraction ?? (quotaInfo.resetTime ? 0 : null)

        if (remainingFraction === null) {
          return null
        }

        return {
          id,
          remainingFraction,
          resetTime: quotaInfo.resetTime,
        }
      })
      .filter(
        (
          value,
        ): value is { id: string; remainingFraction: number; resetTime: string | undefined } =>
          value !== null,
      )

    if (quotaEntries.length === 0) {
      continue
    }

    const remainingFraction = Math.min(...quotaEntries.map((entry) => entry.remainingFraction))
    const resetTime = quotaEntries.map((entry) => entry.resetTime).find(Boolean)

    items.push({
      id: group.id,
      label: group.label,
      remainingPercent: normalizePercentValue(remainingFraction),
      amountText: null,
      resetText: formatQuotaResetTimeLabel(resetTime),
    })
  }

  summary.items = items
  return summary
}

function buildKimiQuotaSummary(record: AuthFileRecord, payload: PlainObject): AuthFileQuotaSummary {
  const summary = createQuotaSummary(record, 'kimi', 'Kimi')
  const items: AuthFileQuotaItem[] = []
  const usage = asObject(payload.usage)
  const limits = asArray<PlainObject>(payload.limits)

  appendQuotaMeta(summary, '认证文件', record.displayName)
  appendQuotaMeta(summary, '认证索引', record.authIndex)

  const pushKimiItem = (id: string, label: string, data: PlainObject): void => {
    const limit = normalizeNumberValue(data.limit)
    let used = normalizeNumberValue(data.used)

    if (used === null) {
      const remaining = normalizeNumberValue(data.remaining)

      if (remaining !== null && limit !== null) {
        used = Math.max(0, limit - remaining)
      }
    }

    if (used === null && limit === null) {
      return
    }

    const remainingPercent =
      limit !== null && limit > 0
        ? Math.max(0, Math.min(100, Math.round(((limit - (used ?? 0)) / limit) * 100)))
        : (used ?? 0) > 0
          ? 0
          : null

    items.push({
      id,
      label,
      remainingPercent,
      amountText:
        limit !== null && used !== null
          ? `${Math.round(used)} / ${Math.round(limit)}`
          : null,
      resetText: formatKimiResetHintV2(data),
    })
  }

  if (Object.keys(usage).length > 0) {
    pushKimiItem('summary', '总额度', usage)
  }

  limits.forEach((limitItem, index) => {
    const detail = asObject(limitItem.detail)
    const source = Object.keys(detail).length > 0 ? detail : limitItem
    const label =
      normalizeStringValue(limitItem.name) ||
      normalizeStringValue(source.name) ||
      normalizeStringValue(limitItem.title) ||
      normalizeStringValue(source.title) ||
      `额度 ${index + 1}`

    pushKimiItem(`limit-${index + 1}`, label, source)
  })

  summary.items = items
  return summary
}

async function getAuthFileQuotaV2(fileName: string): Promise<AuthFileQuotaSummary> {
  if (!proxyStatus.running) {
    throw new Error('请先启动代理，再刷新认证文件额度。')
  }

  const state = await buildAppStateV2()
  const record = state.authFiles.find((item) => item.name === fileName)

  if (!record) {
    throw new Error(`未找到认证文件：${fileName}`)
  }

  const quotaProvider = resolveQuotaProvider(record)

  if (!quotaProvider) {
    const summary = createQuotaSummary(
      record,
      record.provider,
      getProviderImportLabelV2(record.provider),
    )
    appendQuotaMeta(summary, '认证文件', record.displayName)
    appendQuotaMeta(summary, '说明', '当前类型暂不支持额度查询')
    return summary
  }

  if (!record.authIndex) {
    throw new Error('当前认证文件还未被管理端识别，请先启动代理并刷新状态。')
  }

  const runtime = await resolveManagementRuntimeV2()
  const localPayload = await readAuthFilePayload(record.path)

  if (quotaProvider === 'codex') {
    const localChatgptAccountId = localPayload
      ? resolveCodexChatgptAccountIdFromPayload(localPayload)
      : null
    let result = await requestCodexUsageV2(
      runtime,
      record.authIndex,
      localChatgptAccountId,
    )

    if (
      !isSuccessfulApiCallResult(result) &&
      (!localChatgptAccountId || looksLikeCodexAccountSelectionError(result))
    ) {
      const discoveredChatgptAccountId = await resolveCodexChatgptAccountIdViaApiV2(
        runtime,
        record.authIndex,
      )

      if (discoveredChatgptAccountId && discoveredChatgptAccountId !== localChatgptAccountId) {
        result = await requestCodexUsageV2(
          runtime,
          record.authIndex,
          discoveredChatgptAccountId,
        )
      }
    }

    if (!isSuccessfulApiCallResult(result)) {
      throw new Error(getApiCallErrorMessageV2(result))
    }

    return buildCodexQuotaSummary(record, parseManagementApiBodyObject(result))
    /*

    if (!localChatgptAccountId) {
      throw new Error('当前 Codex 认证文件缺少 ChatGPT 账户 ID。')
    }

    const result = await postManagementApiCallV2(runtime, {
      authIndex: record.authIndex,
      method: 'GET',
      url: CODEX_USAGE_URL,
      header: {
        ...CODEX_REQUEST_HEADERS,
        'Chatgpt-Account-Id': chatgptAccountId,
      },
    })

    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(getApiCallErrorMessageV2(result))
    }

    return buildCodexQuotaSummary(record, asObject(result.body))
  }

  */
  }
  if (quotaProvider === 'claude') {
    const [usageResult, profileResult] = await Promise.all([
      postManagementApiCallV2(runtime, {
        authIndex: record.authIndex,
        method: 'GET',
        url: CLAUDE_USAGE_URL,
        header: { ...CLAUDE_REQUEST_HEADERS },
      }),
      postManagementApiCallV2(runtime, {
        authIndex: record.authIndex,
        method: 'GET',
        url: CLAUDE_PROFILE_URL,
        header: { ...CLAUDE_REQUEST_HEADERS },
      }).catch(() => ({
        statusCode: 0,
        headers: {},
        body: {},
        bodyText: '',
      })),
    ])

    if (usageResult.statusCode < 200 || usageResult.statusCode >= 300) {
      throw new Error(getApiCallErrorMessageV2(usageResult))
    }

    return buildClaudeQuotaSummary(
      record,
      parseManagementApiBodyObject(usageResult),
      profileResult.statusCode >= 200 && profileResult.statusCode < 300
        ? parseManagementApiBodyObject(profileResult)
        : null,
    )
  }

  if (quotaProvider === 'gemini-cli') {
    const projectId = localPayload
      ? resolveGeminiCliProjectIdFromPayload(localPayload)
      : null

    if (!projectId) {
      throw new Error('当前 Gemini CLI 认证文件缺少项目 ID。')
    }

    const quotaResult = await postManagementApiCallV2(runtime, {
      authIndex: record.authIndex,
      method: 'POST',
      url: GEMINI_CLI_QUOTA_URL,
      header: { ...GEMINI_CLI_REQUEST_HEADERS },
      data: JSON.stringify({ project: projectId }),
    })

    if (quotaResult.statusCode < 200 || quotaResult.statusCode >= 300) {
      throw new Error(getApiCallErrorMessageV2(quotaResult))
    }

    const codeAssistResult = await postManagementApiCallV2(runtime, {
      authIndex: record.authIndex,
      method: 'POST',
      url: GEMINI_CLI_CODE_ASSIST_URL,
      header: { ...GEMINI_CLI_REQUEST_HEADERS },
      data: JSON.stringify({
        cloudaicompanionProject: projectId,
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
          duetProject: projectId,
        },
      }),
    }).catch(() => ({
      statusCode: 0,
      headers: {},
      body: {},
      bodyText: '',
    }))

    return buildGeminiCliQuotaSummary(
      record,
      parseManagementApiBodyObject(quotaResult),
      codeAssistResult.statusCode >= 200 && codeAssistResult.statusCode < 300
        ? parseManagementApiBodyObject(codeAssistResult)
        : null,
    )
  }

  if (quotaProvider === 'antigravity') {
    const projectId = localPayload
      ? resolveAntigravityProjectIdFromPayload(localPayload)
      : DEFAULT_ANTIGRAVITY_PROJECT_ID
    let lastError = '未获取到可用额度数据。'

    for (const url of ANTIGRAVITY_QUOTA_URLS) {
      const result = await postManagementApiCallV2(runtime, {
        authIndex: record.authIndex,
        method: 'POST',
        url,
        header: { ...ANTIGRAVITY_REQUEST_HEADERS },
        data: JSON.stringify({ project: projectId }),
      }).catch((error) => ({
        statusCode: 0,
        headers: {},
        body: {},
        bodyText: toErrorMessage(error),
      }))

      if (result.statusCode >= 200 && result.statusCode < 300) {
        return buildAntigravityQuotaSummary(
          record,
          parseManagementApiBodyObject(result),
          projectId,
        )
      }

      lastError = getApiCallErrorMessageV2(result)
    }

    throw new Error(lastError)
  }

  const result = await postManagementApiCallV2(runtime, {
    authIndex: record.authIndex,
    method: 'GET',
    url: KIMI_USAGE_URL,
    header: { ...KIMI_REQUEST_HEADERS },
  })

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(getApiCallErrorMessageV2(result))
  }

  return buildKimiQuotaSummary(record, parseManagementApiBodyObject(result))
}

async function buildAppStateV2(): Promise<DesktopAppState> {
  const paths = resolvePaths()
  const initialGuiState = await readGuiState()
  const effectiveBinaryPath = await resolveBinaryPath(initialGuiState)
  await syncProxyBinaryLocalState(effectiveBinaryPath)
  const rawConfigText = await readConfigText()
  const configStats = await fs.stat(paths.configPath)

  let parsedConfig = createDefaultConfig()
  let configParseError: string | null = null

  try {
    parsedConfig = parseConfigObjectV2(rawConfigText)
    await syncGuiStateManagementApiKey(parsedConfig)
  } catch (error) {
    configParseError = error instanceof Error ? error.message : String(error)
  }

  const guiState = configParseError ? initialGuiState : await readGuiState()
  const knownSettings = extractKnownSettings(parsedConfig, guiState)

  if (!proxyStatus.running) {
    proxyStatus.port = knownSettings.port
    proxyStatus.endpoint = knownSettings.apiBaseUrl
    proxyStatus.webUiUrl = knownSettings.managementBaseUrl
    proxyStatus.binaryPath = effectiveBinaryPath
  }

  if (logBuffer.length === 0) {
    const persistedLogs = await readPersistedLogs()
    logBuffer.splice(0, 0, ...persistedLogs)
  }

  let authFiles = await listAuthFilesV2()
  let usageSummary = (await buildUsageSummaryFromLogs()) ?? emptyUsageSummary()

  if (proxyStatus.running) {
    const [usageResult, remoteAuthFilesResult] = await Promise.allSettled([
      fetchManagementJsonV2<PlainObject>(
        proxyStatus.port,
        knownSettings.managementApiKey,
        '/v0/management/usage',
      ),
      fetchManagementJsonV2<PlainObject>(
        proxyStatus.port,
        knownSettings.managementApiKey,
        '/v0/management/auth-files',
      ),
    ])

    const usagePayload =
      usageResult.status === 'fulfilled' ? usageResult.value : null
    const remoteAuthFilesPayload =
      remoteAuthFilesResult.status === 'fulfilled' ? remoteAuthFilesResult.value : null
    let managementUsageSummary: UsageSummary | null = null

    if (usagePayload) {
      const resolvedUsage = await resolveUsageSummaryWithFallback(
        usagePayload,
        undefined,
        usageSummary.available ? usageSummary : null,
      )
      managementUsageSummary = resolvedUsage.managementSummary
      usageSummary = resolvedUsage.summary
    } else if (usageResult.status === 'rejected') {
      if (!usageSummary.available) {
        usageSummary = emptyUsageSummary(toErrorMessage(usageResult.reason))
      }
    }

    if (remoteAuthFilesPayload) {
      const remoteEntries = extractRemoteAuthFileEntries(remoteAuthFilesPayload)
      const indexedRemoteEntries = indexRemoteAuthFilesByName(remoteEntries)
      const usageStatsByAuthIndex = usagePayload
        && managementUsageSummary
        && !shouldUseUsageLogFallback(managementUsageSummary)
        ? collectUsageStatsByAuthIndex(usagePayload)
        : new Map<string, AuthFileUsageStats>()

      authFiles = authFiles.map((file) =>
        mergeRemoteAuthFileRecord(
          file,
          indexedRemoteEntries.get(file.name.toLowerCase()) ?? null,
          usageStatsByAuthIndex,
        ),
      )
    }
  }

  const providerImports = buildProviderImportSummariesV2(authFiles)

  const warnings: string[] = []

  if (configParseError) {
    warnings.push(`当前 proxy-config.yaml 无法解析：${configParseError}`)
  }

  if (!effectiveBinaryPath) {
    warnings.push('尚未找到 CLIProxyAPI 二进制，请先在设置页手动选择。')
  }

  if (guiState.proxyBinaryPath && !(await pathExists(guiState.proxyBinaryPath))) {
    warnings.push(`已保存的二进制路径不存在：${guiState.proxyBinaryPath}`)
  }

  const statePaths: AppPaths = {
    baseDir: paths.baseDir,
    configPath: paths.configPath,
    guiStatePath: paths.guiStatePath,
    authDir: paths.authDir,
    logsDir: paths.logsDir,
    binaryCandidates: paths.binaryCandidates,
    effectiveBinaryPath,
  }

  return {
    paths: statePaths,
    proxyStatus: {
      ...proxyStatus,
      port: proxyStatus.running ? proxyStatus.port : knownSettings.port,
      endpoint: proxyStatus.running ? proxyStatus.endpoint : knownSettings.apiBaseUrl,
      webUiUrl: proxyStatus.running
        ? proxyStatus.webUiUrl
        : knownSettings.managementBaseUrl,
      binaryPath: proxyStatus.running
        ? proxyStatus.binaryPath || effectiveBinaryPath
        : effectiveBinaryPath,
    },
    proxyBinary: {
      ...proxyBinaryState,
      path: effectiveBinaryPath,
    },
    knownSettings,
    configText: rawConfigText,
    configMtimeMs: configStats.mtimeMs,
    configParseError,
    providers: configParseError ? [] : readProviders(parsedConfig),
    aiProviders: configParseError
      ? {
          gemini: [],
          codex: [],
          claude: [],
          vertex: [],
          openaiCompatibility: [],
          ampcode: null,
        }
      : readAiProviders(parsedConfig),
    authFiles,
    providerImports,
    usageSummary,
    logs: [...logBuffer].slice(-MAX_LOG_ENTRIES),
    warnings,
  }
}

async function waitForManagementReadyV2(
  port: number,
  managementApiKey: string,
): Promise<void> {
  let lastError: string | null = null

  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (!proxyChild || proxyChild.exitCode !== null || !proxyStatus.running) {
      throw new Error('代理进程启动后立即退出，请检查二进制和当前 YAML 配置。')
    }

    try {
      await fetchManagementTextV2(port, managementApiKey, '/v0/management/config.yaml')
      return
    } catch (error) {
      lastError = toErrorMessage(error)
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  await appendLog(
    'warn',
    'app',
    lastError
      ? `管理接口未在预期时间内就绪：${lastError}`
      : '管理接口未在预期时间内就绪，但代理进程已经启动。',
  )
}

async function prepareConfigForLaunchV2(): Promise<{
  config: PlainObject
  guiState: GuiState
  knownSettings: KnownSettings
}> {
  const guiState = await readGuiState()
  const configText = await readConfigText()
  const config = parseConfigObjectV2(configText)

  ensureRequiredConfigFields(config)
  const remoteManagement = readRemoteManagementConfig(config)
  remoteManagement['secret-key'] = resolveManagementApiKey(config, guiState)
  config['remote-management'] = remoteManagement

  const desktop = getDesktopMetadata(config)
  const useSystemProxy = readBoolean(desktop['use-system-proxy'], false)

  if (useSystemProxy) {
    const systemProxyUrl = await detectSystemProxyUrl()

    if (systemProxyUrl) {
      config['proxy-url'] = systemProxyUrl
    } else if (!readString(config['proxy-url']).trim()) {
      await appendLog(
        'warn',
        'app',
        '已启用 Use System Proxy，但当前没有检测到系统代理地址。',
      )
    }
  }

  const nextGuiState = await writeGuiState({
    managementApiKey: readString(remoteManagement['secret-key']) || DEFAULT_MANAGEMENT_API_KEY,
  })
  await writeConfigObjectV2(config)

  return {
    config,
    guiState: nextGuiState,
    knownSettings: extractKnownSettings(config, nextGuiState),
  }
}

async function startProxyInternalV2(): Promise<DesktopAppState> {
  if (proxyStatus.running && proxyChild && proxyChild.exitCode === null) {
    return buildAppStateV2()
  }

  const binaryPath = await ensureProxyBinaryInstalled()

  if (!binaryPath) {
    throw new Error('没有找到可用的 CLIProxyAPI 二进制，请先在设置页手动选择。')
  }

  const { knownSettings } = await prepareConfigForLaunchV2()

  proxyStopRequested = false
  proxyStatus.running = true
  proxyStatus.pid = null
  proxyStatus.port = knownSettings.port
  proxyStatus.endpoint = knownSettings.apiBaseUrl
  proxyStatus.webUiUrl = knownSettings.managementBaseUrl
  proxyStatus.binaryPath = binaryPath
  proxyStatus.startedAt = new Date().toISOString()
  proxyStatus.stoppedAt = null
  proxyStatus.lastExitCode = null
  proxyStatus.lastError = null
  updateTrayContextMenu()

  await appendLog('info', 'app', `启动代理：${binaryPath}`)

  const child = spawn(binaryPath, ['--config', resolvePaths().configPath], {
    cwd: resolvePaths().baseDir,
    env: {
      ...process.env,
      WRITABLE_PATH: resolvePaths().baseDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  proxyChild = child
  proxyStatus.pid = child.pid ?? null

  child.stdout.on('data', (chunk) => {
    void appendLog('info', 'proxy', chunk.toString())
  })

  child.stderr.on('data', (chunk) => {
    void appendLog('error', 'proxy', chunk.toString())
  })

  child.once('error', (error) => {
    proxyChild = null
    proxyStatus.running = false
    proxyStatus.pid = null
    proxyStatus.stoppedAt = new Date().toISOString()
    proxyStatus.lastError = error.message
    void appendLog('error', 'app', `代理启动失败：${error.message}`)
    scheduleStateChanged()
  })

  child.once('exit', (code, signal) => {
    const expectedStop = proxyStopRequested
    proxyStopRequested = false
    proxyChild = null
    proxyStatus.running = false
    proxyStatus.pid = null
    proxyStatus.stoppedAt = new Date().toISOString()
    proxyStatus.lastExitCode = code

    if (expectedStop) {
      proxyStatus.lastError = null
      void appendLog('info', 'app', '代理已停止。')
    } else {
      proxyStatus.lastError =
        code !== null
          ? `代理进程异常退出，退出码 ${code}${signal ? `，信号 ${signal}` : ''}`
          : `代理进程异常退出${signal ? `，信号 ${signal}` : ''}`
      void appendLog('warn', 'app', proxyStatus.lastError)
    }

    scheduleStateChanged()
  })

  await waitForManagementReadyV2(
    knownSettings.port,
    knownSettings.managementApiKey,
  ).catch(async (error) => {
    await appendLog('warn', 'app', error instanceof Error ? error.message : String(error))
  })

  scheduleStateChanged()
  return buildAppStateV2()
}

async function syncRuntimeConfigFileV2(): Promise<void> {
  if (!proxyStatus.running) {
    throw new Error('代理尚未运行，无法从运行时同步配置。')
  }

  const guiState = await readGuiState()
  const localConfigText = await readConfigText()
  const localConfig = parseConfigObjectV2(localConfigText)
  const localDesktopMetadata = getDesktopMetadata(localConfig)
  const localAuthDir = readString(localConfig['auth-dir'])
  const managementApiKey = resolveManagementApiKey(localConfig, guiState)
  const remoteText = await fetchManagementTextV2(
    clampPort(readNumber(localConfig.port, proxyStatus.port)),
    managementApiKey,
    '/v0/management/config.yaml',
  )
  const remoteConfig = parseConfigObjectV2(remoteText)
  const mergedDesktopMetadata = {
    ...getDesktopMetadata(remoteConfig),
    ...localDesktopMetadata,
  }

  if (Object.keys(mergedDesktopMetadata).length > 0) {
    remoteConfig[DESKTOP_METADATA_KEY] = mergedDesktopMetadata
  }

  if (localAuthDir) {
    remoteConfig['auth-dir'] = localAuthDir
  }

  const remoteManagement = readRemoteManagementConfig(remoteConfig)
  remoteManagement['secret-key'] = managementApiKey
  remoteConfig['remote-management'] = remoteManagement

  await writeGuiState({
    managementApiKey,
  })
  await writeConfigObjectV2(remoteConfig)

  proxyStatus.lastSyncAt = new Date().toISOString()
  await appendLog('info', 'app', '已从运行中的 CLIProxyAPI 同步 config.yaml 回本地文件。')
}

async function stopProxyInternalV2(): Promise<DesktopAppState> {
  if (!proxyStatus.running || !proxyChild) {
    return buildAppStateV2()
  }

  const guiState = await readGuiState()

  if (guiState.autoSyncOnStop) {
    try {
      await syncRuntimeConfigFileV2()
    } catch (error) {
      await appendLog(
        'warn',
        'app',
        `停止前同步运行时配置失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  proxyStopRequested = true
  const pid = proxyChild.pid ?? null

  proxyChild.kill()

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!proxyStatus.running) {
      break
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  if (proxyStatus.running) {
    await killProcessTree(pid)
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!proxyStatus.running) {
      break
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  if (proxyStatus.running) {
    proxyChild = null
    proxyStatus.running = false
    proxyStatus.pid = null
    proxyStatus.stoppedAt = new Date().toISOString()
    proxyStatus.lastError = null
    await appendLog('info', 'app', '代理已停止。')
  }

  await ingestUsageLogsToStore().catch(() => undefined)
  scheduleStateChanged()
  return buildAppStateV2()
}

function startWatchersV2(): void {
  const paths = resolvePaths()

  void configWatcher?.close()
  void authWatcher?.close()
  void usageLogWatcher?.close()

  configWatcher = chokidar.watch(paths.configPath, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  })

  authWatcher = chokidar.watch(buildAuthWatchPatterns(), {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  })

  usageLogWatcher = chokidar.watch(buildUsageLogWatchPattern(), {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1200,
      pollInterval: 100,
    },
  })

  configWatcher.on('all', () => {
    scheduleStateChanged()
  })

  authWatcher.on('all', (_eventName, changedPath) => {
    if (changedPath && !isCandidateAuthFileNameV2(path.basename(changedPath))) {
      return
    }

    scheduleStateChanged()
  })

  usageLogWatcher.on('all', () => {
    scheduleUsageLogIngestion()
  })
}

function deleteProviderAtIndexV2(config: PlainObject, index: number): void {
  const providers = asArray<PlainObject>(config['openai-compatibility'])

  if (index < 0 || index >= providers.length) {
    throw new Error('提供商索引不存在。')
  }

  providers.splice(index, 1)

  if (providers.length === 0) {
    delete config['openai-compatibility']
    return
  }

  config['openai-compatibility'] = providers
}

function registerIpcHandlersV2(): void {
  ipcMain.handle('cliproxy:getAppState', async () => buildAppStateV2())

  ipcMain.handle('cliproxy:saveConfigText', async (_event, text: string) => {
    const parsed = parseConfigObjectV2(text)
    await syncGuiStateManagementApiKey(parsed)
    await writeConfigObjectV2(parsed)
    return buildAppStateV2()
  })

  ipcMain.handle(
    'cliproxy:saveKnownSettings',
    async (_event, input: SaveKnownSettingsInput) => {
      const config = parseConfigObjectV2(await readConfigText())
      await applyKnownSettings(config, input)
      await writeConfigObjectV2(config)
      const nextGuiState = await writeGuiState({
        reasoningEffort: input.reasoningEffort,
        autoSyncOnStop: input.autoSyncOnStop,
        managementApiKey: input.managementApiKey.trim() || DEFAULT_MANAGEMENT_API_KEY,
        launchAtLogin: input.launchAtLogin,
        autoStartProxyOnLaunch: input.autoStartProxyOnLaunch,
        minimizeToTrayOnClose: input.minimizeToTrayOnClose,
      })
      applyLaunchAtLoginSetting(nextGuiState.launchAtLogin)
      return buildAppStateV2()
    },
  )

  ipcMain.handle('cliproxy:startProxy', async () => startProxyInternalV2())
  ipcMain.handle('cliproxy:stopProxy', async () => stopProxyInternalV2())

  ipcMain.handle('cliproxy:syncRuntimeConfig', async () => {
    await syncRuntimeConfigFileV2()
    return buildAppStateV2()
  })

  ipcMain.handle('cliproxy:refreshUsage', async () => buildAppStateV2())

  ipcMain.handle('cliproxy:getUsageSummary', async (_event, query?: UsageSummaryQuery) => {
    if (!proxyStatus.running) {
      return (await buildUsageSummaryFromLogs(query)) ?? emptyUsageSummary(null, query)
    }

    try {
      const knownSettings = await readKnownSettingsV2()
      return await fetchUsageSummaryV2(proxyStatus.port, knownSettings.managementApiKey, query)
    } catch (error) {
      return emptyUsageSummary(toErrorMessage(error), query)
    }
  })

  ipcMain.handle(
    'cliproxy:getProviderAuthUrl',
    async (_event, provider: ProviderAuthProvider) => getProviderAuthUrlV2(provider),
  )

  ipcMain.handle(
    'cliproxy:checkProviderAuthStatus',
    async (_event, provider: ProviderAuthProvider, state: string) =>
      checkProviderAuthStatusV2(provider, state),
  )

  ipcMain.handle('cliproxy:checkProxyBinaryUpdate', async () => {
    await refreshProxyBinaryState()
    return buildAppStateV2()
  })

  ipcMain.handle('cliproxy:updateProxyBinary', async () => {
    await updateProxyBinaryInternal()
    return buildAppStateV2()
  })

  ipcMain.handle('cliproxy:pickAuthFiles', async (_event, providerHint?: string) => {
    const providerLabel = getProviderImportLabelV2(providerHint ?? '')
    const options: OpenDialogOptions = {
      title: providerHint ? `导入 ${providerLabel} 认证文件` : '导入认证文件',
      filters: [
        { name: 'JSON 文件', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['multiSelections', 'openFile'],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)

    if (!result.canceled && result.filePaths.length > 0) {
      await copyAuthFiles(result.filePaths, providerHint)
      await appendLog(
        'info',
        'app',
        providerHint
          ? `已导入 ${result.filePaths.length} 个 ${providerLabel} 认证文件到程序同目录。`
          : `已导入 ${result.filePaths.length} 个认证文件到程序同目录。`,
      )
    }

    return buildAppStateV2()
  })

  ipcMain.handle('cliproxy:deleteAuthFile', async (_event, fileName: string) => {
    const targetPath = resolveInsideDirectory(resolvePaths().authDir, fileName)
    await fs.unlink(targetPath)
    await appendLog('info', 'app', `已删除认证文件：${fileName}`)
    return buildAppStateV2()
  })

  ipcMain.handle('cliproxy:toggleAuthFile', async (_event, fileName: string) => {
    const sourcePath = resolveInsideDirectory(resolvePaths().authDir, fileName)
    const willEnable = isDisabledAuthFile(fileName)
    const nextName = willEnable ? toEnabledAuthName(fileName) : toDisabledAuthName(fileName)
    const targetPath = resolveInsideDirectory(resolvePaths().authDir, nextName)

    if (await pathExists(targetPath)) {
      throw new Error(`目标文件已存在：${nextName}`)
    }

    await fs.rename(sourcePath, targetPath)
    await appendLog('info', 'app', `认证文件已${willEnable ? '启用' : '禁用'}：${fileName}`)
    return buildAppStateV2()
  })

  ipcMain.handle('cliproxy:getAuthFileQuota', async (_event, fileName: string) =>
    getAuthFileQuotaV2(fileName),
  )

  ipcMain.handle('cliproxy:saveProvider', async (_event, input: SaveProviderInput) => {
    if (!input.name.trim() || !input.baseUrl.trim() || !input.apiKey.trim()) {
      throw new Error('提供商名称、Base URL 和 API Key 不能为空。')
    }

    const config = parseConfigObjectV2(await readConfigText())
    applyProvider(config, input)
    await writeConfigObjectV2(config)
    await appendLog('info', 'app', `已保存提供商：${input.name.trim()}`)
    return buildAppStateV2()
  })

  ipcMain.handle('cliproxy:deleteProvider', async (_event, index: number) => {
    const config = parseConfigObjectV2(await readConfigText())
    deleteProviderAtIndexV2(config, index)
    await writeConfigObjectV2(config)
    await appendLog('info', 'app', `已删除提供商，索引 ${index}`)
    return buildAppStateV2()
  })

  ipcMain.handle('cliproxy:saveAiProvider', async (_event, input: SaveAiProviderInput) => {
    const config = parseConfigObjectV2(await readConfigText())
    applyAiProvider(config, input)
    await writeConfigObjectV2(config)
    await appendLog('info', 'app', `已保存 ${aiProviderKindLabel(input.kind)} 配置。`)
    return buildAppStateV2()
  })

  ipcMain.handle('cliproxy:deleteAiProvider', async (_event, input: DeleteAiProviderInput) => {
    const config = parseConfigObjectV2(await readConfigText())
    deleteAiProvider(config, input)
    await writeConfigObjectV2(config)
    await appendLog('info', 'app', `已删除 ${aiProviderKindLabel(input.kind)} 配置。`)
    return buildAppStateV2()
  })

  ipcMain.handle('cliproxy:openPath', async (_event, targetPath: string) => {
    const errorMessage = await shell.openPath(targetPath)

    if (errorMessage) {
      throw new Error(errorMessage)
    }
  })

  ipcMain.handle('cliproxy:openExternal', async (_event, targetUrl: string) => {
    await shell.openExternal(targetUrl)
  })

  ipcMain.handle('cliproxy:clearLogs', async () => {
    await ingestUsageLogsToStore().catch(() => undefined)
    const { logsDir } = resolvePaths()
    const entries = await fs.readdir(logsDir, { withFileTypes: true })

    for (const entry of entries) {
      const targetPath = resolveInsideDirectory(logsDir, entry.name)

      if (entry.isDirectory()) {
        await fs.rm(targetPath, { recursive: true, force: true })
      } else {
        await fs.writeFile(targetPath, '', 'utf8')
      }
    }

    logBuffer.splice(0, logBuffer.length)
    await appendLog('info', 'app', '日志已清空。')
    return buildAppStateV2()
  })
}

async function bootstrapV2(): Promise<void> {
  await ensureAppFiles()
  await ingestUsageLogsToStore().catch(() => undefined)
  app.setName(APP_PRODUCT_NAME)
  if (process.platform === 'darwin') {
    app.dock?.hide()
  }
  const guiState = await readGuiState()
  applyLaunchAtLoginSetting(guiState.launchAtLogin)
  registerIpcHandlersV2()
  startWatchersV2()
  ensureTray()
  mainWindow = createWindow()

  if (guiState.autoStartProxyOnLaunch) {
    void startProxyInternalV2().catch(async (error) => {
      await appendLog('error', 'app', `开机后自动启动代理失败：${toErrorMessage(error)}`)
      scheduleStateChanged()
    })
  }

  void refreshProxyBinaryState()
    .catch(async (error) => {
      proxyBinaryState.lastError = toErrorMessage(error)
      await appendLog('warn', 'app', `CLIProxyAPI 更新检查失败：${proxyBinaryState.lastError}`)
    })
    .finally(() => {
      scheduleStateChanged()
    })
}

async function buildAppState(): Promise<DesktopAppState> {
  const paths = resolvePaths()
  const guiState = await readGuiState()
  const effectiveBinaryPath = await resolveBinaryPath(guiState)
  await syncProxyBinaryLocalState(effectiveBinaryPath)
  const rawConfigText = await readConfigText()
  const configStats = await fs.stat(paths.configPath)

  let parsedConfig = createDefaultConfig()
  let configParseError: string | null = null

  try {
    parsedConfig = parseConfigObject(rawConfigText)
  } catch (error) {
    configParseError = error instanceof Error ? error.message : String(error)
  }

  const knownSettings = extractKnownSettings(parsedConfig, guiState)

  if (!proxyStatus.running) {
    proxyStatus.port = knownSettings.port
    proxyStatus.endpoint = knownSettings.apiBaseUrl
    proxyStatus.webUiUrl = knownSettings.managementBaseUrl
    proxyStatus.binaryPath = effectiveBinaryPath
  }

  if (logBuffer.length === 0) {
    const persistedLogs = await readPersistedLogs()
    logBuffer.splice(0, 0, ...persistedLogs)
  }

  const warnings: string[] = []

  if (configParseError) {
    warnings.push(`当前 proxy-config.yaml 无法解析：${configParseError}`)
  }

  if (!effectiveBinaryPath) {
    warnings.push('尚未找到 CLIProxyAPI 二进制，请在设置页手动选择。')
  }

  if (guiState.proxyBinaryPath && !(await pathExists(guiState.proxyBinaryPath))) {
    warnings.push(`已保存的二进制路径不存在：${guiState.proxyBinaryPath}`)
  }

  const statePaths: AppPaths = {
    baseDir: paths.baseDir,
    configPath: paths.configPath,
    guiStatePath: paths.guiStatePath,
    authDir: paths.authDir,
    logsDir: paths.logsDir,
    binaryCandidates: paths.binaryCandidates,
    effectiveBinaryPath,
  }

  return {
    paths: statePaths,
    proxyStatus: {
      ...proxyStatus,
      port: proxyStatus.running ? proxyStatus.port : knownSettings.port,
      endpoint: proxyStatus.running ? proxyStatus.endpoint : knownSettings.apiBaseUrl,
      webUiUrl: proxyStatus.running
        ? proxyStatus.webUiUrl
        : knownSettings.managementBaseUrl,
      binaryPath: proxyStatus.running
        ? proxyStatus.binaryPath || effectiveBinaryPath
        : effectiveBinaryPath,
    },
    proxyBinary: {
      ...proxyBinaryState,
      path: effectiveBinaryPath,
    },
    knownSettings,
    configText: rawConfigText,
    configMtimeMs: configStats.mtimeMs,
    configParseError,
    providers: configParseError ? [] : readProviders(parsedConfig),
    aiProviders: configParseError
      ? {
          gemini: [],
          codex: [],
          claude: [],
          vertex: [],
          openaiCompatibility: [],
          ampcode: null,
        }
      : readAiProviders(parsedConfig),
    authFiles: await listAuthFiles(),
    providerImports: [],
    usageSummary: EMPTY_USAGE_SUMMARY,
    logs: [...logBuffer].slice(-MAX_LOG_ENTRIES),
    warnings,
  }
}

async function waitForManagementReady(port: number, managementApiKey: string): Promise<void> {
  const managementConfigUrl = `${buildManagementApiBaseUrl(port)}/v0/management/config.yaml`

  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (!proxyChild || proxyChild.exitCode !== null || !proxyStatus.running) {
      throw new Error('代理进程启动后立即退出，请检查二进制和当前 YAML 配置。')
    }

    try {
      const response = await fetch(managementConfigUrl, {
        headers: {
          'X-Management-Key': managementApiKey,
        },
      })

      if (response.ok) {
        return
      }
    } catch {
      // Ignore until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  await appendLog(
    'warn',
    'app',
    '管理接口没有在预期时间内就绪，但代理进程已经启动。',
  )
}

async function prepareConfigForLaunch(): Promise<{
  config: PlainObject
  guiState: GuiState
  knownSettings: KnownSettings
}> {
  const guiState = await readGuiState()
  const configText = await readConfigText()
  const config = parseConfigObject(configText)

  ensureRequiredConfigFields(config)
  const desktop = getDesktopMetadata(config)
  const useSystemProxy = readBoolean(desktop['use-system-proxy'], false)

  if (useSystemProxy) {
    const systemProxyUrl = await detectSystemProxyUrl()

    if (systemProxyUrl) {
      config['proxy-url'] = systemProxyUrl
    } else if (!readString(config['proxy-url']).trim()) {
      await appendLog(
        'warn',
        'app',
        '已启用 Use System Proxy，但当前没有检测到系统代理地址。',
      )
    }
  }

  await writeConfigObject(config)

  return {
    config,
    guiState,
    knownSettings: extractKnownSettings(config, guiState),
  }
}

async function killProcessTree(pid: number | null): Promise<void> {
  if (!pid) {
    return
  }

  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
    }).catch(() => undefined)
    return
  }

  process.kill(pid, 'SIGKILL')
}

async function startProxyInternal(): Promise<DesktopAppState> {
  if (proxyStatus.running && proxyChild && proxyChild.exitCode === null) {
    return buildAppState()
  }

  const binaryPath = await ensureProxyBinaryInstalled()

  if (!binaryPath) {
    throw new Error('没有找到可用的 CLIProxyAPI 二进制，请先在设置页手动选择。')
  }

  const { knownSettings } = await prepareConfigForLaunch()

  proxyStopRequested = false
  proxyStatus.running = true
  proxyStatus.pid = null
  proxyStatus.port = knownSettings.port
  proxyStatus.endpoint = knownSettings.apiBaseUrl
  proxyStatus.webUiUrl = knownSettings.managementBaseUrl
  proxyStatus.binaryPath = binaryPath
  proxyStatus.startedAt = new Date().toISOString()
  proxyStatus.stoppedAt = null
  proxyStatus.lastExitCode = null
  proxyStatus.lastError = null

  await appendLog('info', 'app', `启动代理：${binaryPath}`)

  const child = spawn(binaryPath, ['--config', resolvePaths().configPath], {
    cwd: resolvePaths().baseDir,
    env: {
      ...process.env,
      WRITABLE_PATH: resolvePaths().baseDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  proxyChild = child
  proxyStatus.pid = child.pid ?? null

  child.stdout.on('data', (chunk) => {
    void appendLog('info', 'proxy', chunk.toString())
  })

  child.stderr.on('data', (chunk) => {
    void appendLog('error', 'proxy', chunk.toString())
  })

  child.once('error', (error) => {
    proxyChild = null
    proxyStatus.running = false
    proxyStatus.pid = null
    proxyStatus.stoppedAt = new Date().toISOString()
    proxyStatus.lastError = error.message
    void appendLog('error', 'app', `代理启动失败：${error.message}`)
    scheduleStateChanged()
  })

  child.once('exit', (code, signal) => {
    const expectedStop = proxyStopRequested
    proxyStopRequested = false
    proxyChild = null
    proxyStatus.running = false
    proxyStatus.pid = null
    proxyStatus.stoppedAt = new Date().toISOString()
    proxyStatus.lastExitCode = code

    if (expectedStop) {
      proxyStatus.lastError = null
      void appendLog('info', 'app', '代理已停止。')
    } else {
      proxyStatus.lastError =
        code !== null
          ? `代理进程异常退出，退出码 ${code}${signal ? `，信号 ${signal}` : ''}`
          : `代理进程异常退出${signal ? `，信号 ${signal}` : ''}`
      void appendLog('warn', 'app', proxyStatus.lastError)
    }

    scheduleStateChanged()
  })

  await waitForManagementReady(
    knownSettings.port,
    knownSettings.managementApiKey,
  ).catch(async (error) => {
    await appendLog(
      'warn',
      'app',
      error instanceof Error ? error.message : String(error),
    )
  })

  return buildAppState()
}

async function syncRuntimeConfigFile(): Promise<void> {
  if (!proxyStatus.running) {
    throw new Error('代理尚未运行，无法从运行时同步配置。')
  }

  const localConfigText = await readConfigText()
  const localConfig = parseConfigObject(localConfigText)
  const localDesktopMetadata = getDesktopMetadata(localConfig)
  const localAuthDir = readString(localConfig['auth-dir'])
  const managementApiKey = readString(
    asObject(localConfig['remote-management'])['secret-key'],
    DEFAULT_MANAGEMENT_API_KEY,
  )
  const syncUrl = `${buildManagementApiBaseUrl(clampPort(readNumber(localConfig.port, proxyStatus.port)))}/v0/management/config.yaml`

  const response = await fetch(syncUrl, {
    headers: {
      'X-Management-Key': managementApiKey,
    },
  })

  if (!response.ok) {
    throw new Error(`运行时配置同步失败：HTTP ${response.status}`)
  }

  const remoteText = await response.text()
  const remoteConfig = parseConfigObject(remoteText)

  if (
    Object.keys(localDesktopMetadata).length > 0 &&
    Object.keys(getDesktopMetadata(remoteConfig)).length === 0
  ) {
    remoteConfig[DESKTOP_METADATA_KEY] = localDesktopMetadata
  }

  if (localAuthDir && !readString(remoteConfig['auth-dir'])) {
    remoteConfig['auth-dir'] = localAuthDir
  }

  ensureRequiredConfigFields(remoteConfig)
  await writeConfigObject(remoteConfig)

  proxyStatus.lastSyncAt = new Date().toISOString()
  await appendLog('info', 'app', '已从运行中的 CLIProxyAPI 同步 config.yaml 回本地文件。')
}

async function stopProxyInternal(): Promise<DesktopAppState> {
  if (!proxyStatus.running || !proxyChild) {
    return buildAppState()
  }

  const guiState = await readGuiState()

  if (guiState.autoSyncOnStop) {
    try {
      await syncRuntimeConfigFile()
    } catch (error) {
      await appendLog(
        'warn',
        'app',
        `停止前同步运行时配置失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  proxyStopRequested = true
  const pid = proxyChild.pid ?? null

  proxyChild.kill()

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!proxyStatus.running) {
      break
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  if (proxyStatus.running) {
    await killProcessTree(pid)
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!proxyStatus.running) {
      break
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  if (proxyStatus.running) {
    proxyChild = null
    proxyStatus.running = false
    proxyStatus.pid = null
    proxyStatus.stoppedAt = new Date().toISOString()
    proxyStatus.lastError = null
    await appendLog('info', 'app', '代理已停止。')
  }

  return buildAppState()
}

function startWatchers(): void {
  const paths = resolvePaths()

  void configWatcher?.close()
  void authWatcher?.close()

  configWatcher = chokidar.watch(paths.configPath, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  })

  authWatcher = chokidar.watch(paths.authDir, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  })

  configWatcher.on('all', () => {
    scheduleStateChanged()
  })

  authWatcher.on('all', () => {
    scheduleStateChanged()
  })
}

function createWindow(): BrowserWindow {
  const devServerUrl = process.env.CLIPROXY_DEV_SERVER_URL
  const window = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#091219',
    icon: resolveTrayIconPath(),
    skipTaskbar: process.platform === 'darwin',
    title: APP_PRODUCT_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(path.resolve(__dirname, '../dist/index.html'))
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.on('close', (event) => {
    if (!appQuitRequested && tray && guiStateCache.minimizeToTrayOnClose) {
      event.preventDefault()
      window.hide()
    }
  })

  window.on('show', () => {
    updateTrayContextMenu()
  })

  window.on('hide', () => {
    updateTrayContextMenu()
  })

  window.on('closed', () => {
    mainWindow = null
    updateTrayContextMenu()
  })

  return window
}

function registerIpcHandlers(): void {
  ipcMain.handle('cliproxy:getAppState', async () => buildAppState())

  ipcMain.handle('cliproxy:saveConfigText', async (_event, text: string) => {
    const parsed = parseConfigObject(text)
    await writeConfigObject(parsed)
    return buildAppState()
  })

  ipcMain.handle(
    'cliproxy:saveKnownSettings',
    async (_event, input: SaveKnownSettingsInput) => {
      const config = parseConfigObject(await readConfigText())
      await applyKnownSettings(config, input)
      await writeConfigObject(config)
      await writeGuiState({
        reasoningEffort: input.reasoningEffort,
        autoSyncOnStop: input.autoSyncOnStop,
      })
      return buildAppState()
    },
  )

  ipcMain.handle('cliproxy:startProxy', async () => startProxyInternal())
  ipcMain.handle('cliproxy:stopProxy', async () => stopProxyInternal())

  ipcMain.handle('cliproxy:syncRuntimeConfig', async () => {
    await syncRuntimeConfigFile()
    return buildAppState()
  })

  ipcMain.handle('cliproxy:checkProxyBinaryUpdate', async () => {
    await refreshProxyBinaryState()
    return buildAppState()
  })

  ipcMain.handle('cliproxy:updateProxyBinary', async () => {
    await updateProxyBinaryInternal()
    return buildAppState()
  })

  ipcMain.handle('cliproxy:pickAuthFiles', async () => {
    const options: OpenDialogOptions = {
      title: '选择认证文件',
      filters: [
        { name: 'JSON 文件', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['multiSelections', 'openFile'],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)

    if (!result.canceled && result.filePaths.length > 0) {
      await copyAuthFiles(result.filePaths)
      await appendLog(
        'info',
        'app',
        `已导入 ${result.filePaths.length} 个认证文件到 auth 目录。`,
      )
    }

    return buildAppState()
  })

  ipcMain.handle('cliproxy:deleteAuthFile', async (_event, fileName: string) => {
    const targetPath = resolveInsideDirectory(resolvePaths().authDir, fileName)
    await fs.unlink(targetPath)
    await appendLog('info', 'app', `已删除认证文件：${fileName}`)
    return buildAppState()
  })

  ipcMain.handle('cliproxy:toggleAuthFile', async (_event, fileName: string) => {
    const sourcePath = resolveInsideDirectory(resolvePaths().authDir, fileName)
    const nextName = isDisabledAuthFile(fileName)
      ? toEnabledAuthName(fileName)
      : toDisabledAuthName(fileName)
    const targetPath = resolveInsideDirectory(resolvePaths().authDir, nextName)

    if (await pathExists(targetPath)) {
      throw new Error(`目标文件已存在：${nextName}`)
    }

    await fs.rename(sourcePath, targetPath)
    await appendLog(
      'info',
      'app',
      `认证文件已${isDisabledAuthFile(fileName) ? '启用' : '禁用'}：${fileName}`,
    )
    return buildAppState()
  })

  ipcMain.handle('cliproxy:saveProvider', async (_event, input: SaveProviderInput) => {
    if (!input.name.trim() || !input.baseUrl.trim() || !input.apiKey.trim()) {
      throw new Error('提供商名称、Base URL 和 API Key 不能为空。')
    }

    const config = parseConfigObject(await readConfigText())
    applyProvider(config, input)
    await writeConfigObject(config)
    await appendLog('info', 'app', `已保存提供商：${input.name.trim()}`)
    return buildAppState()
  })

  ipcMain.handle('cliproxy:deleteProvider', async (_event, index: number) => {
    const config = parseConfigObject(await readConfigText())
    deleteProviderAtIndex(config, index)
    await writeConfigObject(config)
    await appendLog('info', 'app', `已删除提供商，索引 ${index}`)
    return buildAppState()
  })

  ipcMain.handle('cliproxy:saveAiProvider', async (_event, input: SaveAiProviderInput) => {
    const config = parseConfigObject(await readConfigText())
    applyAiProvider(config, input)
    await writeConfigObject(config)
    await appendLog('info', 'app', `已保存 ${aiProviderKindLabel(input.kind)} 配置。`)
    return buildAppState()
  })

  ipcMain.handle('cliproxy:deleteAiProvider', async (_event, input: DeleteAiProviderInput) => {
    const config = parseConfigObject(await readConfigText())
    deleteAiProvider(config, input)
    await writeConfigObject(config)
    await appendLog('info', 'app', `已删除 ${aiProviderKindLabel(input.kind)} 配置。`)
    return buildAppState()
  })

  ipcMain.handle('cliproxy:openPath', async (_event, targetPath: string) => {
    const errorMessage = await shell.openPath(targetPath)

    if (errorMessage) {
      throw new Error(errorMessage)
    }
  })

  ipcMain.handle('cliproxy:openExternal', async (_event, targetUrl: string) => {
    await shell.openExternal(targetUrl)
  })

  ipcMain.handle('cliproxy:clearLogs', async () => {
    const { logsDir } = resolvePaths()
    const entries = await fs.readdir(logsDir, { withFileTypes: true })

    for (const entry of entries) {
      const targetPath = resolveInsideDirectory(logsDir, entry.name)

      if (entry.isDirectory()) {
        await fs.rm(targetPath, { recursive: true, force: true })
      } else {
        await fs.writeFile(targetPath, '', 'utf8')
      }
    }

    logBuffer.splice(0, logBuffer.length)
    await appendLog('info', 'app', '日志已清空。')
    return buildAppState()
  })
}

async function bootstrap(): Promise<void> {
  await ensureAppFiles()
  registerIpcHandlers()
  startWatchers()
  mainWindow = createWindow()
  void refreshProxyBinaryState()
    .catch(async (error) => {
      proxyBinaryState.lastError = toErrorMessage(error)
      await appendLog('warn', 'app', `CLIProxyAPI 更新检查失败：${proxyBinaryState.lastError}`)
    })
    .finally(() => {
      scheduleStateChanged()
    })
}

void buildProviderImportSummaries
void fetchUsageSummary
void bootstrap

void app.whenReady().then(async () => {
  await bootstrapV2()

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindow()
      return
    }

    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      return
    }

    showMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  appQuitRequested = true
  void configWatcher?.close()
  void authWatcher?.close()
  void usageLogWatcher?.close()
  if (usageLogIngestTimer) {
    clearTimeout(usageLogIngestTimer)
    usageLogIngestTimer = null
  }
  tray?.destroy()
  tray = null

  if (proxyChild && proxyStatus.running) {
    proxyStopRequested = true
    proxyChild.kill()
  }
})
