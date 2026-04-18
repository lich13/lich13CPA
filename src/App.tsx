import {
  Bot,
  CircleAlert,
  Download,
  ExternalLink,
  FolderOpen,
  HardDriveUpload,
  LayoutDashboard,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  Save,
  ScrollText,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react'
import { startTransition, useDeferredValue, useEffect, useEffectEvent, useRef, useState } from 'react'

import type {
  AmpcodeConfigRecord,
  AmpcodeModelMappingRecord,
  AmpcodeUpstreamApiKeyMappingRecord,
  AppPage,
  AuthFileDetailItem,
  AuthFileQuotaItem,
  AuthFileQuotaSummary,
  AuthFileRecord,
  DesktopAppState,
  FetchProviderModelsInput,
  GeminiProviderRecord,
  OpenAICompatibleProviderRecord,
  ProviderApiKeyEntry,
  ProviderAuthProvider,
  ProviderHeaderEntry,
  ProviderKeyRecord,
  ProviderModelMapping,
  SaveAiProviderInput,
  SaveKnownSettingsInput,
  SidecarChannel,
} from '../shared/types'
import './App.css'

const APP_ICON_SRC = 'app-icon.png'

type Notice = { kind: 'success' | 'error'; text: string }
type QuotaState = { error: string | null; loading: boolean; summary: AuthFileQuotaSummary | null }
type KeyProviderKind = 'gemini' | 'codex' | 'claude' | 'vertex'
type ProviderEditorKind = KeyProviderKind | 'openai-compatibility' | 'ampcode'

type KeyProviderEditorState = {
  apiKey: string
  baseUrl: string
  excludedModelsText: string
  headersText: string
  index?: number
  kind: KeyProviderKind
  modelsText: string
  prefix: string
  priority: string
  proxyUrl: string
  websockets: boolean
}

type OpenAIProviderEditorState = {
  apiKeyEntriesText: string
  baseUrl: string
  headersText: string
  index?: number
  kind: 'openai-compatibility'
  modelsText: string
  name: string
  prefix: string
  priority: string
  testModel: string
}

type AmpcodeEditorState = {
  forceModelMappings: boolean
  kind: 'ampcode'
  modelMappingsText: string
  upstreamApiKey: string
  upstreamApiKeysText: string
  upstreamUrl: string
}

type ProviderEditorState =
  | KeyProviderEditorState
  | OpenAIProviderEditorState
  | AmpcodeEditorState

interface PageMeta {
  icon: typeof LayoutDashboard
  id: AppPage
  label: string
}

interface ProviderSectionMeta {
  kind: ProviderEditorKind
  title: string
}

interface SupplierMeta {
  id: ProviderAuthProvider
  label: string
  openMode: 'oauth' | 'manual'
  theme: 'sun' | 'orange' | 'gold' | 'red'
  summaryIds?: string[]
}

interface TextFieldProps {
  disabled?: boolean
  help: string
  label: string
  min?: number
  onChange: (value: string) => void
  placeholder?: string
  step?: number
  type?: 'datetime-local' | 'number' | 'password' | 'text'
  value: number | string
}

interface SelectFieldProps {
  help: string
  label: string
  onChange: (value: string) => void
  options: Array<{ label: string; value: string }>
  value: string
}

interface TextAreaFieldProps {
  help: string
  label: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  value: string
}

interface ToggleFieldProps {
  checked: boolean
  disabled?: boolean
  help: string
  label: string
  onChange: (checked: boolean) => void
}

const DEFAULT_PORT = 8313
const DEFAULT_REQUEST_RETRY = 5
const DEFAULT_MAX_RETRY_INTERVAL = 30
const DEFAULT_STREAM_KEEPALIVE_SECONDS = 20
const DEFAULT_STREAM_BOOTSTRAP_RETRIES = 2
const DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS = 15

function getSidecarDisplayName(channel: SidecarChannel): string {
  return channel === 'plus' ? 'CLIProxyAPIPlus' : 'CLIProxyAPI'
}

const EMPTY_SETTINGS: SaveKnownSettingsInput = {
  port: DEFAULT_PORT,
  useSystemProxy: false,
  proxyUrl: '',
  proxyUsername: '',
  proxyPassword: '',
  proxyApiKey: 'cliproxy-local',
  managementApiKey: 'cliproxy-management',
  requestRetry: DEFAULT_REQUEST_RETRY,
  maxRetryInterval: DEFAULT_MAX_RETRY_INTERVAL,
  streamKeepaliveSeconds: DEFAULT_STREAM_KEEPALIVE_SECONDS,
  streamBootstrapRetries: DEFAULT_STREAM_BOOTSTRAP_RETRIES,
  nonStreamKeepaliveIntervalSeconds: DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS,
  sidecarChannel: 'main',
  autoSyncOnStop: true,
  launchAtLogin: true,
  autoStartProxyOnLaunch: true,
  minimizeToTrayOnClose: true,
}

const PAGES: PageMeta[] = [
  { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { id: 'providers', label: 'AI 提供商', icon: Bot },
  { id: 'auth-files', label: '认证文件', icon: ShieldCheck },
  { id: 'logs', label: '日志', icon: ScrollText },
  { id: 'settings', label: '设置', icon: Settings2 },
]

const AI_PROVIDER_SECTIONS: ProviderSectionMeta[] = [
  { kind: 'codex', title: 'Codex API 配置' },
  { kind: 'openai-compatibility', title: 'OpenAI 兼容提供商' },
  { kind: 'claude', title: 'Claude API 配置' },
  { kind: 'gemini', title: 'Gemini API 配置' },
  { kind: 'vertex', title: 'Vertex API 配置' },
  { kind: 'ampcode', title: 'Ampcode' },
]

const SUPPLIERS: SupplierMeta[] = [
  {
    id: 'codex',
    label: 'Codex OAuth',
    openMode: 'oauth',
    theme: 'sun',
    summaryIds: ['codex', 'openai'],
  },
  {
    id: 'claude',
    label: 'Anthropic OAuth',
    openMode: 'oauth',
    theme: 'orange',
  },
  {
    id: 'antigravity',
    label: 'Antigravity OAuth',
    openMode: 'oauth',
    theme: 'red',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI OAuth',
    openMode: 'oauth',
    theme: 'gold',
  },
  {
    id: 'vertex',
    label: 'Vertex JSON 登录',
    openMode: 'manual',
    theme: 'gold',
  },
  {
    id: 'iflow',
    label: 'iFlow Cookie 登录',
    openMode: 'manual',
    theme: 'red',
  },
]

function TextField({
  disabled = false,
  help,
  label,
  min,
  onChange,
  placeholder,
  step,
  type = 'text',
  value,
}: TextFieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="field-input"
        disabled={disabled}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        step={step}
        type={type}
        value={value}
      />
      <span className="field-help">{help}</span>
    </label>
  )
}

function SelectField({ help, label, onChange, options, value }: SelectFieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select className="field-input" onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="field-help">{help}</span>
    </label>
  )
}

function TextAreaField({
  help,
  label,
  onChange,
  placeholder,
  rows = 4,
  value,
}: TextAreaFieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <textarea
        className="field-input field-textarea"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        value={value}
      />
      <span className="field-help">{help}</span>
    </label>
  )
}

function ToggleField({ checked, disabled, help, label, onChange }: ToggleFieldProps) {
  return (
    <label className="toggle-field">
      <span className="toggle-copy">
        <span className="field-label">{label}</span>
        <span className="field-help">{help}</span>
      </span>
      <button
        className={`toggle-button ${checked ? 'on' : ''}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span className="toggle-thumb" />
      </button>
    </label>
  )
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function formatTime(value: string | null | undefined): string {
  if (!value) {
    return '未记录'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--'
  }

  return `${Math.round(Math.max(0, Math.min(100, value)))}%`
}
function formatPlanLabel(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  switch (value.trim().toLowerCase()) {
    case 'pro':
      return 'Pro'
    case 'plus':
      return 'Plus'
    case 'team':
      return 'Team'
    case 'free':
      return 'Free'
    default:
      return value
  }
}

function getQuotaItemById(summary: AuthFileQuotaSummary, ...itemIds: string[]): AuthFileQuotaItem | null {
  for (const itemId of itemIds) {
    const matched = summary.items.find((item) => item.id === itemId)

    if (matched) {
      return matched
    }
  }

  return null
}

const DASHBOARD_CODEX_QUOTA_SLOTS = [
  { id: 'five-hour', label: '\u4e3b\u9650\u989d\uff085 \u5c0f\u65f6\uff09' },
  { id: 'weekly', label: '\u6bcf\u5468\u9650\u989d\uff087 \u5929\uff09' },
] as const

function createDashboardQuotaPlaceholder(id: string, label: string): AuthFileQuotaItem {
  return {
    id,
    label,
    remainingPercent: null,
    amountText: null,
    resetAt: null,
    resetText: null,
  }
}

function formatDashboardQuotaLabel(item: AuthFileQuotaItem): string {
  switch (item.id) {
    case 'five-hour':
      return '\u4e3b\u9650\u989d\uff085 \u5c0f\u65f6\uff09'
    case 'weekly':
      return '\u6bcf\u5468\u9650\u989d\uff087 \u5929\uff09'
    case 'code-review-five-hour':
      return 'Code Review\uff085 \u5c0f\u65f6\uff09'
    case 'code-review-weekly':
      return 'Code Review\uff087 \u5929\uff09'
    default:
      return item.label
  }
}

function getQuotaUsedPercent(item: AuthFileQuotaItem): number | null {
  if (item.remainingPercent === null || Number.isNaN(item.remainingPercent)) {
    return null
  }

  return Math.max(0, Math.min(100, 100 - item.remainingPercent))
}

function formatQuotaResetTime(value: number): string {
  const date = new Date(value)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  return `${month}/${day} ${hour}:${minute}`
}

function formatQuotaResetCountdown(resetAtMs: number, nowMs: number): string {
  const diffMs = resetAtMs - nowMs

  if (diffMs <= 0) {
    return '即将重置'
  }

  const totalMinutes = Math.max(1, Math.ceil(diffMs / 60000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []

  if (days > 0) {
    parts.push(`${days}天`)
  }
  if (hours > 0) {
    parts.push(`${hours}小时`)
  }
  if (minutes > 0 && parts.length < 2) {
    parts.push(`${minutes}分钟`)
  }
  if (parts.length === 0) {
    parts.push('不到1分钟')
  }

  return `还剩 ${parts.join('')}`
}

function formatQuotaResetDisplay(item: AuthFileQuotaItem, nowMs: number): string {
  if (item.resetAt) {
    const resetAtMs = new Date(item.resetAt).getTime()

    if (!Number.isNaN(resetAtMs)) {
      return `本地 ${formatQuotaResetTime(resetAtMs)} · ${formatQuotaResetCountdown(resetAtMs, nowMs)}`
    }
  }

  return item.resetText ?? '暂无重置时间'
}

function getDashboardQuotaItems(summary: AuthFileQuotaSummary): AuthFileQuotaItem[] {
  if (summary.provider.toLowerCase() === 'codex') {
    const codexItems = DASHBOARD_CODEX_QUOTA_SLOTS.map(({ id, label }) => {
      return getQuotaItemById(summary, id) ?? createDashboardQuotaPlaceholder(id, label)
    })

    if (summary.items.some((item) => item.id === 'five-hour' || item.id === 'weekly')) {
      return codexItems
    }
  }

  const itemsWithPercent = summary.items.filter((item) => item.remainingPercent !== null)
  const candidates = itemsWithPercent.length > 0 ? itemsWithPercent : summary.items
  return candidates.slice(0, 2)
}

function getAuthDetailItem(file: AuthFileRecord, ...labels: string[]): AuthFileDetailItem | null {
  for (const label of labels) {
    const matched = file.detailItems.find((item) => item.label === label && item.value.trim())

    if (matched) {
      return matched
    }
  }

  return null
}

function getCompactAuthDetails(file: AuthFileRecord): AuthFileDetailItem[] {
  const candidates = [
    getAuthDetailItem(file, '邮箱'),
    getAuthDetailItem(file, '账户'),
    getAuthDetailItem(file, 'ChatGPT 账户 ID'),
    getAuthDetailItem(file, '项目 ID'),
    getAuthDetailItem(file, '服务账号'),
    getAuthDetailItem(file, '组织'),
  ].filter((item): item is AuthFileDetailItem => Boolean(item))
  const deduped: AuthFileDetailItem[] = []
  const seen = new Set<string>()

  for (const item of candidates) {
    const key = `${item.label}:${item.value}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(item)
  }

  return deduped.slice(0, 3)
}

function getPrimaryQuotaItem(summary: AuthFileQuotaSummary): AuthFileQuotaItem | null {
  if (summary.items.length === 0) {
    return null
  }

  if (summary.provider.toLowerCase() === 'codex') {
    const preferred = getQuotaItemById(summary, 'five-hour', 'code-review-five-hour')

    if (preferred) {
      return preferred
    }
  }

  const itemsWithPercent = summary.items.filter((item) => item.remainingPercent !== null)

  if (itemsWithPercent.length === 0) {
    return summary.items[0]
  }

  return [...itemsWithPercent].sort((left, right) => {
    return (left.remainingPercent ?? 101) - (right.remainingPercent ?? 101)
  })[0]
}

function getDateRank(...values: Array<string | null | undefined>): number {
  for (const value of values) {
    if (!value) {
      continue
    }

    const parsed = new Date(value).getTime()

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}

function getFeaturedQuotaFiles(files: AuthFileRecord[]): AuthFileRecord[] {
  const supported = files.filter((file) => canFetchQuota(file) && !file.unavailable)
  const enabled = supported.filter((file) => file.enabled)
  const candidates = enabled.length > 0 ? enabled : supported

  return [...candidates]
    .sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1
      }
      const rightRank = getDateRank(right.updatedAt, right.modifiedAt, right.createdAt)
      const leftRank = getDateRank(left.updatedAt, left.modifiedAt, left.createdAt)

      if (leftRank !== rightRank) {
        return rightRank - leftRank
      }

      return left.displayName.localeCompare(right.displayName, 'zh-CN')
    })
    .slice(0, 4)
}

