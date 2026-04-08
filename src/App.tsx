import {
  BarChart3,
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
  UsagePoint,
  UsageSummary,
  UsageSummaryQuery,
  UsageSummaryQueryPreset,
} from '../shared/types'
import './App.css'

const APP_ICON_SRC = 'app-icon.png'

type Notice = { kind: 'success' | 'error'; text: string }
type QuotaState = { error: string | null; loading: boolean; summary: AuthFileQuotaSummary | null }
type KeyProviderKind = 'gemini' | 'codex' | 'claude' | 'vertex'
type ProviderEditorKind = KeyProviderKind | 'openai-compatibility' | 'ampcode'
type UsageCustomRangeDraft = { endAt: string; startAt: string }
type EditableModelEntry = { alias: string; id: string; name: string }

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
  description: string
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
  help: string
  label: string
  onChange: (checked: boolean) => void
}

const DEFAULT_PORT = 8313
const DEFAULT_REQUEST_RETRY = 5
const DEFAULT_MAX_RETRY_INTERVAL = 3
const DEFAULT_STREAM_KEEPALIVE_SECONDS = 20
const DEFAULT_STREAM_BOOTSTRAP_RETRIES = 2
const DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS = 15
const DEFAULT_USAGE_PRESET: UsageSummaryQueryPreset = '7d'

const EMPTY_SETTINGS: SaveKnownSettingsInput = {
  port: DEFAULT_PORT,
  useSystemProxy: false,
  proxyUrl: '',
  proxyApiKey: 'cliproxy-local',
  managementApiKey: 'cliproxy-management',
  requestRetry: DEFAULT_REQUEST_RETRY,
  maxRetryInterval: DEFAULT_MAX_RETRY_INTERVAL,
  streamKeepaliveSeconds: DEFAULT_STREAM_KEEPALIVE_SECONDS,
  streamBootstrapRetries: DEFAULT_STREAM_BOOTSTRAP_RETRIES,
  nonStreamKeepaliveIntervalSeconds: DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS,
  thinkingBudgetMode: 'medium',
  thinkingBudgetCustom: 16000,
  reasoningEffort: 'xhigh',
  autoSyncOnStop: true,
  launchAtLogin: true,
  autoStartProxyOnLaunch: true,
  minimizeToTrayOnClose: true,
}