function getQuotaTargetsForPage(state: DesktopAppState, page: AppPage): string[] {
  if (!state.proxyStatus.running) {
    return []
  }

  const files =
    page === 'dashboard'
      ? getFeaturedQuotaFiles(state.authFiles)
      : page === 'auth-files'
        ? state.authFiles.filter((file) => canFetchQuota(file) && !file.unavailable)
        : []

  return [...new Set(files.map((file) => file.name).filter(Boolean))]
}

function getErrorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  return '操作失败'
}

function parseOptionalInteger(value: string): number | null {
  const normalized = value.trim()

  if (!normalized) {
    return null
  }

  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseModelsText(value: string): ProviderModelMapping[] {
  return parseLines(value).map((line) => {
    const separatorIndex = line.includes('=') ? line.indexOf('=') : line.indexOf(',')

    if (separatorIndex === -1) {
      return {
        alias: line,
        name: line,
      }
    }

    const alias = line.slice(0, separatorIndex).trim()
    const name = line.slice(separatorIndex + 1).trim()

    return {
      alias: alias || name,
      name,
    }
  })
}

function stringifyModels(models: ProviderModelMapping[]): string {
  return models
    .map((model) =>
      model.alias && model.alias !== model.name ? `${model.alias} = ${model.name}` : model.name,
    )
    .join('\n')
}

function parseHeadersText(value: string): ProviderHeaderEntry[] {
  return parseLines(value)
    .map((line) => {
      const separatorIndex = line.indexOf('=')

      if (separatorIndex === -1) {
        return null
      }

      return {
        key: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      }
    })
    .filter((entry): entry is ProviderHeaderEntry => entry !== null)
}

function stringifyHeaders(headers: ProviderHeaderEntry[]): string {
  return headers.map((entry) => `${entry.key} = ${entry.value}`).join('\n')
}

function parseApiKeyEntriesText(value: string): ProviderApiKeyEntry[] {
  return parseLines(value)
    .map((line) => {
      const segments = line.split('|').map((segment) => segment.trim())
      const [apiKey = '', proxyUrl = '', headersPart = ''] = segments

      if (!apiKey) {
        return null
      }

      return {
        apiKey,
        proxyUrl,
        headers: headersPart
          .split(';')
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => {
            const separatorIndex = item.indexOf('=')
            return separatorIndex === -1
              ? null
              : {
                  key: item.slice(0, separatorIndex).trim(),
                  value: item.slice(separatorIndex + 1).trim(),
                }
          })
          .filter((entry): entry is ProviderHeaderEntry => entry !== null),
      }
    })
    .filter((entry): entry is ProviderApiKeyEntry => entry !== null)
}

function stringifyApiKeyEntries(entries: ProviderApiKeyEntry[]): string {
  return entries
    .map((entry) => {
      const headersText = entry.headers.map((header) => `${header.key}=${header.value}`).join('; ')
      return [entry.apiKey, entry.proxyUrl, headersText].filter(Boolean).join(' | ')
    })
    .join('\n')
}

function parseAmpcodeUpstreamApiKeysText(value: string): AmpcodeUpstreamApiKeyMappingRecord[] {
  return parseLines(value)
    .map((line) => {
      const separator = line.includes('=>') ? '=>' : ':'
      const separatorIndex = line.indexOf(separator)

      if (separatorIndex === -1) {
        return null
      }

      return {
        upstreamApiKey: line.slice(0, separatorIndex).trim(),
        apiKeys: line
          .slice(separatorIndex + separator.length)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      }
    })
    .filter(
      (entry): entry is AmpcodeUpstreamApiKeyMappingRecord =>
        entry !== null && entry.upstreamApiKey.length > 0 && entry.apiKeys.length > 0,
    )
}

function stringifyAmpcodeUpstreamApiKeys(
  entries: AmpcodeUpstreamApiKeyMappingRecord[],
): string {
  return entries
    .map((entry) => `${entry.upstreamApiKey} => ${entry.apiKeys.join(', ')}`)
    .join('\n')
}

function parseAmpcodeModelMappingsText(value: string): AmpcodeModelMappingRecord[] {
  return parseLines(value)
    .map((line) => {
      const separator = line.includes('=>') ? '=>' : '='
      const separatorIndex = line.indexOf(separator)

      if (separatorIndex === -1) {
        return null
      }

      return {
        from: line.slice(0, separatorIndex).trim(),
        to: line.slice(separatorIndex + separator.length).trim(),
      }
    })
    .filter(
      (entry): entry is AmpcodeModelMappingRecord =>
        entry !== null && entry.from.length > 0 && entry.to.length > 0,
    )
}

function stringifyAmpcodeModelMappings(entries: AmpcodeModelMappingRecord[]): string {
  return entries.map((entry) => `${entry.from} => ${entry.to}`).join('\n')
}

function buildEmptyProviderEditor(kind: ProviderEditorKind): ProviderEditorState {
  if (kind === 'openai-compatibility') {
    return {
      kind,
      name: '',
      baseUrl: '',
      prefix: '',
      priority: '',
      testModel: '',
      headersText: '',
      modelsText: '',
      apiKeyEntriesText: '',
    }
  }

  if (kind === 'ampcode') {
    return {
      kind,
      upstreamUrl: '',
      upstreamApiKey: '',
      upstreamApiKeysText: '',
      modelMappingsText: '',
      forceModelMappings: false,
    }
  }

  return {
    kind,
    apiKey: '',
    baseUrl: '',
    proxyUrl: '',
    prefix: '',
    priority: '',
    headersText: '',
    modelsText: '',
    excludedModelsText: '',
    websockets: false,
  }
}

function buildKeyProviderEditor(
  kind: KeyProviderKind,
  record: GeminiProviderRecord | ProviderKeyRecord,
): KeyProviderEditorState {
  return {
    kind,
    index: record.index,
    apiKey: record.apiKey,
    baseUrl: record.baseUrl,
    proxyUrl: record.proxyUrl,
    prefix: record.prefix,
    priority: record.priority === null ? '' : `${record.priority}`,
    headersText: stringifyHeaders(record.headers),
    modelsText: stringifyModels(record.models),
    excludedModelsText: record.excludedModels.join('\n'),
    websockets: 'websockets' in record ? Boolean(record.websockets) : false,
  }
}

function buildOpenAIProviderEditor(
  record: OpenAICompatibleProviderRecord,
): OpenAIProviderEditorState {
  return {
    kind: 'openai-compatibility',
    index: record.index,
    name: record.name,
    baseUrl: record.baseUrl,
    prefix: record.prefix,
    priority: record.priority === null ? '' : `${record.priority}`,
    testModel: record.testModel,
    headersText: stringifyHeaders(record.headers),
    modelsText: stringifyModels(record.models),
    apiKeyEntriesText: stringifyApiKeyEntries(record.apiKeyEntries),
  }
}

function buildAmpcodeEditor(record: AmpcodeConfigRecord): AmpcodeEditorState {
  return {
    kind: 'ampcode',
    upstreamUrl: record.upstreamUrl,
    upstreamApiKey: record.upstreamApiKey,
    upstreamApiKeysText: stringifyAmpcodeUpstreamApiKeys(record.upstreamApiKeys),
    modelMappingsText: stringifyAmpcodeModelMappings(record.modelMappings),
    forceModelMappings: record.forceModelMappings,
  }
}

function canFetchQuota(file: AuthFileRecord): boolean {
  const provider = file.provider.toLowerCase()
  const type = file.type.toLowerCase()

  return (
    provider === 'codex' ||
    provider === 'openai' ||
    provider === 'claude' ||
    provider === 'gemini' ||
    provider === 'antigravity' ||
    type === 'codex' ||
    type === 'gemini-cli' ||
    type === 'antigravity'
  )
}

function getSettingsFromState(state: DesktopAppState): SaveKnownSettingsInput {
  return {
    port: state.knownSettings.port,
    useSystemProxy: state.knownSettings.useSystemProxy,
    proxyUrl: state.knownSettings.proxyUrl,
    proxyUsername: state.knownSettings.proxyUsername,
    proxyPassword: state.knownSettings.proxyPassword,
    proxyApiKey: state.knownSettings.proxyApiKey,
    managementApiKey: state.knownSettings.managementApiKey,
    requestRetry: state.knownSettings.requestRetry,
    maxRetryInterval: state.knownSettings.maxRetryInterval,
    streamKeepaliveSeconds: state.knownSettings.streamKeepaliveSeconds,
    streamBootstrapRetries: state.knownSettings.streamBootstrapRetries,
    nonStreamKeepaliveIntervalSeconds: state.knownSettings.nonStreamKeepaliveIntervalSeconds,
    sidecarChannel: state.knownSettings.sidecarChannel,
    autoSyncOnStop: state.knownSettings.autoSyncOnStop,
    launchAtLogin: state.knownSettings.launchAtLogin,
    autoStartProxyOnLaunch: state.knownSettings.autoStartProxyOnLaunch,
    minimizeToTrayOnClose: state.knownSettings.minimizeToTrayOnClose,
  }
}