const PAGES: PageMeta[] = [
  { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { id: 'providers', label: 'AI 提供商', icon: Bot },
  { id: 'auth-files', label: '认证文件', icon: ShieldCheck },
  { id: 'usage', label: '用量统计', icon: BarChart3 },
  { id: 'logs', label: '日志', icon: ScrollText },
  { id: 'settings', label: '设置', icon: Settings2 },
]

const AI_PROVIDER_SECTIONS: ProviderSectionMeta[] = [
  { kind: 'openai-compatibility', title: 'OpenAI 兼容提供商' },
  { kind: 'claude', title: 'Claude API 配置' },
  { kind: 'codex', title: 'Codex API 配置' },
  { kind: 'gemini', title: 'Gemini API 配置' },
  { kind: 'vertex', title: 'Vertex API 配置' },
  { kind: 'ampcode', title: 'Ampcode' },
]

const SUPPLIERS: SupplierMeta[] = [
  {
    id: 'codex',
    label: 'Codex OAuth',
    description: '点击 + 打开授权页',
    openMode: 'oauth',
    theme: 'sun',
    summaryIds: ['codex', 'openai'],
  },
  {
    id: 'claude',
    label: 'Anthropic OAuth',
    description: '点击 + 打开授权页',
    openMode: 'oauth',
    theme: 'orange',
  },
  {
    id: 'antigravity',
    label: 'Antigravity OAuth',
    description: '点击 + 打开授权页',
    openMode: 'oauth',
    theme: 'red',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI OAuth',
    description: '点击 + 打开授权页',
    openMode: 'oauth',
    theme: 'gold',
  },
  {
    id: 'kimi',
    label: 'Kimi OAuth',
    description: '点击 + 打开授权页',
    openMode: 'oauth',
    theme: 'sun',
  },
  {
    id: 'qwen',
    label: 'Qwen OAuth',
    description: '点击 + 打开授权页',
    openMode: 'oauth',
    theme: 'orange',
  },
  {
    id: 'vertex',
    label: 'Vertex JSON 登录',
    description: '点击 + 打开 WebUI 的 OAuth 页',
    openMode: 'manual',
    theme: 'gold',
  },
  {
    id: 'iflow',
    label: 'iFlow Cookie 登录',
    description: '点击 + 打开 WebUI 的 OAuth 页',
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

function ToggleField({ checked, help, label, onChange }: ToggleFieldProps) {
  return (
    <label className="toggle-field">
      <span className="toggle-copy">
        <span className="field-label">{label}</span>
        <span className="field-help">{help}</span>
      </span>
      <button
        className={`toggle-button ${checked ? 'on' : ''}`}
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

function formatCompactCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  }

  return formatCount(value)
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

function formatRate(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return '--'
  }

  return formatPercent((numerator / denominator) * 100)
}

function toDateTimeLocalValue(value: Date): string {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  const hour = `${value.getHours()}`.padStart(2, '0')
  const minute = `${value.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function createDefaultUsageCustomRange(): UsageCustomRangeDraft {
  const end = new Date()
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)

  return {
    startAt: toDateTimeLocalValue(start),
    endAt: toDateTimeLocalValue(end),
  }
}

function toIsoDateTime(value: string): string | null {
  const normalized = value.trim()

  if (!normalized) {
    return null
  }

  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function getUsageQueryRangeText(summary: UsageSummary | null): string {
  if (!summary) {
    return '未查询'
  }

  if (summary.rangeStartAt && summary.rangeEndAt) {
    return `${formatTime(summary.rangeStartAt)} - ${formatTime(summary.rangeEndAt)}`
  }

  if (summary.rangeStartAt) {
    return `从 ${formatTime(summary.rangeStartAt)} 开始`
  }

  if (summary.rangeEndAt) {
    return `截至 ${formatTime(summary.rangeEndAt)}`
  }

  return '覆盖全部已记录请求'
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

      if (left.totalRequests !== right.totalRequests) {
        return right.totalRequests - left.totalRequests
      }

      const rightRank = getDateRank(right.lastUsedAt, right.updatedAt, right.modifiedAt)
      const leftRank = getDateRank(left.lastUsedAt, left.updatedAt, left.modifiedAt)

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
    const separatorIndex = line.indexOf('=')

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

function createModelEntryId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function toEditableModelEntries(value: string): EditableModelEntry[] {
  const parsed = parseModelsText(value)

  if (parsed.length === 0) {
    return [{ id: createModelEntryId(), name: '', alias: '' }]
  }

  return parsed.map((entry) => ({
    id: createModelEntryId(),
    name: entry.name,
    alias: entry.alias === entry.name ? '' : entry.alias,
  }))
}

function editableEntriesToModelsText(entries: EditableModelEntry[]): string {
  const models = entries
    .map((entry) => ({
      name: entry.name.trim(),
      alias: entry.alias.trim(),
    }))
    .filter((entry) => entry.name)
    .map((entry) => ({
      name: entry.name,
      alias: entry.alias || entry.name,
    }))

  return stringifyModels(models)
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
    provider === 'kimi' ||
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
    proxyApiKey: state.knownSettings.proxyApiKey,
    managementApiKey: state.knownSettings.managementApiKey,
    requestRetry: state.knownSettings.requestRetry,
    maxRetryInterval: state.knownSettings.maxRetryInterval,
    streamKeepaliveSeconds: state.knownSettings.streamKeepaliveSeconds,
    streamBootstrapRetries: state.knownSettings.streamBootstrapRetries,
    nonStreamKeepaliveIntervalSeconds: state.knownSettings.nonStreamKeepaliveIntervalSeconds,
    thinkingBudgetMode: state.knownSettings.thinkingBudgetMode,
    thinkingBudgetCustom: state.knownSettings.thinkingBudgetCustom,
    reasoningEffort: state.knownSettings.reasoningEffort,
    autoSyncOnStop: state.knownSettings.autoSyncOnStop,
    launchAtLogin: state.knownSettings.launchAtLogin,
    autoStartProxyOnLaunch: state.knownSettings.autoStartProxyOnLaunch,
    minimizeToTrayOnClose: state.knownSettings.minimizeToTrayOnClose,
  }
}

function buildUsageSummaryQuery(
  preset: UsageSummaryQueryPreset,
  customRange: UsageCustomRangeDraft,
): UsageSummaryQuery {
  if (preset !== 'custom') {
    return { preset }
  }

  return {
    preset,
    startAt: toIsoDateTime(customRange.startAt),
    endAt: toIsoDateTime(customRange.endAt),
  }
}

function App() {
  const [appState, setAppState] = useState<DesktopAppState | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState<AppPage>('dashboard')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [providerEditor, setProviderEditor] = useState<ProviderEditorState | null>(null)
  const [quotaStateByFile, setQuotaStateByFile] = useState<Record<string, QuotaState>>({})
  const [usageCustomRangeDraft, setUsageCustomRangeDraft] = useState<UsageCustomRangeDraft>(() =>
    createDefaultUsageCustomRange(),
  )
  const [usagePreset, setUsagePreset] = useState<UsageSummaryQueryPreset>(DEFAULT_USAGE_PRESET)
  const [usageQuery, setUsageQuery] = useState<UsageSummaryQuery>({ preset: DEFAULT_USAGE_PRESET })
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<SaveKnownSettingsInput>(EMPTY_SETTINGS)
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [selectedDiscoveredModels, setSelectedDiscoveredModels] = useState<Record<string, boolean>>({})
  const mountedRef = useRef(true)
  const quotaRequestedRef = useRef(new Set<string>())
  const authPollTimerRef = useRef<Record<string, number>>({})
  const deferredLogs = useDeferredValue(appState?.logs ?? [])
  const refreshUsageSummary = useEffectEvent((query: UsageSummaryQuery) => {
    void fetchUsageSummaryForRange(query)
  })

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
        return
      }

      applyAppState(nextState)
    } catch (error) {
      if (mountedRef.current) {
        pushNotice('error', getErrorText(error))
      }
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
    attempt = 0,
  ) {
    try {
      const result = await window.cliproxy.checkProviderAuthStatus(provider, stateToken)

      if (!mountedRef.current) {
        return
      }

      if (result.status === 'ok') {
        clearAuthPoll(provider)
        pushNotice('success', `${result.label} 已完成授权`)
        await loadState()
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
        void pollProviderAuth(provider, stateToken, attempt + 1)
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
        void pollProviderAuth(provider, stateToken, attempt + 1)
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
      void pollProviderAuth(meta.id, launch.state)
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

  async function fetchUsageSummaryForRange(query: UsageSummaryQuery, announce = false) {
    setUsageLoading(true)

    try {
      const summary = await window.cliproxy.getUsageSummary(query)

      if (!mountedRef.current) {
        return false
      }

      setUsageSummary(summary)

      if (announce) {
        pushNotice('success', '用量统计已刷新')
      }

      return true
    } catch (error) {
      if (!mountedRef.current) {
        return false
      }

      setUsageSummary({
        available: false,
        rangePreset: query.preset ?? DEFAULT_USAGE_PRESET,
        rangeLabel: '查询失败',
        rangeStartAt: query.startAt ?? null,
        rangeEndAt: query.endAt ?? null,
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
        error: getErrorText(error),
      })

      if (announce) {
        pushNotice('error', getErrorText(error))
      }

      return false
    } finally {
      if (mountedRef.current) {
        setUsageLoading(false)
      }
    }
  }

  async function refreshCurrentPage() {
    setBusyAction('refresh-view')

    try {
      const nextState = await window.cliproxy.refreshUsage()

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

      let usageQueryFailed = false

      if (currentPage === 'usage') {
        usageQueryFailed = !(await fetchUsageSummaryForRange(usageQuery, false))
      }

      if (!mountedRef.current) {
        return
      }

      if (quotaFailed && usageQueryFailed) {
        pushNotice('error', '用量统计和认证额度刷新失败，请稍后重试。')
        return
      }

      if (quotaFailed) {
        pushNotice(
          'error',
          currentPage === 'dashboard'
            ? '仪表盘用量已刷新，但部分认证额度刷新失败。'
            : '当前页面已刷新，但部分认证额度刷新失败。',
        )
        return
      }

      if (usageQueryFailed) {
        pushNotice('error', '基础数据已刷新，但时间范围统计刷新失败。')
        return
      }

      if (currentPage === 'dashboard') {
        pushNotice(
          'success',
          quotaTargets.length > 0 ? '已刷新仪表盘用量和认证额度' : '已刷新仪表盘',
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

      if (currentPage === 'usage') {
        pushNotice('success', '已刷新用量统计')
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

  function applyUsagePreset(nextPreset: UsageSummaryQueryPreset) {
    setUsagePreset(nextPreset)

    if (nextPreset !== 'custom') {
      setUsageQuery(buildUsageSummaryQuery(nextPreset, usageCustomRangeDraft))
    }
  }

  function applyCustomUsageRange() {
    const startAt = toIsoDateTime(usageCustomRangeDraft.startAt)
    const endAt = toIsoDateTime(usageCustomRangeDraft.endAt)

    if (!startAt && !endAt) {
      pushNotice('error', '请至少填写一个时间边界。')
      return
    }

    if (startAt && endAt && new Date(startAt).getTime() > new Date(endAt).getTime()) {
      pushNotice('error', '开始时间不能晚于结束时间。')
      return
    }

    setUsagePreset('custom')
    setUsageQuery({
      preset: 'custom',
      startAt,
      endAt,
    })
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
      '已拉取模型列表，请勾选后添加',
    )
    setDiscoveredModels(models)
    setSelectedDiscoveredModels(
      Object.fromEntries(models.map((modelName) => [modelName, true])),
    )
  }

  function toggleDiscoveredModel(modelName: string, checked: boolean) {
    setSelectedDiscoveredModels((current) => ({
      ...current,
      [modelName]: checked,
    }))
  }

  function applySelectedDiscoveredModels() {
    if (!providerEditor || providerEditor.kind === 'ampcode') {
      return
    }

    const selectedNames = discoveredModels.filter((modelName) => selectedDiscoveredModels[modelName])

    if (selectedNames.length === 0) {
      pushNotice('error', '请先勾选要添加的模型')
      return
    }

    const existing = parseModelsText(providerEditor.modelsText)
    const existingNames = new Set(existing.map((entry) => entry.name))
    const appended = selectedNames
      .filter((name) => !existingNames.has(name))
      .map((name) => ({ name, alias: name }))

    const nextModelsText = stringifyModels([...existing, ...appended])

    setProviderEditor((current) =>
      current && current.kind !== 'ampcode'
        ? {
            ...current,
            modelsText: nextModelsText,
          }
        : current,
    )

    pushNotice('success', appended.length > 0 ? `已添加 ${appended.length} 个模型` : '所选模型已存在')
  }

  useEffect(() => {
    mountedRef.current = true
    void loadState()

    const disposeStateListener = window.cliproxy.onStateChanged(() => {
      void loadState()
    })
    const disposeLogsListener = window.cliproxy.onLogsUpdated((entries) => {
      startTransition(() => {
        setAppState((current) => (current ? { ...current, logs: entries } : current))
      })
    })

    return () => {
      mountedRef.current = false
      disposeStateListener()
      disposeLogsListener()
      Object.keys(authPollTimerRef.current).forEach((providerId) => {
        clearAuthPoll(providerId)
      })
    }
  }, [])

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

  const providerEditorIdentity =
    providerEditor
      ? `${providerEditor.kind}-${
          'index' in providerEditor ? String(providerEditor.index ?? 'new') : 'single'
        }`
      : 'none'

  useEffect(() => {
    setDiscoveredModels([])
    setSelectedDiscoveredModels({})
  }, [providerEditorIdentity])

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

  useEffect(() => {
    if (!appState) {
      return
    }

    if (currentPage !== 'usage') {
      return
    }

    refreshUsageSummary(usageQuery)
  }, [appState?.proxyStatus.running, currentPage, usageQuery])

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
    const usageModels = state.usageSummary.topModels.filter(
      (item) => item.requests > 0 || item.totalTokens > 0,
    )
    const cacheHitRate =
      state.usageSummary.inputTokens > 0
        ? (state.usageSummary.cachedTokens / state.usageSummary.inputTokens) * 100
        : 0

    return (
      <div className="page-stack">
        <section className="metrics-grid">
          <article className="metric-card">
            <span className="metric-label">代理状态</span>
            <strong>{state.proxyStatus.running ? '运行中' : '未启动'}</strong>
            <span className="metric-help">
              端口 {state.proxyStatus.port} · PID {state.proxyStatus.pid ?? '未启动'}
            </span>
            <div className="action-row">
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
            </div>
          </article>

          <article className="metric-card">
            <span className="metric-label">请求统计</span>
            <strong>{formatCount(state.usageSummary.totalRequests)}</strong>
            <span className="metric-help">
              成功 {formatCount(state.usageSummary.successCount)} · 失败{' '}
              {formatCount(state.usageSummary.failureCount)}
            </span>
            <div className="metric-pairs">
              <span>输入 Tokens {formatCount(state.usageSummary.inputTokens)}</span>
              <span>输出 Tokens {formatCount(state.usageSummary.outputTokens)}</span>
            </div>
          </article>

          <article className="metric-card metric-card-highlight">
            <span className="metric-label">Token 净消耗</span>
            <strong>{formatCount(state.usageSummary.netTokens)}</strong>
            <span className="metric-help">
              总消耗 {formatCount(state.usageSummary.totalTokens)} · 缓存命中{' '}
              {formatCount(state.usageSummary.cachedTokens)}
            </span>
            <div className="metric-pairs">
              <span>计费输入 {formatCount(state.usageSummary.billableInputTokens)}</span>
              <span>Reasoning {formatCount(state.usageSummary.reasoningTokens)}</span>
            </div>
          </article>

          <article className="metric-card">
            <span className="metric-label">二进制版本</span>
            <strong>{state.proxyBinary.currentVersion ?? '未识别'}</strong>
            <span className="metric-help">
              最新 {state.proxyBinary.latestVersion ?? '未检查'} · 路径{' '}
              {state.proxyBinary.path ? '已就绪' : '未找到'}
            </span>
            <div className="action-row">
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
                    'CLIProxyAPI 已更新',
                  )
                }
                type="button"
              >
                <HardDriveUpload size={16} />
                执行更新
              </button>
            </div>
          </article>
        </section>

        <section className="dashboard-grid">
          <section className="section-card dashboard-section">
            <div className="section-head">
              <div>
                <h2>认证额度</h2>
                <p>首页只保留关键额度，优先显示已启用认证文件。</p>
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
                                      {usedPercent === null
                                        ? '\u5f85\u540c\u6b65'
                                        : `\u5df2\u4f7f\u7528 ${formatPercent(usedPercent)}`}
                                    </strong>
                                  </div>
                                  <div className="quota-bar quota-spotlight-bar">
                                    <span
                                      className="quota-bar-fill"
                                      style={{ width: `${usedPercent ?? 0}%` }}
                                    />
                                  </div>
                                  <div className="quota-progress-meta">
                                    <span>{item.resetText ?? '等待下一次同步'}</span>
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
                            <span>
                              {quotaState?.error ? '刷新失败，显示上次结果' : '额度已同步'}
                            </span>
                          </div>
                        </>
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

          <section className="section-card dashboard-section">
            <div className="section-head">
              <div>
                <h2>Token 使用统计</h2>
                <p>总消耗、净消耗、缓存命中和模型明细分开展示。</p>
              </div>
            </div>

            {!state.proxyStatus.running ? (
              <div className="quota-empty">启动代理后开始累计 token 使用统计。</div>
            ) : state.usageSummary.error ? (
              <div className="quota-empty error">{state.usageSummary.error}</div>
            ) : (
              <div className="usage-panel">
                <div className="usage-snapshot-grid">
                  <article className="usage-snapshot-card">
                    <span className="metric-label">总消耗</span>
                    <strong>{formatCount(state.usageSummary.totalTokens)}</strong>
                    <span className="metric-help">原始输入 + 输出</span>
                  </article>
                  <article className="usage-snapshot-card">
                    <span className="metric-label">净消耗</span>
                    <strong>{formatCount(state.usageSummary.netTokens)}</strong>
                    <span className="metric-help">总消耗扣除缓存命中</span>
                  </article>
                  <article className="usage-snapshot-card">
                    <span className="metric-label">缓存命中</span>
                    <strong>{formatCount(state.usageSummary.cachedTokens)}</strong>
                    <span className="metric-help">重复上下文命中量</span>
                  </article>
                  <article className="usage-snapshot-card">
                    <span className="metric-label">计费输入</span>
                    <strong>{formatCount(state.usageSummary.billableInputTokens)}</strong>
                    <span className="metric-help">输入减去缓存命中</span>
                  </article>
                </div>

                <article className="usage-breakdown-card">
                  <div className="quota-head">
                    <strong>缓存命中率</strong>
                    <span>{formatPercent(cacheHitRate)}</span>
                  </div>
                  <div className="quota-bar">
                    <span
                      className="quota-bar-fill"
                      style={{ width: `${Math.max(0, Math.min(100, cacheHitRate))}%` }}
                    />
                  </div>
                  <div className="quota-meta">
                    <span>原始输入 {formatCount(state.usageSummary.inputTokens)}</span>
                    <span>Reasoning {formatCount(state.usageSummary.reasoningTokens)}</span>
                  </div>
                </article>

                {usageModels.length > 0 ? (
                  <div className="usage-model-list">
                    {usageModels.slice(0, 5).map((item) => (
                      <article className="usage-model-row" key={item.model}>
                        <div className="usage-model-copy">
                          <strong>{item.model}</strong>
                          <span>
                            {formatCount(item.requests)} 请求 · 成功 {formatCount(item.successCount)}
                            {' · '}失败 {formatCount(item.failureCount)}
                          </span>
                        </div>
                        <div className="usage-model-metrics">
                          <span>总 {formatCount(item.totalTokens)}</span>
                          <span>净 {formatCount(item.netTokens)}</span>
                          <span>缓存 {formatCount(item.cachedTokens)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="quota-empty">暂无模型级 token 明细。</div>
                )}
              </div>
            )}
          </section>
        </section>

        <section className="section-card">
          <div className="section-head">
            <div>
              <h2>供应商授权</h2>
              <p>点 + 跳转授权网页，或直接导入现成认证文件。</p>
            </div>
          </div>
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
                <article
                  className={`supplier-card theme-${supplier.theme}`}
                  key={supplier.id}
                >
                  <div className="supplier-head">
                    <div>
                      <strong>{supplier.label}</strong>
                      <span>{supplier.description}</span>
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

  function renderProviderModelEditor(kind: Exclude<ProviderEditorKind, 'ampcode'>, modelsText: string) {
    const entries = toEditableModelEntries(modelsText)
    const selectedCount = discoveredModels.filter((modelName) => selectedDiscoveredModels[modelName]).length

    const updateEntries = (updater: (entries: EditableModelEntry[]) => EditableModelEntry[]) => {
      setProviderEditor((current) => {
        if (!current || current.kind === 'ampcode' || current.kind !== kind) {
          return current
        }

        const nextEntries = updater(toEditableModelEntries(current.modelsText))

        return {
          ...current,
          modelsText: editableEntriesToModelsText(nextEntries),
        }
      })
    }

    return (
      <div className="provider-model-editor">
        <div className="provider-model-head">
          <strong>模型列表（name / alias）</strong>
          <div className="mini-actions">
            <button
              className="ghost-button"
              onClick={() => updateEntries((current) => [...current, { id: createModelEntryId(), name: '', alias: '' }])}
              type="button"
            >
              添加模型
            </button>
            <button
              className="ghost-button"
              disabled={busyAction === `fetch-provider-models-${kind}`}
              onClick={() => {
                void fetchModelsForProviderEditor()
              }}
              type="button"
            >
              <Download size={16} />
              从 /models 获取
            </button>
          </div>
        </div>
        <span className="input-help">示例：gpt-4o-mini 或 moonshotai/kimi-k2:free, kimi-k2</span>
        <div className="provider-model-list">
          {entries.map((entry) => (
            <div className="provider-model-row" key={entry.id}>
              <input
                className="field-input"
                onChange={(event) =>
                  updateEntries((current) =>
                    current.map((item) =>
                      item.id === entry.id ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
                placeholder="模型名称，例如 claude-3-5-sonnet-20241022"
                value={entry.name}
              />
              <span>→</span>
              <input
                className="field-input"
                onChange={(event) =>
                  updateEntries((current) =>
                    current.map((item) =>
                      item.id === entry.id ? { ...item, alias: event.target.value } : item,
                    ),
                  )
                }
                placeholder="模型别名（可选）"
                value={entry.alias}
              />
              <button
                className="icon-button"
                onClick={() =>
                  updateEntries((current) =>
                    current.length <= 1
                      ? [{ ...current[0], name: '', alias: '' }]
                      : current.filter((item) => item.id !== entry.id),
                  )
                }
                type="button"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {discoveredModels.length > 0 ? (
          <div className="provider-model-picker">
            <div className="provider-model-picker-head">
              <span>已拉取 {discoveredModels.length} 个模型</span>
              <button className="ghost-button" onClick={applySelectedDiscoveredModels} type="button">
                添加勾选模型（{selectedCount}）
              </button>
            </div>
            <div className="provider-model-picker-list">
              {discoveredModels.map((modelName) => (
                <label className="provider-model-picker-item" key={modelName}>
                  <input
                    checked={Boolean(selectedDiscoveredModels[modelName])}
                    onChange={(event) => toggleDiscoveredModel(modelName, event.target.checked)}
                    type="checkbox"
                  />
                  <span>{modelName}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    )
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
          {renderProviderModelEditor('openai-compatibility', providerEditor.modelsText)}
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
        {renderProviderModelEditor(providerEditor.kind, providerEditor.modelsText)}
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

  function renderUsagePage() {
    const summary = usageSummary
    const usageModels = summary?.topModels.filter((item) => item.requests > 0 || item.totalTokens > 0) ?? []
    const requestTrend = summary?.requestsByDay ?? []
    const tokenTrend = summary?.tokensByDay ?? []
    const requestMax = Math.max(...requestTrend.map((item) => item.value), 1)
    const tokenMax = Math.max(...tokenTrend.map((item) => item.value), 1)
    const cacheHitRate = summary && summary.inputTokens > 0 ? (summary.cachedTokens / summary.inputTokens) * 100 : 0

    function renderTrendCard(
      title: string,
      points: UsagePoint[],
      maxValue: number,
      emptyText: string,
    ) {
      return (
        <article className="usage-trend-card">
          <div className="quota-head">
            <strong>{title}</strong>
            <span>{points.length} 个时间桶</span>
          </div>
          {points.length === 0 ? (
            <div className="quota-empty">{emptyText}</div>
          ) : (
            <div className="usage-trend-chart">
              {points.map((point) => (
                <div
                  className="usage-trend-column"
                  key={point.label}
                  title={`${point.label} · ${formatCount(point.value)}`}
                >
                  <span className="usage-trend-value">{formatCompactCount(point.value)}</span>
                  <span className="usage-trend-bar-track">
                    <span
                      className="usage-trend-bar-fill"
                      style={{
                        height: `${Math.max(8, Math.min(100, (point.value / maxValue) * 100))}%`,
                      }}
                    />
                  </span>
                  <span className="usage-trend-label">{point.label}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      )
    }

    return (
      <div className="page-stack">
        <section className="section-card stack-column">
          <div className="section-head">
            <div>
              <h2>查询范围</h2>
              <p>按时间周期或指定时间段统计缓存命中、净消耗和计费输入。</p>
            </div>
            <button
              className="ghost-button"
              disabled={usageLoading || !state.proxyStatus.running}
              onClick={() => void fetchUsageSummaryForRange(usageQuery, true)}
              type="button"
            >
              <RefreshCcw size={16} />
              刷新统计
            </button>
          </div>

          <div className="usage-filter-panel">
            <div className="usage-preset-list">
              {[
                ['24h', '近 24 小时'],
                ['7d', '近 7 天'],
                ['30d', '近 30 天'],
                ['all', '全部时间'],
                ['custom', '自定义'],
              ].map(([value, label]) => (
                <button
                  className={`usage-preset-chip ${usagePreset === value ? 'active' : ''}`}
                  key={value}
                  onClick={() => applyUsagePreset(value as UsageSummaryQueryPreset)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            {usagePreset === 'custom' ? (
              <div className="form-grid two-columns usage-filter-grid">
                <TextField
                  help="留空表示不限制起始时间。"
                  label="开始时间"
                  onChange={(value) =>
                    setUsageCustomRangeDraft((current) => ({ ...current, startAt: value }))
                  }
                  type="datetime-local"
                  value={usageCustomRangeDraft.startAt}
                />
                <TextField
                  help="留空表示统计到最新请求。"
                  label="结束时间"
                  onChange={(value) =>
                    setUsageCustomRangeDraft((current) => ({ ...current, endAt: value }))
                  }
                  type="datetime-local"
                  value={usageCustomRangeDraft.endAt}
                />
              </div>
            ) : null}

            <div className="usage-range-meta">
              <span>当前范围：{summary?.rangeLabel ?? '未查询'}</span>
              <span>时间窗口：{getUsageQueryRangeText(summary)}</span>
              <span>更新时间：{summary ? formatTime(summary.lastUpdatedAt) : '未查询'}</span>
              {usagePreset === 'custom' ? (
                <button className="primary-button" onClick={applyCustomUsageRange} type="button">
                  应用时间段
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {usageLoading && !summary ? (
          <section className="section-card">
            <div className="quota-empty">正在读取用量统计...</div>
          </section>
        ) : summary?.error ? (
          <section className="section-card">
            <div className="quota-empty error">{summary.error}</div>
          </section>
        ) : summary ? (
          <>
            <section className="metrics-grid usage-metrics-grid">
              <article className="metric-card metric-card-highlight">
                <span className="metric-label">净消耗 Tokens</span>
                <strong>{formatCount(summary.netTokens)}</strong>
                <span className="metric-help">
                  总消耗 {formatCount(summary.totalTokens)} · 缓存命中 {formatCount(summary.cachedTokens)}
                </span>
                <div className="metric-pairs">
                  <span>计费输入 {formatCount(summary.billableInputTokens)}</span>
                  <span>Reasoning {formatCount(summary.reasoningTokens)}</span>
                </div>
              </article>
              <article className="metric-card">
                <span className="metric-label">请求数</span>
                <strong>{formatCount(summary.totalRequests)}</strong>
                <span className="metric-help">
                  成功 {formatCount(summary.successCount)} · 失败 {formatCount(summary.failureCount)}
                </span>
                <div className="metric-pairs">
                  <span>成功率 {formatRate(summary.successCount, summary.totalRequests)}</span>
                  <span>缓存命中率 {formatPercent(cacheHitRate)}</span>
                </div>
              </article>
              <article className="metric-card">
                <span className="metric-label">输入 / 输出</span>
                <strong>{formatCount(summary.inputTokens)}</strong>
                <span className="metric-help">输入 Tokens</span>
                <div className="metric-pairs">
                  <span>输出 {formatCount(summary.outputTokens)}</span>
                  <span>缓存 {formatCount(summary.cachedTokens)}</span>
                </div>
              </article>
              <article className="metric-card">
                <span className="metric-label">统计口径</span>
                <strong>{summary.usedDetailRange ? '明细聚合' : '汇总聚合'}</strong>
                <span className="metric-help">{summary.rangeLabel}</span>
                <div className="metric-pairs">
                  <span>时间桶 {summary.rangeGranularity === 'hour' ? '按小时' : '按天'}</span>
                  <span>更新时间 {formatTime(summary.lastUpdatedAt)}</span>
                </div>
              </article>
            </section>

            <section className="usage-page-grid">
              <section className="section-card stack-column">
                <div className="section-head">
                  <div>
                    <h2>趋势</h2>
                    <p>请求量和净消耗按时间桶展开，便于核对缓存命中后的真实成本。</p>
                  </div>
                </div>

                <div className="usage-trend-grid">
                  {renderTrendCard('请求趋势', requestTrend, requestMax, '所选范围内暂无请求记录。')}
                  {renderTrendCard('净消耗趋势', tokenTrend, tokenMax, '所选范围内暂无 Token 明细。')}
                </div>
              </section>

              <section className="section-card stack-column">
                <div className="section-head">
                  <div>
                    <h2>模型排行</h2>
                    <p>优先按净消耗排序，同时展示总消耗、缓存命中和净额。</p>
                  </div>
                </div>

                {usageModels.length === 0 ? (
                  <div className="quota-empty">所选范围内暂无模型统计。</div>
                ) : (
                  <div className="usage-model-list">
                    {usageModels.map((item) => (
                      <article className="usage-model-row usage-model-row-detailed" key={item.model}>
                        <div className="usage-model-copy">
                          <strong>{item.model}</strong>
                          <span>
                            {formatCount(item.requests)} 请求 · 成功 {formatCount(item.successCount)} · 失败{' '}
                            {formatCount(item.failureCount)}
                          </span>
                        </div>
                        <div className="usage-model-metrics usage-model-metrics-detailed">
                          <span>总 {formatCount(item.totalTokens)}</span>
                          <span>净 {formatCount(item.netTokens)}</span>
                          <span>缓存 {formatCount(item.cachedTokens)}</span>
                          <span>计费输入 {formatCount(item.billableInputTokens)}</span>
                          <span>命中率 {formatRate(item.cachedTokens, item.inputTokens)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </section>
          </>
        ) : (
          <section className="section-card">
            <div className="quota-empty">
              {state.proxyStatus.running ? '正在等待首批用量数据。' : '暂无历史用量统计。'}
            </div>
          </section>
        )}
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
              const usedPercent = getQuotaUsedPercent(item)

              return (
                <article className="auth-quota-row" key={item.id}>
                  <div className="auth-quota-copy">
                    <span>{formatDashboardQuotaLabel(item)}</span>
                    <strong>{usedPercent === null ? '未提供' : `已用 ${formatPercent(usedPercent)}`}</strong>
                  </div>
                  <div className="quota-bar auth-quota-bar">
                    <span
                      className="quota-bar-fill"
                      style={{ width: `${usedPercent ?? 0}%` }}
                    />
                  </div>
                  <div className="auth-quota-meta">
                    <span>{item.amountText ?? '暂无额度数值'}</span>
                    <span>{item.resetText ?? '暂无重置时间'}</span>
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}

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
    return (
      <div className="page-stack">
        <section className="section-card">
          <div className="section-head">
            <div>
              <h2>认证文件</h2>
              <p>压缩成多文件视图，只保留请求、身份和额度摘要。</p>
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
          <div className="auth-file-grid">
            {state.authFiles.length === 0 ? (
              <div className="empty-panel">
                <strong>当前目录还没有认证文件</strong>
                <span>程序只会读取 `auth-files` 子目录里的 JSON 认证文件。</span>
              </div>
            ) : (
              state.authFiles.map((file) => (
                <article className="auth-card auth-card-compact" key={file.name}>
                  {(() => {
                    const quotaState = quotaStateByFile[file.name]
                    const quotaSummary = quotaState?.summary ?? null
                    const compactDetails = getCompactAuthDetails(file)
                    const planLabel = formatPlanLabel(quotaSummary?.planType ?? file.planType)

                    return (
                      <>
                        <div className="auth-head">
                          <div>
                            <strong>{file.displayName}</strong>
                            <span>
                              {quotaSummary?.providerLabel ?? file.provider} · {file.enabled ? '启用' : '停用'} · {formatBytes(file.size)}
                            </span>
                          </div>
                          <div className="mini-actions auth-card-tools">
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
                              className="icon-button"
                              onClick={() =>
                                void runStateAction(
                                  `toggle-auth-${file.name}`,
                                  () => window.cliproxy.toggleAuthFile(file.name),
                                  '认证文件状态已切换',
                                )
                              }
                              type="button"
                            >
                              {file.enabled ? <Square size={16} /> : <Play size={16} />}
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

                        <div className="tag-row">
                          <span className="tag-pill">{file.type}</span>
                          {planLabel ? <span className="tag-pill">{planLabel}</span> : null}
                          {file.authIndex ? <span className="tag-pill">索引 {file.authIndex}</span> : null}
                          {file.status ? <span className="tag-pill">{file.status}</span> : null}
                          {file.runtimeOnly ? <span className="tag-pill">运行时</span> : null}
                          {file.unavailable ? <span className="tag-pill">不可用</span> : null}
                        </div>

                        <div className="auth-metric-grid">
                          <div className="auth-metric-card">
                            <span>请求</span>
                            <strong>{formatCount(file.totalRequests)}</strong>
                          </div>
                          <div className="auth-metric-card">
                            <span>成功</span>
                            <strong>{formatCount(file.successCount)}</strong>
                          </div>
                          <div className="auth-metric-card">
                            <span>失败</span>
                            <strong>{formatCount(file.failureCount)}</strong>
                          </div>
                          <div className="auth-metric-card">
                            <span>最后使用</span>
                            <strong>{formatTime(file.lastUsedAt)}</strong>
                          </div>
                        </div>

                        {compactDetails.length > 0 ? (
                          <div className="auth-detail-list">
                            {compactDetails.map((item) => (
                              <div className="auth-detail-chip" key={`${file.name}-${item.label}-${item.value}`}>
                                <span>{item.label}</span>
                                <strong>{item.value}</strong>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {file.statusMessage ? <div className="inline-note">{file.statusMessage}</div> : null}

                        {canFetchQuota(file) ? (
                          renderQuotaSummary(file.name)
                        ) : (
                          <div className="quota-empty compact">当前类型暂不支持额度查询。</div>
                        )}

                        <div className="auth-card-foot">
                          <span>修改 {formatTime(file.modifiedAt)}</span>
                          <span className="auth-card-path">{file.path}</span>
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
              <p>同路径保存 `proxy-config.yaml`、`gui-state.json`、`cli-proxy-api.exe`，认证文件单独保存在 `auth-files` 子目录。</p>
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
              help="失败请求的重试次数。"
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
              help="重试间隔上限，单位秒。"
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
              help="GUI 保存的默认推理强度偏好。"
              label="Reasoning Effort"
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({
                  ...current,
                  reasoningEffort: value as SaveKnownSettingsInput['reasoningEffort'],
                }))
              }}
              options={[
                { label: 'minimal', value: 'minimal' },
                { label: 'low', value: 'low' },
                { label: 'medium', value: 'medium' },
                { label: 'high', value: 'high' },
                { label: 'xhigh', value: 'xhigh' },
              ]}
              value={settingsDraft.reasoningEffort}
            />
            <SelectField
              help="为 Claude 思考预算生成默认规则。"
              label="Thinking Budget"
              onChange={(value) => {
                setSettingsDirty(true)
                setSettingsDraft((current) => ({
                  ...current,
                  thinkingBudgetMode: value as SaveKnownSettingsInput['thinkingBudgetMode'],
                }))
              }}
              options={[
                { label: 'low', value: 'low' },
                { label: 'medium', value: 'medium' },
                { label: 'high', value: 'high' },
                { label: 'custom', value: 'custom' },
              ]}
              value={settingsDraft.thinkingBudgetMode}
            />
            {settingsDraft.thinkingBudgetMode === 'custom' ? (
              <TextField
                help="自定义 thinking.budget_tokens。"
                label="Custom Budget"
                min={1024}
                onChange={(value) => {
                  setSettingsDirty(true)
                  setSettingsDraft((current) => ({
                    ...current,
                    thinkingBudgetCustom: Number.parseInt(value || '1024', 10) || 1024,
                  }))
                }}
                type="number"
                value={settingsDraft.thinkingBudgetCustom}
              />
            ) : null}
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

    if (currentPage === 'usage') {
      return renderUsagePage()
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