function App() {
  const [appState, setAppState] = useState<DesktopAppState | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState<AppPage>('dashboard')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [providerEditor, setProviderEditor] = useState<ProviderEditorState | null>(null)
  const [quotaStateByFile, setQuotaStateByFile] = useState<Record<string, QuotaState>>({})
  const [quotaClockMs, setQuotaClockMs] = useState(() => Date.now())
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<SaveKnownSettingsInput>(EMPTY_SETTINGS)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [selectedFetchedModels, setSelectedFetchedModels] = useState<Record<string, string>>({})
  const mountedRef = useRef(true)
  const appStateRef = useRef<DesktopAppState | null>(null)
  const quotaRequestedRef = useRef(new Set<string>())
  const authPollTimerRef = useRef<Record<string, number>>({})
  const deferredLogs = useDeferredValue(appState?.logs ?? [])
  const refreshQuotaClock = useEffectEvent(() => {
    setQuotaClockMs(Date.now())
  })

  useEffect(() => {
    refreshQuotaClock()
    const timerId = window.setInterval(() => {
      refreshQuotaClock()
    }, 30000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [refreshQuotaClock])

  function applyAppState(nextState: DesktopAppState) {
    startTransition(() => {
      setAppState(nextState)
    })
  }

  function pushNotice(kind: Notice['kind'], text: string) {
    setNotice({ kind, text })
  }

async function loadState() {
    try {
      const nextState = await window.cliproxy.getAppState()

      if (!mountedRef.current) {
        return null
      }

      applyAppState(nextState)
      return nextState
    } catch (error) {
      if (mountedRef.current) {
        pushNotice('error', getErrorText(error))
      }
      return null
    }
  }

  function getSupplierSummary(meta: SupplierMeta, state: DesktopAppState) {
    return meta.summaryIds
      ? meta.summaryIds.reduce(
          (accumulator, id) => {
            const item = state.providerImports.find((entry) => entry.id === id)
            return {
              enabledCount: accumulator.enabledCount + (item?.enabledCount ?? 0),
              disabledCount: accumulator.disabledCount + (item?.disabledCount ?? 0),
              totalCount: accumulator.totalCount + (item?.totalCount ?? 0),
            }
          },
          { enabledCount: 0, disabledCount: 0, totalCount: 0 },
        )
      : state.providerImports.find((entry) => entry.id === meta.id) ?? {
          enabledCount: 0,
          disabledCount: 0,
          totalCount: 0,
        }
  }

  async function runStateAction(
    actionId: string,
    task: () => Promise<DesktopAppState>,
    successText?: string,
  ): Promise<DesktopAppState> {
    setBusyAction(actionId)

    try {
      const nextState = await task()

      if (mountedRef.current) {
        applyAppState(nextState)

        if (successText) {
          pushNotice('success', successText)
        }
      }

      return nextState
    } catch (error) {
      if (mountedRef.current) {
        pushNotice('error', getErrorText(error))
      }

      throw error
    } finally {
      if (mountedRef.current) {
        setBusyAction((current) => (current === actionId ? null : current))
      }
    }
  }

  async function runAction<T>(
    actionId: string,
    task: () => Promise<T>,
    successText?: string,
  ): Promise<T> {
    setBusyAction(actionId)

    try {
      const result = await task()

      if (mountedRef.current && successText) {
        pushNotice('success', successText)
      }

      return result
    } catch (error) {
      if (mountedRef.current) {
        pushNotice('error', getErrorText(error))
      }

      throw error
    } finally {
      if (mountedRef.current) {
        setBusyAction((current) => (current === actionId ? null : current))
      }
    }
  }

  function clearAuthPoll(providerId: string) {
    const timer = authPollTimerRef.current[providerId]

    if (timer) {
      window.clearTimeout(timer)
      delete authPollTimerRef.current[providerId]
    }
  }

  async function pollProviderAuth(
    provider: ProviderAuthProvider,
    stateToken: string,
    baselineCount = 0,
    attempt = 0,
  ) {
    try {
      const result = await window.cliproxy.checkProviderAuthStatus(provider, stateToken)

      if (!mountedRef.current) {
        return
      }

      if (result.status === 'ok') {
        clearAuthPoll(provider)
        const supplier = SUPPLIERS.find((item) => item.id === provider) ?? null
        let latestState: DesktopAppState | null = null

        for (let retry = 0; retry < 10; retry += 1) {
          if (retry > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 500))
          }

          latestState = await loadState()

          if (!latestState || !supplier) {
            continue
          }

          if (
            (result.importedFiles?.length ?? 0) > 0 ||
            getSupplierSummary(supplier, latestState).totalCount > baselineCount
          ) {
            break
          }
        }

        if ((result.importedCount ?? 0) > 0) {
          pushNotice('success', `${result.label} 已完成授权，已导入 ${result.importedCount} 个认证文件`)
        } else {
          pushNotice('success', `${result.label} 已完成授权`)
        }
        return
      }

      if (result.status === 'error') {
        clearAuthPoll(provider)
        pushNotice('error', result.error || `${result.label} 授权失败`)
        return
      }

      if (attempt >= 60) {
        clearAuthPoll(provider)
        return
      }

      authPollTimerRef.current[provider] = window.setTimeout(() => {
        void pollProviderAuth(provider, stateToken, baselineCount, attempt + 1)
      }, 1500)
    } catch (error) {
      if (!mountedRef.current) {
        return
      }

      if (attempt >= 8) {
        clearAuthPoll(provider)
        pushNotice('error', getErrorText(error))
        return
      }

      authPollTimerRef.current[provider] = window.setTimeout(() => {
        void pollProviderAuth(provider, stateToken, baselineCount, attempt + 1)
      }, 2000)
    }
  }

  async function ensureProxyRunning(): Promise<DesktopAppState> {
    if (appState?.proxyStatus.running) {
      return appState
    }

    return runStateAction('start-proxy', () => window.cliproxy.startProxy())
  }

  async function openWebUi(targetPath = '') {
    return runAction(
      'open-webui',
      async () => {
        const readyState = await ensureProxyRunning()
        const targetUrl = targetPath
          ? `${readyState.proxyStatus.webUiUrl}${targetPath}`
          : readyState.proxyStatus.webUiUrl
        await window.cliproxy.openExternal(targetUrl)
        return readyState
      },
      '已打开 WebUI',
    )
  }

  async function launchSupplierAuth(meta: SupplierMeta) {
    const actionId = `auth-${meta.id}`

    if (meta.openMode === 'manual') {
      await openWebUi('#/oauth')
      return
    }

    try {
      const launch = await runAction(
        actionId,
        async () => {
          const authLaunch = await window.cliproxy.getProviderAuthUrl(meta.id)
          await window.cliproxy.openExternal(authLaunch.authUrl)
          return authLaunch
        },
        `已打开 ${meta.label} 授权页`,
      )

      clearAuthPoll(meta.id)
      const baselineCount = appState ? getSupplierSummary(meta, appState).totalCount : 0
      void pollProviderAuth(meta.id, launch.state, baselineCount)
    } catch {
      await openWebUi('#/oauth')
    }
  }

  async function fetchQuota(fileName: string, announce = false): Promise<boolean> {
    setQuotaStateByFile((current) => ({
      ...current,
      [fileName]: {
        error: null,
        loading: true,
        summary: current[fileName]?.summary ?? null,
      },
    }))

    try {
      const summary = await window.cliproxy.getAuthFileQuota(fileName)

      if (!mountedRef.current) {
        return false
      }

      setQuotaStateByFile((current) => ({
        ...current,
        [fileName]: {
          error: null,
          loading: false,
          summary,
        },
      }))

      if (announce) {
        pushNotice('success', '额度信息已刷新')
      }

      return true
    } catch (error) {
      if (!mountedRef.current) {
        return false
      }

      quotaRequestedRef.current.delete(fileName)
      setQuotaStateByFile((current) => ({
        ...current,
        [fileName]: {
          error: getErrorText(error),
          loading: false,
          summary: current[fileName]?.summary ?? null,
        },
      }))

      if (announce) {
        pushNotice('error', getErrorText(error))
      }

      return false
    }
  }

  async function refreshQuotaFiles(fileNames: string[]) {
    const targets = [...new Set(fileNames.filter(Boolean))]

    if (targets.length === 0) {
      return
    }

    await runAction(
      'refresh-quotas',
      async () => {
        const results = await Promise.all(targets.map((fileName) => fetchQuota(fileName, false)))

        if (results.some((result) => !result)) {
          throw new Error('部分额度刷新失败，请到认证文件页查看详细错误。')
        }
      },
      '额度信息已刷新',
    )
  }

  async function refreshCurrentPage() {
    setBusyAction('refresh-view')

    try {
      const nextState = await window.cliproxy.getAppState()

      if (!mountedRef.current) {
        return
      }

      applyAppState(nextState)

      const quotaTargets = getQuotaTargetsForPage(nextState, currentPage)
      let quotaFailed = false

      if (quotaTargets.length > 0) {
        quotaTargets.forEach((fileName) => {
          quotaRequestedRef.current.add(fileName)
        })
        const results = await Promise.all(quotaTargets.map((fileName) => fetchQuota(fileName, false)))
        quotaFailed = results.some((result) => !result)
      }

      if (!mountedRef.current) {
        return
      }

      if (quotaFailed) {
        pushNotice(
          'error',
          currentPage === 'dashboard'
            ? '仪表盘已刷新，但部分认证额度刷新失败。'
            : '当前页面已刷新，但部分认证额度刷新失败。',
        )
        return
      }

      if (currentPage === 'dashboard') {
        pushNotice(
          'success',
          quotaTargets.length > 0 ? '已刷新仪表盘和认证额度' : '已刷新仪表盘',
        )
        return
      }

      if (currentPage === 'auth-files') {
        pushNotice(
          'success',
          quotaTargets.length > 0 ? '已刷新认证额度' : '已刷新认证文件列表',
        )
        return
      }

      pushNotice('success', '已刷新当前页面数据')
    } catch (error) {
      if (mountedRef.current) {
        pushNotice('error', getErrorText(error))
      }
    } finally {
      if (mountedRef.current) {
        setBusyAction((current) => (current === 'refresh-view' ? null : current))
      }
    }
  }

  async function saveSettings() {
    const nextState = await runStateAction(
      'save-settings',
      () => window.cliproxy.saveKnownSettings(settingsDraft),
      '设置已保存',
    )
    setSettingsDraft(getSettingsFromState(nextState))
    setSettingsDirty(false)
  }

  async function saveProviderEditor() {
    if (!providerEditor) {
      return
    }

    let payload: SaveAiProviderInput

    if (providerEditor.kind === 'openai-compatibility') {
      payload = {
        kind: 'openai-compatibility',
        index: providerEditor.index,
        name: providerEditor.name,
        baseUrl: providerEditor.baseUrl,
        prefix: providerEditor.prefix,
        priority: parseOptionalInteger(providerEditor.priority),
        testModel: providerEditor.testModel,
        headers: parseHeadersText(providerEditor.headersText),
        models: parseModelsText(providerEditor.modelsText),
        apiKeyEntries: parseApiKeyEntriesText(providerEditor.apiKeyEntriesText),
      }
    } else if (providerEditor.kind === 'ampcode') {
      payload = {
        kind: 'ampcode',
        config: {
          upstreamUrl: providerEditor.upstreamUrl,
          upstreamApiKey: providerEditor.upstreamApiKey,
          upstreamApiKeys: parseAmpcodeUpstreamApiKeysText(providerEditor.upstreamApiKeysText),
          modelMappings: parseAmpcodeModelMappingsText(providerEditor.modelMappingsText),
          forceModelMappings: providerEditor.forceModelMappings,
        },
      }
    } else {
      payload = {
        kind: providerEditor.kind,
        index: providerEditor.index,
        apiKey: providerEditor.apiKey,
        baseUrl: providerEditor.baseUrl,
        proxyUrl: providerEditor.proxyUrl,
        prefix: providerEditor.prefix,
        priority: parseOptionalInteger(providerEditor.priority),
        headers: parseHeadersText(providerEditor.headersText),
        models: parseModelsText(providerEditor.modelsText),
        excludedModels: parseLines(providerEditor.excludedModelsText),
        ...(providerEditor.kind === 'gemini'
          ? {}
          : { websockets: providerEditor.websockets }),
      }
    }

    await runStateAction(
      'save-provider-editor',
      () => window.cliproxy.saveAiProvider(payload),
      'AI 提供商已保存',
    )
    setProviderEditor(null)
  }

  async function fetchModelsForProviderEditor() {
    if (!providerEditor || providerEditor.kind === 'ampcode') {
      return
    }

    const input: FetchProviderModelsInput =
      providerEditor.kind === 'openai-compatibility'
        ? {
            baseUrl: providerEditor.baseUrl,
            headers: parseHeadersText(providerEditor.headersText),
            apiKey:
              parseApiKeyEntriesText(providerEditor.apiKeyEntriesText).find((entry) => entry.apiKey.trim())?.apiKey ??
              '',
          }
        : {
            baseUrl: providerEditor.baseUrl,
            apiKey: providerEditor.apiKey,
            headers: parseHeadersText(providerEditor.headersText),
          }

    const models = await runAction(
      `fetch-provider-models-${providerEditor.kind}`,
      () => window.cliproxy.fetchProviderModels(input),
      '已拉取模型列表',
    )
    setFetchedModels(models)
    setSelectedFetchedModels({})
  }

  function updateProviderEditorModels(
    updater: (models: ProviderModelMapping[]) => ProviderModelMapping[],
  ) {
    setProviderEditor((current) => {
      if (!current || current.kind === 'ampcode') {
        return current
      }

      return {
        ...current,
        modelsText: stringifyModels(updater(parseModelsText(current.modelsText))),
      }
    })
  }

  function appendSelectedFetchedModels() {
    const picked = Object.entries(selectedFetchedModels)
      .filter(([, checked]) => checked === '1')
      .map(([name]) => name)

    if (picked.length === 0) {
      pushNotice('error', '请先勾选至少一个模型。')
      return
    }

    updateProviderEditorModels((models) => {
      const existingByName = new Map(models.map((model) => [model.name, model]))

      picked.forEach((name) => {
        if (!existingByName.has(name)) {
          existingByName.set(name, { name, alias: name })
        }
      })

      return Array.from(existingByName.values())
    })
    pushNotice('success', `已添加 ${picked.length} 个模型。`)
  }

  useEffect(() => {
    appStateRef.current = appState
  }, [appState])

  useEffect(() => {
    mountedRef.current = true
    void loadState()

    const disposeStateListener = window.cliproxy.onStateChanged(() => {
      void loadState()
    })
    const disposeOAuthListener = window.cliproxy.onOAuthCallback((payload) => {
      const supplier = SUPPLIERS.find((item) => item.id === payload.provider) ?? null
      const latestState = appStateRef.current
      const baselineCount = latestState && supplier ? getSupplierSummary(supplier, latestState).totalCount : 0

      clearAuthPoll(payload.provider)
      pushNotice('success', `已收到 ${supplier?.label ?? payload.provider} 授权回调，正在同步认证文件`)
      void pollProviderAuth(payload.provider, payload.state, baselineCount)
    })
    const disposeLogsListener = window.cliproxy.onLogsUpdated((entries) => {
      startTransition(() => {
        setAppState((current) => (current ? { ...current, logs: entries } : current))
      })
    })

    return () => {
      mountedRef.current = false
      disposeStateListener()
      disposeOAuthListener()
      disposeLogsListener()
      Object.keys(authPollTimerRef.current).forEach((providerId) => {
        clearAuthPoll(providerId)
      })
    }
  }, [])

  useEffect(() => {
    setFetchedModels([])
    setSelectedFetchedModels({})
  }, [providerEditor])

  useEffect(() => {
    if (!notice) {
      return
    }

    const timer = window.setTimeout(() => {
      setNotice(null)
    }, 3500)

    return () => {
      window.clearTimeout(timer)
    }
  }, [notice])

  useEffect(() => {
    if (!appState || settingsDirty) {
      return
    }

    setSettingsDraft(getSettingsFromState(appState))
  }, [appState, settingsDirty])

  useEffect(() => {
    if (!appState) {
      return
    }

    const quotaTargets = getQuotaTargetsForPage(appState, currentPage)

    quotaTargets.forEach((fileName) => {
      if (quotaRequestedRef.current.has(fileName)) {
        return
      }

      quotaRequestedRef.current.add(fileName)
      void fetchQuota(fileName)
    })
  }, [appState, currentPage])

  if (!appState) {
    return (
      <div className="loading-shell">
        <div className="loading-card">
          <img alt="lich13CPA" className="loading-icon" src={APP_ICON_SRC} />
          <strong>lich13CPA</strong>
          <span>正在读取本地配置与 CLIProxyAPI 状态</span>
        </div>
      </div>
    )
  }

  const state = appState
  const currentPageMeta =
    PAGES.find((page) => page.id === currentPage) ?? PAGES[0]

  function renderWarnings() {
    if (state.warnings.length === 0 && !state.configParseError) {
      return null
    }

    return (
      <section className="banner-stack">
        {state.configParseError ? (
          <div className="warning-banner">
            <CircleAlert size={18} />
            <span>{state.configParseError}</span>
          </div>
        ) : null}
        {state.warnings.map((warning) => (
          <div className="warning-banner" key={warning}>
            <CircleAlert size={18} />
            <span>{warning}</span>
          </div>
        ))}
      </section>
    )
  }

  function renderDashboard() {
    const featuredQuotaFiles = getFeaturedQuotaFiles(state.authFiles)
    const importSummaries = state.providerImports
      .filter((entry) => entry.totalCount > 0)
      .slice(0, 6)

    return (
      <div className="page-stack">
        <section className="dashboard-fixed-layout">
          <div className="dashboard-left-column">
            <article className="metric-card dashboard-control-card">
              <span className="metric-label">代理状态</span>
              <strong>{state.proxyStatus.running ? '运行中' : '未启动'}</strong>
              <span className="metric-help">
                端口 {state.proxyStatus.port} · PID {state.proxyStatus.pid ?? '未启动'}
              </span>
              <div className="action-row dashboard-action-grid dashboard-action-grid-compact">
                <button
                  className="primary-button"
                  disabled={busyAction === 'start-proxy' || busyAction === 'stop-proxy'}
                  onClick={() => {
                    void (state.proxyStatus.running
                      ? runStateAction('stop-proxy', () => window.cliproxy.stopProxy(), '代理已停止')
                      : runStateAction('start-proxy', () => window.cliproxy.startProxy(), '代理已启动'))
                  }}
                  type="button"
                >
                  {state.proxyStatus.running ? <Square size={16} /> : <Play size={16} />}
                  {state.proxyStatus.running ? '停止代理' : '启动代理'}
                </button>
                <button className="ghost-button" onClick={() => void openWebUi()} type="button">
                  <ExternalLink size={16} />
                  打开 WebUI
                </button>
                <button
                  className="ghost-button"
                  disabled={!state.proxyStatus.running || busyAction === 'sync-runtime-config'}
                  onClick={() =>
                    void runStateAction(
                      'sync-runtime-config',
                      () => window.cliproxy.syncRuntimeConfig(),
                      '已固化 WebUI 配置到 proxy-config.yaml',
                    )
                  }
                  type="button"
                >
                  <Save size={16} />
                  固化 WebUI
                </button>
                <button
                  className="ghost-button danger"
                  disabled={busyAction === 'stop-quit'}
                  onClick={() =>
                    void runAction(
                      'stop-quit',
                      () => window.cliproxy.stopProxyAndQuit(),
                      '正在退出程序',
                    )
                  }
                  type="button"
                >
                  <Square size={16} />
                  停止代理并退出
                </button>
              </div>
            </article>

            <article className="metric-card dashboard-control-card">
              <span className="metric-label">二进制版本</span>
              <strong>{state.proxyBinary.currentVersion ?? '未识别'}</strong>
              <div className="metric-copy-stack">
                <span className="metric-help">
                  最新 {state.proxyBinary.latestVersion ?? '未检查'} · 路径{' '}
                  {state.proxyBinary.path ? '已就绪' : '未找到'}
                </span>
                <div className="metric-pairs metric-pairs-compact">
                  <span>当前 {state.proxyBinary.currentChannel ?? '未识别'}</span>
                  <span>目标 {state.proxyBinary.selectedChannel}</span>
                </div>
              </div>
              <div className="action-row metric-action-grid">
                <button
                  className="ghost-button"
                  onClick={() =>
                    void runStateAction(
                      'check-binary',
                      () => window.cliproxy.checkProxyBinaryUpdate(),
                      '已检查更新',
                    )
                  }
                  type="button"
                >
                  <RefreshCcw size={16} />
                  检查更新
                </button>
                <button
                  className="primary-button"
                  disabled={!state.proxyBinary.updateAvailable}
                  onClick={() =>
                    void runStateAction(
                      'update-binary',
                      () => window.cliproxy.updateProxyBinary(),
                      `${getSidecarDisplayName(state.knownSettings.sidecarChannel)} 已更新`,
                    )
                  }
                  type="button"
                >
                  <HardDriveUpload size={16} />
                  执行更新
                </button>
              </div>
            </article>

            <article className="metric-card dashboard-control-card">
              <span className="metric-label">软件更新</span>
              <strong>v{state.appUpdate.currentVersion}</strong>
              <div className="metric-copy-stack">
                <span className="metric-help">
                  最新 {state.appUpdate.latestVersion ? `v${state.appUpdate.latestVersion}` : '未检查'} · 资产{' '}
                  {state.appUpdate.latestAssetName ?? '未解析'}
                </span>
                <div className="metric-pairs metric-pairs-compact">
                  <span>上次检查 {formatTime(state.appUpdate.lastCheckedAt)}</span>
                  <span>上次下载 {formatTime(state.appUpdate.lastDownloadedAt)}</span>
                </div>
              </div>
              <div className="action-row metric-action-grid">
                <button
                  className="ghost-button"
                  onClick={() =>
                    void runStateAction(
                      'check-app-update',
                      () => window.cliproxy.checkAppUpdate(),
                      '已检查桌面应用更新',
                    )
                  }
                  type="button"
                >
                  <RefreshCcw size={16} />
                  检查更新
                </button>
                <button
                  className="primary-button"
                  disabled={!state.appUpdate.updateAvailable}
                  onClick={() =>
                    void runStateAction(
                      'update-app',
                      () => window.cliproxy.updateApp(),
                      '已开始软件更新',
                    )
                  }
                  type="button"
                >
                  <Download size={16} />
                  执行更新
                </button>
              </div>
              {state.appUpdate.lastError ? (
                <span className="field-help">更新异常：{state.appUpdate.lastError}</span>
              ) : null}
            </article>
          </div>

          <div className="dashboard-right-column">
            <section className="section-card dashboard-section dashboard-right-section">
            <div className="section-head">
              <div>
                <h2>认证额度</h2>
              </div>
              <div className="action-row">
                <button
                  className="ghost-button"
                  disabled={
                    !state.proxyStatus.running ||
                    featuredQuotaFiles.length === 0 ||
                    busyAction === 'refresh-quotas'
                  }
                  onClick={() => void refreshQuotaFiles(featuredQuotaFiles.map((file) => file.name))}
                  type="button"
                >
                  <RefreshCcw size={16} />
                  刷新额度
                </button>
                <button
                  className="ghost-button"
                  onClick={() => setCurrentPage('auth-files')}
                  type="button"
                >
                  <ShieldCheck size={16} />
                  查看全部
                </button>
              </div>
            </div>

            {!state.proxyStatus.running ? (
              <div className="quota-empty">启动代理后自动读取认证额度。</div>
            ) : featuredQuotaFiles.length === 0 ? (
              <div className="quota-empty">当前没有可读取额度的认证文件。</div>
            ) : (
              <div className="quota-spotlight-grid">
                {featuredQuotaFiles.map((file) => {
                  const quotaState = quotaStateByFile[file.name]
                  const summary = quotaState?.summary ?? null
                  const primaryItem = summary ? getPrimaryQuotaItem(summary) : null
                  const dashboardQuotaItems = summary ? getDashboardQuotaItems(summary) : []
                  const noteItem =
                    summary?.metas.find((item) => item.label === '说明' && item.value.trim()) ?? null
                  const planLabel = formatPlanLabel(summary?.planType ?? file.planType)

                  return (
                    <article className="quota-spotlight-card" key={file.name}>
                      <div className="quota-spotlight-top">
                        <div className="tag-row">
                          <span className="tag-pill quota-provider-pill">
                            {summary?.providerLabel ?? file.provider}
                          </span>
                          {planLabel ? <span className="tag-pill">{planLabel}</span> : null}
                        </div>
                        <span className="quota-refresh-time">
                          {summary ? formatTime(summary.fetchedAt) : '待读取'}
                        </span>
                      </div>
                      <strong className="quota-spotlight-file">{file.displayName}</strong>

                      {quotaState?.loading && !summary ? (
                        <div className="quota-empty">正在读取额度...</div>
                      ) : quotaState?.error && !summary ? (
                        <div className="quota-empty error">{quotaState.error}</div>
                      ) : summary && primaryItem ? (
                        <>
                          <div className="quota-progress-list">
                            {dashboardQuotaItems.map((item) => {
                              const usedPercent = getQuotaUsedPercent(item)

                              return (
                                <article className="quota-progress-row" key={item.id}>
                                  <div className="quota-progress-head">
                                    <span>{formatDashboardQuotaLabel(item)}</span>
                                    <strong>
                                      {usedPercent === null ? '待同步' : `已使用 ${formatPercent(usedPercent)}`}
                                    </strong>
                                  </div>
                                  <div className="quota-bar quota-spotlight-bar">
                                    <span
                                      className="quota-bar-fill"
                                      style={{ width: `${usedPercent ?? 0}%` }}
                                    />
                                  </div>
                                  <div className="quota-progress-meta">
                                    <span>{formatQuotaResetDisplay(item, quotaClockMs)}</span>
                                    {item.amountText && item.amountText !== item.resetText ? (
                                      <span>{item.amountText}</span>
                                    ) : null}
                                  </div>
                                </article>
                              )
                            })}
                          </div>
                          <div className="quota-spotlight-foot">
                            <span>
                              {summary.items.length > 1
                                ? `另 ${summary.items.length - 1} 项额度`
                                : file.enabled
                                  ? '已启用'
                                  : '未启用'}
                            </span>
                            <span>{quotaState?.error ? '刷新失败，显示上次结果' : '额度已同步'}</span>
                          </div>
                        </>
                      ) : summary && noteItem ? (
                        <div className="quota-empty error">{noteItem.value}</div>
                      ) : summary ? (
                        <div className="quota-empty">当前认证文件暂无可展示额度。</div>
                      ) : (
                        <div className="quota-empty">等待读取额度...</div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
            </section>

            <section className="section-card dashboard-section dashboard-right-section">
            <div className="section-head">
              <div>
                <h2>快捷授权</h2>
              </div>
            </div>

            {importSummaries.length > 0 ? (
              <div className="dashboard-import-summary-list">
                {importSummaries.map((item) => (
                  <article className="dashboard-import-summary-item" key={item.id}>
                    <strong>{item.label}</strong>
                    <span>
                      总 {formatCount(item.totalCount)} · 启用 {formatCount(item.enabledCount)} · 停用{' '}
                      {formatCount(item.disabledCount)}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="quota-empty">当前还没有已导入的提供商认证。</div>
            )}

            <div className="supplier-grid">
              {SUPPLIERS.map((supplier) => {
                const summary = supplier.summaryIds
                  ? supplier.summaryIds.reduce(
                      (accumulator, id) => {
                        const item = state.providerImports.find((entry) => entry.id === id)
                        return {
                          enabledCount: accumulator.enabledCount + (item?.enabledCount ?? 0),
                          disabledCount: accumulator.disabledCount + (item?.disabledCount ?? 0),
                          totalCount: accumulator.totalCount + (item?.totalCount ?? 0),
                        }
                      },
                      { enabledCount: 0, disabledCount: 0, totalCount: 0 },
                    )
                  : state.providerImports.find((entry) => entry.id === supplier.id) ?? {
                      enabledCount: 0,
                      disabledCount: 0,
                      totalCount: 0,
                    }

                return (
                  <article className={`supplier-card theme-${supplier.theme}`} key={supplier.id}>
                    <div className="supplier-head">
                      <div>
                        <strong>{supplier.label}</strong>
                      </div>
                      <div className="supplier-card-actions">
                        <button
                          className="ghost-button supplier-import-button"
                          disabled={busyAction === `pick-auth-${supplier.id}`}
                          onClick={() =>
                            void runStateAction(
                              `pick-auth-${supplier.id}`,
                              () => window.cliproxy.pickAuthFiles(supplier.id),
                              `已导入 ${supplier.label} 认证文件`,
                            )
                          }
                          type="button"
                        >
                          <HardDriveUpload size={16} />
                          导入
                        </button>
                        <button
                          className="icon-button"
                          disabled={busyAction === `auth-${supplier.id}`}
                          onClick={() => {
                            void launchSupplierAuth(supplier)
                          }}
                          type="button"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="supplier-stats">
                      <span>总数 {summary.totalCount}</span>
                      <span>启用 {summary.enabledCount}</span>
                      <span>停用 {summary.disabledCount}</span>
                    </div>
                  </article>
                )
              })}
            </div>
            </section>
          </div>
        </section>
      </div>
    )
  }

  function renderProviderRows(kind: ProviderEditorKind) {
    if (kind === 'openai-compatibility') {
      return state.aiProviders.openaiCompatibility.map((record) => (
        <article className="provider-row" key={`openai-${record.index}`}>
          <div className="provider-copy">
            <strong>{record.name || `OpenAI 提供商 ${record.index + 1}`}</strong>
            <span>
              {record.baseUrl || '未设置 Base URL'} · Key 条目 {record.apiKeyEntries.length}
            </span>
          </div>
          <div className="mini-actions">
            <button
              className="icon-button"
              onClick={() => setProviderEditor(buildOpenAIProviderEditor(record))}
              type="button"
            >
              <Pencil size={16} />
            </button>
            <button
              className="icon-button danger"
              onClick={() =>
                void runStateAction(
                  `delete-openai-${record.index}`,
                  () =>
                    window.cliproxy.deleteAiProvider({
                      kind: 'openai-compatibility',
                      index: record.index,
                    }),
                  '已删除提供商',
                )
              }
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </article>
      ))
    }

    if (kind === 'ampcode') {
      const record = state.aiProviders.ampcode

      if (!record) {
        return null
      }

      return (
        <article className="provider-row" key="ampcode">
          <div className="provider-copy">
            <strong>Ampcode</strong>
            <span>{record.upstreamUrl || '未设置上游 URL'}</span>
          </div>
          <div className="mini-actions">
            <button
              className="icon-button"
              onClick={() => setProviderEditor(buildAmpcodeEditor(record))}
              type="button"
            >
              <Pencil size={16} />
            </button>
            <button
              className="icon-button danger"
              onClick={() =>
                void runStateAction(
                  'delete-ampcode',
                  () => window.cliproxy.deleteAiProvider({ kind: 'ampcode' }),
                  '已删除 Ampcode 配置',
                )
              }
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </article>
      )
    }

    const records = state.aiProviders[kind]

    return records.map((record) => (
      <article className="provider-row" key={`${kind}-${record.index}`}>
        <div className="provider-copy">
          <strong>{record.baseUrl || `${kind} #${record.index + 1}`}</strong>
          <span>
            Prefix {record.prefix || '-'} · 优先级 {record.priority ?? '-'}
          </span>
        </div>
        <div className="mini-actions">
          <button
            className="icon-button"
            onClick={() => setProviderEditor(buildKeyProviderEditor(kind, record))}
            type="button"
          >
            <Pencil size={16} />
          </button>
          <button
            className="icon-button danger"
            onClick={() =>
              void runStateAction(
                `delete-${kind}-${record.index}`,
                () =>
                  window.cliproxy.deleteAiProvider({
                    kind,
                    index: record.index,
                  }),
                '已删除配置',
              )
            }
            type="button"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </article>
    ))
  }

  function renderProviderEditor() {
    if (!providerEditor) {
      return (
        <div className="empty-panel">
          <strong>选择左侧条目开始编辑</strong>
          <span>这里只保留必要参数和参数解释。</span>
        </div>
      )
    }

    if (providerEditor.kind === 'openai-compatibility') {
      return (
        <div className="editor-stack">
          <TextField
            help="提供商名称。"
            label="名称"
            onChange={(value) =>
              setProviderEditor((current) =>
                current && current.kind === 'openai-compatibility'
                  ? { ...current, name: value }
                  : current,
              )
            }
            value={providerEditor.name}
          />
          <TextField
            help="兼容接口的 Base URL。"
            label="Base URL"
            onChange={(value) =>
              setProviderEditor((current) =>
                current && current.kind === 'openai-compatibility'
                  ? { ...current, baseUrl: value }
                  : current,
              )
            }
            value={providerEditor.baseUrl}
          />
          <TextField
            help="请求前缀，不填则留空。"
            label="Prefix"
            onChange={(value) =>
              setProviderEditor((current) =>
                current && current.kind === 'openai-compatibility'
                  ? { ...current, prefix: value }
                  : current,
              )
            }
            value={providerEditor.prefix}
          />
          <TextField
            help="数字越小越优先。"
            label="优先级"
            onChange={(value) =>
              setProviderEditor((current) =>
                current && current.kind === 'openai-compatibility'
                  ? { ...current, priority: value }
                  : current,
              )
            }
            type="number"
            value={providerEditor.priority}
          />
          <TextField
            help="测试连通性时优先使用的模型名。"
            label="测试模型"
            onChange={(value) =>
              setProviderEditor((current) =>
                current && current.kind === 'openai-compatibility'
                  ? { ...current, testModel: value }
                  : current,
              )
            }
            value={providerEditor.testModel}
          />
          <TextAreaField
            help="每行一个 Header，格式 key = value。"
            label="Headers"
            onChange={(value) =>
              setProviderEditor((current) =>
                current && current.kind === 'openai-compatibility'
                  ? { ...current, headersText: value }
                  : current,
              )
            }
            placeholder="Authorization = Bearer xxx"
            value={providerEditor.headersText}
          />
          <TextAreaField
            help="模型映射原始文本。支持 alias = name 或 name, alias。"
            label="模型映射（高级）"
            onChange={(value) =>
              setProviderEditor((current) =>
                current && current.kind === 'openai-compatibility'
                  ? { ...current, modelsText: value }
                  : current,
              )
            }
            placeholder="gpt-4o-mini, gpt-4o"
            value={providerEditor.modelsText}
          />
          <div className="model-editor-panel">
            <div className="model-editor-head">
              <strong>模型列表（name[, alias]）</strong>
              <button
                className="ghost-button"
                onClick={() => updateProviderEditorModels((models) => [...models, { name: '', alias: '' }])}
                type="button"
              >
                <Plus size={16} />
                添加模型
              </button>
            </div>
            {parseModelsText(providerEditor.modelsText).map((model, index) => (
              <div className="model-row" key={`openai-model-${index}`}>
                <input
                  className="field-input"
                  onChange={(event) =>
                    updateProviderEditorModels((models) =>
                      models.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, name: event.target.value } : item,
                      ),
                    )
                  }
                  placeholder="模型名称"
                  value={model.name}
                />
                <span>→</span>
                <input
                  className="field-input"
                  onChange={(event) =>
                    updateProviderEditorModels((models) =>
                      models.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, alias: event.target.value } : item,
                      ),
                    )
                  }
                  placeholder="模型别名（可选）"
                  value={model.alias === model.name ? '' : model.alias}
                />
                <button
                  className="icon-button"
                  onClick={() =>
                    updateProviderEditorModels((models) => models.filter((_, itemIndex) => itemIndex !== index))
                  }
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="action-row">
            <button
              className="ghost-button"
              disabled={busyAction === `fetch-provider-models-${providerEditor.kind}`}
              onClick={() => {
                void fetchModelsForProviderEditor()
              }}
              type="button"
            >
              <Download size={16} />
              拉取模型
            </button>
            {fetchedModels.length > 0 ? (
              <button className="ghost-button" onClick={appendSelectedFetchedModels} type="button">
                添加勾选模型
              </button>
            ) : null}
          </div>
          {fetchedModels.length > 0 ? (
            <div className="model-pick-grid">
              {fetchedModels.map((modelName) => (
                <label className="model-pick-item" key={modelName}>
                  <input
                    checked={selectedFetchedModels[modelName] === '1'}
                    onChange={(event) =>
                      setSelectedFetchedModels((current) => ({
                        ...current,
                        [modelName]: event.target.checked ? '1' : '0',
                      }))
                    }
                    type="checkbox"
                  />
                  <span>{modelName}</span>
                </label>
              ))}
            </div>
          ) : null}
          <TextAreaField
            help="每行一个 Key 条目，格式 apiKey | proxyUrl | HeaderA=1; HeaderB=2。"
            label="API Key 条目"
            onChange={(value) =>
              setProviderEditor((current) =>
                current && current.kind === 'openai-compatibility'
                  ? { ...current, apiKeyEntriesText: value }
                  : current,
              )
            }
            placeholder="sk-xxx | http://127.0.0.1:7890"
            rows={5}
            value={providerEditor.apiKeyEntriesText}
          />
        </div>
      )
    }

    if (providerEditor.kind === 'ampcode') {
      return (
        <div className="editor-stack">
          <TextField
            help="Ampcode 上游接口地址。"
            label="上游 URL"
            onChange={(value) =>
              setProviderEditor((current) =>
                current && current.kind === 'ampcode'
                  ? { ...current, upstreamUrl: value }
                  : current,
              )
            }
            value={providerEditor.upstreamUrl}
          />
          <TextField
            help="默认上游 Key。"
            label="上游 API Key"
            onChange={(value) =>
              setProviderEditor((current) =>
                current && current.kind === 'ampcode'
                  ? { ...current, upstreamApiKey: value }
                  : current,
              )
            }
            value={providerEditor.upstreamApiKey}
          />
          <TextAreaField
            help="每行一个映射，格式 upstreamKey => key1, key2。"
            label="上游 Key 映射"
            onChange={(value) =>
              setProviderEditor((current) =>
                current && current.kind === 'ampcode'
                  ? { ...current, upstreamApiKeysText: value }
                  : current,
              )
            }
            placeholder="upstream-1 => key-a, key-b"
            rows={5}
            value={providerEditor.upstreamApiKeysText}
          />
          <TextAreaField
            help="每行一个模型映射，格式 from => to。"
            label="模型映射"
            onChange={(value) =>
              setProviderEditor((current) =>
                current && current.kind === 'ampcode'
                  ? { ...current, modelMappingsText: value }
                  : current,
              )
            }
            placeholder="o3 => gpt-4.1"
            rows={5}
            value={providerEditor.modelMappingsText}
          />
          <ToggleField
            checked={providerEditor.forceModelMappings}
            help="开启后严格使用上面的模型映射。"
            label="强制模型映射"
            onChange={(checked) =>
              setProviderEditor((current) =>
                current && current.kind === 'ampcode'
                  ? { ...current, forceModelMappings: checked }
                  : current,
              )
            }
          />
        </div>
      )
    }

    return (
      <div className="editor-stack">
        <TextField
          help="该提供商的 API Key。"
          label="API Key"
          onChange={(value) =>
            setProviderEditor((current) =>
              current && current.kind === providerEditor.kind
                ? { ...current, apiKey: value }
                : current,
            )
          }
          value={providerEditor.apiKey}
        />
        <TextField
          help="上游接口地址，不填则使用默认。"
          label="Base URL"
          onChange={(value) =>
            setProviderEditor((current) =>
              current && current.kind === providerEditor.kind
                ? { ...current, baseUrl: value }
                : current,
            )
          }
          value={providerEditor.baseUrl}
        />
        <TextField
          help="请求前缀，不填则留空。"
          label="Prefix"
          onChange={(value) =>
            setProviderEditor((current) =>
              current && current.kind === providerEditor.kind
                ? { ...current, prefix: value }
                : current,
            )
          }
          value={providerEditor.prefix}
        />
        <TextField
          help="数字越小越优先。"
          label="优先级"
          onChange={(value) =>
            setProviderEditor((current) =>
              current && current.kind === providerEditor.kind
                ? { ...current, priority: value }
                : current,
            )
          }
          type="number"
          value={providerEditor.priority}
        />
        <TextField
          help="请求走指定代理时填写。"
          label="Proxy URL"
          onChange={(value) =>
            setProviderEditor((current) =>
              current && current.kind === providerEditor.kind
                ? { ...current, proxyUrl: value }
                : current,
            )
          }
          value={providerEditor.proxyUrl}
        />
        <TextAreaField
          help="每行一个 Header，格式 key = value。"
          label="Headers"
          onChange={(value) =>
            setProviderEditor((current) =>
              current && current.kind === providerEditor.kind
                ? { ...current, headersText: value }
                : current,
            )
          }
          placeholder="Authorization = Bearer xxx"
          value={providerEditor.headersText}
        />
        <TextAreaField
          help="模型映射原始文本。支持 alias = name 或 name, alias。"
          label="模型映射（高级）"
          onChange={(value) =>
            setProviderEditor((current) =>
              current && current.kind === providerEditor.kind
                ? { ...current, modelsText: value }
                : current,
            )
          }
          placeholder="claude-sonnet-4-5"
          value={providerEditor.modelsText}
        />
        <div className="model-editor-panel">
          <div className="model-editor-head">
            <strong>模型列表（name[, alias]）</strong>
            <button
              className="ghost-button"
              onClick={() => updateProviderEditorModels((models) => [...models, { name: '', alias: '' }])}
              type="button"
            >
              <Plus size={16} />
              添加模型
            </button>
          </div>
          {parseModelsText(providerEditor.modelsText).map((model, index) => (
            <div className="model-row" key={`provider-model-${index}`}>
              <input
                className="field-input"
                onChange={(event) =>
                  updateProviderEditorModels((models) =>
                    models.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
                placeholder="模型名称"
                value={model.name}
              />
              <span>→</span>
              <input
                className="field-input"
                onChange={(event) =>
                  updateProviderEditorModels((models) =>
                    models.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, alias: event.target.value } : item,
                    ),
                  )
                }
                placeholder="模型别名（可选）"
                value={model.alias === model.name ? '' : model.alias}
              />
              <button
                className="icon-button"
                onClick={() =>
                  updateProviderEditorModels((models) => models.filter((_, itemIndex) => itemIndex !== index))
                }
                type="button"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="action-row">
          <button
            className="ghost-button"
            disabled={busyAction === `fetch-provider-models-${providerEditor.kind}`}
            onClick={() => {
              void fetchModelsForProviderEditor()
            }}
            type="button"
          >
            <Download size={16} />
            拉取模型
          </button>
          {fetchedModels.length > 0 ? (
            <button className="ghost-button" onClick={appendSelectedFetchedModels} type="button">
              添加勾选模型
            </button>
          ) : null}
        </div>
        {fetchedModels.length > 0 ? (
          <div className="model-pick-grid">
            {fetchedModels.map((modelName) => (
              <label className="model-pick-item" key={modelName}>
                <input
                  checked={selectedFetchedModels[modelName] === '1'}
                  onChange={(event) =>
                    setSelectedFetchedModels((current) => ({
                      ...current,
                      [modelName]: event.target.checked ? '1' : '0',
                    }))
                  }
                  type="checkbox"
                />
                <span>{modelName}</span>
              </label>
            ))}
          </div>
        ) : null}
        <TextAreaField
          help="每行一个要排除的模型名。"
          label="排除模型"
          onChange={(value) =>
            setProviderEditor((current) =>
              current && current.kind === providerEditor.kind
                ? { ...current, excludedModelsText: value }
                : current,
            )
          }
          placeholder="claude-3-opus"
          value={providerEditor.excludedModelsText}
        />
        {providerEditor.kind !== 'gemini' ? (
          <ToggleField
            checked={providerEditor.websockets}
            help="需要 WebSocket 连接时开启。"
            label="WebSockets"
            onChange={(checked) =>
              setProviderEditor((current) =>
                current && current.kind === providerEditor.kind
                  ? { ...current, websockets: checked }
                  : current,
              )
            }
          />
        ) : null}
      </div>
    )
  }

  function renderProviders() {
    return (
      <div className="content-grid split">
        <section className="section-card stack-column">
          {AI_PROVIDER_SECTIONS.map((section) => {
            const rows = renderProviderRows(section.kind)
            return (
              <div className="provider-section" key={section.kind}>
                <div className="section-head compact">
                  <h2>{section.title}</h2>
                  <button
                    className="icon-button"
                    onClick={() => setProviderEditor(buildEmptyProviderEditor(section.kind))}
                    type="button"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {rows && (Array.isArray(rows) ? rows.length > 0 : true) ? (
                  <div className="stack-column">{rows}</div>
                ) : (
                  <div className="empty-inline">尚未配置</div>
                )}
              </div>
            )
          })}
        </section>

        <section className="section-card">
          <div className="section-head">
            <div>
              <h2>编辑面板</h2>
              <p>只保留参数解释。</p>
            </div>
            <div className="action-row">
              <button
                className="ghost-button"
                onClick={() => setProviderEditor(null)}
                type="button"
              >
                关闭
              </button>
              <button
                className="primary-button"
                disabled={!providerEditor || busyAction === 'save-provider-editor'}
                onClick={() => {
                  void saveProviderEditor()
                }}
                type="button"
              >
                <Save size={16} />
                保存
              </button>
            </div>
          </div>
          {renderProviderEditor()}
        </section>
      </div>
    )
  }

  function renderQuotaSummary(fileName: string) {
    const quotaState = quotaStateByFile[fileName]

    if (!quotaState) {
      return null
    }

    if (quotaState.loading) {
      return <div className="quota-empty">正在读取额度信息...</div>
    }

    if (quotaState.error) {
      return <div className="quota-empty error">{quotaState.error}</div>
    }

    if (!quotaState.summary) {
      return null
    }

    const summary = quotaState.summary
    const items = getDashboardQuotaItems(summary)
    const noteItem =
      summary.metas.find((item) => item.label === '说明' && item.value.trim()) ?? null
    const metaItems = summary.metas.slice(0, 2)

    return (
      <section className="auth-quota-compact">
        <div className="auth-quota-head">
          <strong>{summary.providerLabel} 额度</strong>
          <span>{formatTime(summary.fetchedAt)}</span>
        </div>

        {items.length > 0 ? (
          <div className="auth-quota-list">
            {items.map((item) => {
              const remainingPercent =
                item.remainingPercent === null || Number.isNaN(item.remainingPercent)
                  ? null
                  : Math.max(0, Math.min(100, item.remainingPercent))

              return (
                <article className="auth-quota-row" key={item.id}>
                  <div className="auth-quota-copy">
                    <span>{formatDashboardQuotaLabel(item)}</span>
                    <strong>{remainingPercent === null ? '未提供' : `${formatPercent(remainingPercent)}`}</strong>
                  </div>
                  <div className="quota-bar auth-quota-bar">
                    <span
                      className="quota-bar-fill"
                      style={{ width: `${remainingPercent ?? 0}%` }}
                    />
                  </div>
                  <div className="auth-quota-meta">
                    <span>{item.amountText ?? '暂无额度数值'}</span>
                    <span>{formatQuotaResetDisplay(item, quotaClockMs)}</span>
                  </div>
                </article>
              )
            })}
          </div>
        ) : noteItem ? (
          <div className="quota-empty error">{noteItem.value}</div>
        ) : (
          <div className="quota-empty">当前认证文件暂无可展示额度。</div>
        )}

        {metaItems.length > 0 ? (
          <div className="auth-meta-chips">
            {metaItems.map((item) => (
              <span className="tag-pill" key={`${item.label}-${item.value}`}>
                {item.label} {item.value}
              </span>
            ))}
          </div>
        ) : null}
      </section>
    )
  }

  function renderAuthFiles() {
    const totalFiles = state.authFiles.length
    const enabledFiles = state.authFiles.filter((file) => file.enabled).length
    const quotaReadyFiles = state.authFiles.filter(
      (file) => canFetchQuota(file) && !file.unavailable,
    ).length
    const activeProviders = state.providerImports.filter((entry) => entry.totalCount > 0).length
    const latestModifiedAt = [...state.authFiles]
      .map((file) => getDateRank(file.modifiedAt, file.updatedAt, file.createdAt))
      .sort((left, right) => right - left)[0]

    return (
      <div className="page-stack">
        <section className="section-card auth-files-section">
          <div className="section-head auth-files-head">
            <div>
              <h2>认证文件</h2>
            </div>
            <div className="action-row">
              <button
                className="ghost-button"
                onClick={() =>
                  void runStateAction(
                    'pick-auth-files',
                    () => window.cliproxy.pickAuthFiles(),
                    '已导入认证文件',
                  )
                }
                type="button"
              >
                <HardDriveUpload size={16} />
                导入 JSON
              </button>
              <button
                className="ghost-button"
                onClick={() => void window.cliproxy.openPath(state.paths.authDir)}
                type="button"
              >
                <FolderOpen size={16} />
                打开目录
              </button>
            </div>
          </div>

          <div className="auth-files-summary-grid">
            <article className="auth-files-summary-card">
              <span>认证文件总数</span>
              <strong>{formatCount(totalFiles)}</strong>
            </article>
            <article className="auth-files-summary-card">
              <span>当前启用</span>
              <strong>{formatCount(enabledFiles)}</strong>
            </article>
            <article className="auth-files-summary-card">
              <span>可读取额度</span>
              <strong>{formatCount(quotaReadyFiles)}</strong>
            </article>
            <article className="auth-files-summary-card">
              <span>提供商覆盖</span>
              <strong>{formatCount(activeProviders)}</strong>
              <em>{latestModifiedAt ? `最近更新 ${formatTime(new Date(latestModifiedAt).toISOString())}` : '暂无更新时间'}</em>
            </article>
          </div>

          <div className="auth-files-list">
            {state.authFiles.length === 0 ? (
              <div className="empty-panel">
                <strong>当前目录还没有认证文件</strong>
                <span>程序只会读取 `auth-files` 子目录里的 JSON 认证文件。</span>
              </div>
            ) : (
              state.authFiles.map((file) => (
                <article className="auth-file-simple-card" key={file.name}>
                  {(() => {
                    const quotaState = quotaStateByFile[file.name]
                    const quotaSummary = quotaState?.summary ?? null
                    const compactDetails = getCompactAuthDetails(file)
                    const planLabel = formatPlanLabel(quotaSummary?.planType ?? file.planType)
                    const identitySummary = compactDetails.map((item) => `${item.label} ${item.value}`).join(' · ')
                    const providerLabel = quotaSummary?.providerLabel ?? file.provider

                    return (
                      <>
                        <div className="auth-file-simple-head">
                          <div className="auth-file-simple-copy">
                            <div className="auth-file-simple-badges">
                              <span className="tag-pill">{file.type}</span>
                              <span className={`tag-pill ${file.enabled ? 'status-pill-on' : 'status-pill-off'}`}>
                                {file.enabled ? '启用' : '停用'}
                              </span>
                              {planLabel ? <span className="tag-pill">{planLabel}</span> : null}
                              {file.authIndex ? <span className="tag-pill">索引 {file.authIndex}</span> : null}
                              {file.status ? <span className="tag-pill">{file.status}</span> : null}
                            </div>
                            <strong>{file.displayName}</strong>
                            <span>{providerLabel} · {formatBytes(file.size)} · 修改 {formatTime(file.modifiedAt)}</span>
                          </div>
                          <div className="mini-actions auth-file-simple-actions">
                            <button
                              className="icon-button"
                              onClick={() => {
                                void fetchQuota(file.name, true)
                              }}
                              type="button"
                            >
                              <RefreshCcw size={16} />
                            </button>
                            <button
                              className="icon-button"
                              onClick={() => void window.cliproxy.openPath(file.path)}
                              type="button"
                            >
                              <ExternalLink size={16} />
                            </button>
                            <button
                              className="icon-button danger"
                              onClick={() =>
                                void runStateAction(
                                  `delete-auth-${file.name}`,
                                  () => window.cliproxy.deleteAuthFile(file.name),
                                  '认证文件已删除',
                                )
                              }
                              type="button"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                        {file.statusMessage ? <div className="inline-note">{file.statusMessage}</div> : null}

                        <div className="auth-file-simple-grid">
                          <div className="auth-file-simple-meta">
                            <div className="auth-file-simple-row">
                              <span>识别信息</span>
                              <strong>{identitySummary || '未解析到身份字段'}</strong>
                            </div>
                            <div className="auth-file-simple-row">
                              <span>同步状态</span>
                              <strong>{file.statusMessage || file.status || '等待同步'}</strong>
                            </div>
                            <div className="auth-file-simple-row auth-file-simple-path">
                              <span>文件路径</span>
                              <strong>{file.path}</strong>
                            </div>
                          </div>

                          <div className="auth-file-simple-quota">
                            {canFetchQuota(file) ? (
                              renderQuotaSummary(file.name)
                            ) : (
                              <div className="quota-empty compact">当前类型暂不支持额度查询。</div>
                            )}
                          </div>
                        </div>

                        <div className="auth-file-simple-foot">
                          <div className="auth-file-simple-tags">
                            {file.source ? <span className="tag-pill">来源 {file.source}</span> : null}
                            {file.runtimeOnly ? <span className="tag-pill">运行时</span> : null}
                            {file.unavailable ? <span className="tag-pill">不可用</span> : null}
                            {file.updatedAt ? <span className="tag-pill">远端更新 {formatTime(file.updatedAt)}</span> : null}
                          </div>
                          <div className="auth-enable-switch">
                            <span>启用</span>
                            <button
                              className={`toggle-button ${file.enabled ? 'on' : ''}`}
                              disabled={busyAction === `toggle-auth-${file.name}`}
                              onClick={() =>
                                void runStateAction(
                                  `toggle-auth-${file.name}`,
                                  () => window.cliproxy.toggleAuthFile(file.name),
                                  `认证文件已${file.enabled ? '停用' : '启用'}`,
                                )
                              }
                              type="button"
                            >
                              <span className="toggle-thumb" />
                            </button>
                          </div>
                        </div>
                      </>
                    )
                  })()}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    )
  }

  function renderLogs() {
    return (
      <section className="section-card">
        <div className="section-head">
          <div>
            <h2>日志</h2>
            <p>显示主进程与代理进程的最新输出。</p>
          </div>
          <div className="action-row">
            <button
              className="ghost-button"
              onClick={() => void window.cliproxy.openPath(state.paths.logsDir)}
              type="button"
            >
              <FolderOpen size={16} />
              打开目录
            </button>
            <button
              className="ghost-button"
              onClick={() =>
                void runStateAction('clear-logs', () => window.cliproxy.clearLogs(), '日志已清空')
              }
              type="button"
            >
              <Trash2 size={16} />
              清空日志
            </button>
          </div>
        </div>
        <div className="log-list">
          {deferredLogs.length === 0 ? (
            <div className="empty-panel">
              <strong>暂无日志</strong>
            </div>
          ) : (
            deferredLogs
              .slice()
              .reverse()
              .map((entry, index) => (
                <article className={`log-row level-${entry.level}`} key={`${entry.timestamp}-${index}`}>
                  <span className="log-time">{formatTime(entry.timestamp)}</span>
                  <span className="log-source">{entry.source}</span>
                  <span className="log-message">{entry.message}</span>
                </article>
              ))
          )}
        </div>
      </section>
    )
  }

  function renderSettings() {
    return (
      <div className="page-stack">
        <section className="section-card">
          <div className="section-head">
            <div>
              <h2>基础设置</h2>
            </div>
            <button
              className="primary-button"
              disabled={busyAction === 'save-settings'}
              onClick={() => {
                void saveSettings()
              }}
              type="button"
            >
              <Save size={16} />
              保存设置
            </button>
          </div>

          <div className="form-grid two-columns">
            <TextField
              help="本地代理端口，默认 8313。"
              label="端口"
              min={1}
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({
                  ...current,
                  port: Number.parseInt(value || `${DEFAULT_PORT}`, 10) || DEFAULT_PORT,
                }))
              }}
              type="number"
              value={settingsDraft.port}
            />
            <TextField
              help="普通 API 请求使用的本地密钥。"
              label="Proxy API Key"
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({ ...current, proxyApiKey: value }))
              }}
              value={settingsDraft.proxyApiKey}
            />
            <TextField
              help="WebUI 与管理接口使用的密钥。"
              label="Management API Key"
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({ ...current, managementApiKey: value }))
              }}
              value={settingsDraft.managementApiKey}
            />
            <TextField
              disabled={settingsDraft.useSystemProxy}
              help="关闭系统代理时，这里填写固定代理地址。"
              label="代理 URL"
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({ ...current, proxyUrl: value }))
              }}
              placeholder="http://127.0.0.1:7890"
              value={settingsDraft.proxyUrl}
            />
            <TextField
              help="可选。给系统代理或手动代理附加用户名。"
              label="代理用户名"
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({ ...current, proxyUsername: value }))
              }}
              placeholder="可选"
              value={settingsDraft.proxyUsername}
            />
            <TextField
              help="可选。给系统代理或手动代理附加密码。"
              label="代理密码"
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({ ...current, proxyPassword: value }))
              }}
              placeholder="可选"
              type="password"
              value={settingsDraft.proxyPassword}
            />
            <TextField
              help="失败请求的重试预算。429 / 403 / 408 / 5xx 都会消耗这里的次数，建议保持 5。"
              label="request-retry"
              min={0}
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({
                  ...current,
                  requestRetry: Number.parseInt(value || '0', 10) || 0,
                }))
              }}
              type="number"
              value={settingsDraft.requestRetry}
            />
            <TextField
              help="等待重试上限，单位秒。上游 Retry-After 超过这个值时通常不会等待，建议至少 30 秒。"
              label="max-retry-interval"
              min={0}
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({
                  ...current,
                  maxRetryInterval: Number.parseInt(value || '0', 10) || 0,
                }))
              }}
              type="number"
              value={settingsDraft.maxRetryInterval}
            />
            <div className="inline-note">
              为了尽量规避 429，默认策略已调整为 `request-retry = 5`、`max-retry-interval = 30`。
              如果仍然频繁触发限流，优先增大等待上限，再考虑继续增加重试次数。
            </div>
            <TextField
              help="流式响应的 keepalive 秒数，0 表示关闭。"
              label="Keepalive 秒数"
              min={0}
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({
                  ...current,
                  streamKeepaliveSeconds: Number.parseInt(value || '0', 10) || 0,
                }))
              }}
              type="number"
              value={settingsDraft.streamKeepaliveSeconds}
            />
            <TextField
              help="流式首包前的 bootstrap 重试次数。"
              label="Bootstrap 重试"
              min={0}
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({
                  ...current,
                  streamBootstrapRetries: Number.parseInt(value || '0', 10) || 0,
                }))
              }}
              type="number"
              value={settingsDraft.streamBootstrapRetries}
            />
            <TextField
              help="非流式 keepalive 间隔，单位秒。"
              label="非流式 Keepalive"
              min={0}
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({
                  ...current,
                  nonStreamKeepaliveIntervalSeconds: Number.parseInt(value || '0', 10) || 0,
                }))
              }}
              type="number"
              value={settingsDraft.nonStreamKeepaliveIntervalSeconds}
            />
            <SelectField
              help="默认使用 main 主线；切到 plus 后，检查更新和下载更新都会改走 CLIProxyAPIPlus。"
              label="Sidecar 通道"
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({
                  ...current,
                  sidecarChannel: value as SaveKnownSettingsInput['sidecarChannel'],
                }))
              }}
              options={[
                { label: 'main', value: 'main' },
                { label: 'plus', value: 'plus' },
              ]}
              value={settingsDraft.sidecarChannel}
            />
          </div>

          <div className="form-grid">
            <ToggleField
              checked={settingsDraft.useSystemProxy}
              help="开启后优先读取系统代理。"
              label="使用系统代理"
              onChange={(checked) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({ ...current, useSystemProxy: checked }))
              }}
            />
            <ToggleField
              checked={settingsDraft.launchAtLogin}
              help="系统登录后自动启动 lich13CPA。"
              label="开机自启"
              onChange={(checked) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({ ...current, launchAtLogin: checked }))
              }}
            />
            <ToggleField
              checked={settingsDraft.autoStartProxyOnLaunch}
              help="程序启动后自动拉起代理。"
              label="自动启动代理"
              onChange={(checked) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({ ...current, autoStartProxyOnLaunch: checked }))
              }}
            />
            <ToggleField
              checked={settingsDraft.minimizeToTrayOnClose}
              help="关闭窗口时改为缩到托盘。"
              label="关闭缩到托盘"
              onChange={(checked) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({ ...current, minimizeToTrayOnClose: checked }))
              }}
            />
            <ToggleField
              checked={settingsDraft.autoSyncOnStop}
              help="停止代理时把运行中的配置同步回本地。"
              label="停止时回写配置"
              onChange={(checked) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({ ...current, autoSyncOnStop: checked }))
              }}
            />
          </div>
        </section>
      </div>
    )
  }

  function renderPage() {
    if (currentPage === 'dashboard') {
      return renderDashboard()
    }

    if (currentPage === 'providers') {
      return renderProviders()
    }

    if (currentPage === 'auth-files') {
      return renderAuthFiles()
    }

    if (currentPage === 'logs') {
      return renderLogs()
    }

    return renderSettings()
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <img alt="lich13CPA" className="brand-icon" src={APP_ICON_SRC} />
          <div>
            <strong>lich13CPA</strong>
            <p>最简 CLIProxyAPI 桌面壳</p>
          </div>
        </div>

        <nav className="nav-list">
          {PAGES.map((page) => {
            const Icon = page.icon
            return (
              <button
                className={`nav-item ${currentPage === page.id ? 'active' : ''}`}
                key={page.id}
                onClick={() => setCurrentPage(page.id)}
                type="button"
              >
                <Icon size={18} />
                <span>{page.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-status">
          <span className={`dot ${state.proxyStatus.running ? 'online' : 'offline'}`} />
          <div>
            <strong>{state.proxyStatus.running ? '代理运行中' : '代理未启动'}</strong>
            <span>{state.proxyStatus.webUiUrl}</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{currentPageMeta.label}</h1>
            <p>{state.paths.baseDir}</p>
          </div>
          <div className="topbar-actions">
            <button
              className="ghost-button"
              disabled={busyAction === 'refresh-view'}
              onClick={() => {
                void refreshCurrentPage()
              }}
              type="button"
            >
              <RefreshCcw size={16} />
              刷新
            </button>
            <button
              className="ghost-button"
              onClick={() => void window.cliproxy.openPath(state.paths.baseDir)}
              type="button"
            >
              <FolderOpen size={16} />
              打开目录
            </button>
          </div>
        </header>

        {notice ? <div className={`notice ${notice.kind}`}>{notice.text}</div> : null}
        {renderWarnings()}
        {renderPage()}
      </main>
    </div>
  )
}

export default App
