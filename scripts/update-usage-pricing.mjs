import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const GENERATED_DIR = path.resolve(process.cwd(), 'src/generated')
const OUTPUT_JSON_PATH = path.join(GENERATED_DIR, 'usagePricingDefaults.json')
const OUTPUT_TS_PATH = path.join(GENERATED_DIR, 'usagePricingDefaults.ts')

const DEFAULT_CURRENCY = '¤'
const OPENAI_PRICING_URL = 'https://developers.openai.com/api/docs/pricing'
const GEMINI_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing?hl=en'

const REFERENCE_LINKS = [
  { label: 'OpenAI API Pricing', url: 'https://openai.com/api/pricing/' },
  { label: 'Anthropic API Pricing', url: 'https://www.anthropic.com/pricing#api' },
  { label: 'Gemini API Pricing', url: 'https://ai.google.dev/gemini-api/docs/pricing' },
  { label: 'Moonshot Kimi Pricing', url: 'https://platform.moonshot.cn/docs/pricing/chat' },
  {
    label: 'Alibaba Cloud Model Studio Pricing',
    url: 'https://help.aliyun.com/zh/model-studio/product-overview/billing-of-model-studio',
  },
] 

const FALLBACK_RULES = [
  {
    id: 'gpt-5.4',
    enabled: true,
    name: 'GPT-5.4',
    modelPattern: 'gpt-5.4*',
    reasoningEffortPattern: '*',
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 15,
    cacheReadPricePerMillion: 0.25,
    cacheWritePricePerMillion: 0,
    multiplier: 1,
    sourceUrl: 'https://openai.com/api/pricing/',
    notes: '默认按 OpenAI 官方 API 价格，可手动调整。',
  },
  {
    id: 'gpt-5.2',
    enabled: true,
    name: 'GPT-5.2 / GPT-5.2 Codex',
    modelPattern: 'gpt-5.2*,gpt-5.2-codex*',
    reasoningEffortPattern: '*',
    inputPricePerMillion: 1.75,
    outputPricePerMillion: 14,
    cacheReadPricePerMillion: 0.175,
    cacheWritePricePerMillion: 0,
    multiplier: 1,
    sourceUrl: 'https://platform.openai.com/docs/pricing',
    notes: '默认按 OpenAI Platform Pricing 文档，可手动调整。',
  },
  {
    id: 'gpt-5',
    enabled: true,
    name: 'GPT-5 / GPT-5.1 / Codex',
    modelPattern: 'gpt-5*,gpt-5.1*,codex*',
    reasoningEffortPattern: '*',
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10,
    cacheReadPricePerMillion: 0.125,
    cacheWritePricePerMillion: 0,
    multiplier: 1,
    sourceUrl: 'https://platform.openai.com/docs/pricing',
    notes: '默认按 OpenAI Platform Pricing 文档，可手动调整。',
  },
  {
    id: 'gpt-4.1',
    enabled: true,
    name: 'GPT-4.1',
    modelPattern: 'gpt-4.1*',
    reasoningEffortPattern: '*',
    inputPricePerMillion: 2,
    outputPricePerMillion: 8,
    cacheReadPricePerMillion: 0.5,
    cacheWritePricePerMillion: 0,
    multiplier: 1,
    sourceUrl: 'https://openai.com/api/pricing/',
    notes: '默认按 OpenAI 官方 API 价格，可手动调整。',
  },
  {
    id: 'gpt-4o',
    enabled: true,
    name: 'GPT-4o',
    modelPattern: 'gpt-4o*',
    reasoningEffortPattern: '*',
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10,
    cacheReadPricePerMillion: 1.25,
    cacheWritePricePerMillion: 0,
    multiplier: 1,
    sourceUrl: 'https://openai.com/api/pricing/',
    notes: '默认按 OpenAI 官方 API 价格，可手动调整。',
  },
]

const PROVIDER_SPECS = [
  {
    key: 'openai',
    label: 'OpenAI',
    url: OPENAI_PRICING_URL,
    parse: extractOpenAiRules,
  },
  {
    key: 'gemini',
    label: 'Gemini',
    url: GEMINI_PRICING_URL,
    parse: extractGeminiRules,
  },
]

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
}

function stripTags(value) {
  return decodeHtml(String(value))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseNumberish(value) {
  const normalized = stripTags(String(value)).replace(/,/g, '').trim()

  if (!normalized || normalized === '-' || normalized.toLowerCase() === 'null') {
    return 0
  }

  if (/free of charge|not available|free/i.test(normalized)) {
    return 0
  }

  const match = normalized.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function extractMoneyList(value) {
  const matches = stripTags(String(value))
    .replace(/,/g, '')
    .match(/\$ ?(\d+(?:\.\d+)?)/g)

  if (!matches) {
    return []
  }

  return matches
    .map((entry) => Number(entry.replace(/[^0-9.]/g, '')))
    .filter((entry) => Number.isFinite(entry))
}

function normalizeModelId(value) {
  return stripTags(value)
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function toDisplayName(modelId) {
  return modelId
    .split('-')
    .map((part, index) => {
      if (index === 0 && part === 'gpt') {
        return 'GPT'
      }

      if (index === 0 && part === 'chatgpt') {
        return 'ChatGPT'
      }

      if (index === 0 && part === 'gemini') {
        return 'Gemini'
      }

      if (index === 0 && part === 'codex') {
        return 'Codex'
      }

      if (index === 0 && /^o\d/.test(part)) {
        return part.toUpperCase()
      }

      if (part === 'mini') {
        return 'Mini'
      }

      if (part === 'nano') {
        return 'Nano'
      }

      if (part === 'pro') {
        return 'Pro'
      }

      if (part === 'preview') {
        return 'Preview'
      }

      if (part === 'latest') {
        return 'Latest'
      }

      return part
    })
    .join('-')
}

function classifyProviderByRuleId(ruleId) {
  if (/^gemini-/i.test(ruleId)) {
    return 'gemini'
  }

  if (/^(claude-|anthropic-)/i.test(ruleId)) {
    return 'anthropic'
  }

  if (/^(kimi-|moonshot-)/i.test(ruleId)) {
    return 'moonshot'
  }

  if (/^qwen-/i.test(ruleId)) {
    return 'alibaba'
  }

  if (/^(gpt-|chatgpt-|o\d|codex|computer-use-preview)/i.test(ruleId)) {
    return 'openai'
  }

  return 'unknown'
}

function providerOrder(ruleId) {
  const providerKey = classifyProviderByRuleId(ruleId)
  const order = {
    openai: 0,
    anthropic: 1,
    gemini: 2,
    moonshot: 3,
    alibaba: 4,
    unknown: 5,
  }

  return order[providerKey] ?? order.unknown
}

function finalizeRules(rules) {
  const seen = new Set()
  const deduped = []

  for (const rule of rules) {
    if (seen.has(rule.id)) {
      continue
    }

    seen.add(rule.id)
    deduped.push(rule)
  }

  return deduped.sort((left, right) => {
    const providerDelta = providerOrder(left.id) - providerOrder(right.id)

    if (providerDelta !== 0) {
      return providerDelta
    }

    const specificityDelta = right.modelPattern.length - left.modelPattern.length

    if (specificityDelta !== 0) {
      return specificityDelta
    }

    return left.name.localeCompare(right.name)
  })
}

function buildRule({
  cacheReadPricePerMillion = 0,
  cacheWritePricePerMillion = 0,
  id,
  inputPricePerMillion,
  name,
  notes,
  outputPricePerMillion,
  sourceUrl,
}) {
  return {
    id,
    enabled: true,
    name,
    modelPattern: `${id}*`,
    reasoningEffortPattern: '*',
    inputPricePerMillion,
    outputPricePerMillion,
    cacheReadPricePerMillion,
    cacheWritePricePerMillion,
    multiplier: 1,
    sourceUrl,
    notes,
  }
}

function shouldIncludeOpenAiModel(modelId) {
  if (!/^(gpt-5|gpt-4\.1|gpt-4o|chatgpt-4o-latest|o1|o3|o4|codex|computer-use-preview)/i.test(modelId)) {
    return false
  }

  return !/(embedding|moderation|transcribe|audio|speech|image|whisper|tts|search)/i.test(modelId)
}

function extractOpenAiRules(html) {
  const decoded = decodeHtml(html)
  const rowPattern = /\[\[0,"([^"]+)"\],\[0,([^,\]]+)\],\[0,([^,\]]+)\],\[0,([^\]]+)\]\]/g
  const rules = []
  const seen = new Set()

  for (const match of decoded.matchAll(rowPattern)) {
    const modelId = normalizeModelId(match[1])

    if (!modelId || seen.has(modelId) || !shouldIncludeOpenAiModel(modelId)) {
      continue
    }

    const inputPricePerMillion = parseNumberish(match[2])
    const cacheReadPricePerMillion = parseNumberish(match[3])
    const outputPricePerMillion = parseNumberish(match[4])

    if (
      inputPricePerMillion === null ||
      outputPricePerMillion === null ||
      !Number.isFinite(inputPricePerMillion) ||
      !Number.isFinite(outputPricePerMillion)
    ) {
      continue
    }

    rules.push(
      buildRule({
        id: modelId,
        name: toDisplayName(modelId),
        inputPricePerMillion,
        outputPricePerMillion,
        cacheReadPricePerMillion:
          cacheReadPricePerMillion !== null && Number.isFinite(cacheReadPricePerMillion)
            ? cacheReadPricePerMillion
            : 0,
        sourceUrl: OPENAI_PRICING_URL,
        notes: '默认按 OpenAI 官方价格页同步，可手动调整。',
      }),
    )
    seen.add(modelId)
  }

  return finalizeRules(rules)
}

function shouldIncludeGeminiModel(modelId) {
  if (!/^gemini-/i.test(modelId)) {
    return false
  }

  return !/(embedding|image|audio|video|tts|veo|lyria|robotics|computer-use|deep-research|live)/i.test(modelId)
}

function extractPaidTierTable(sectionHtml) {
  const standardTableMatch = sectionHtml.match(
    /<section><h3[^>]*>\s*Standard\s*<\/h3><table class="pricing-table">([\s\S]*?)<\/table><\/section>/i,
  )

  if (standardTableMatch?.[1]) {
    return standardTableMatch[1]
  }

  const firstTableMatch = sectionHtml.match(/<table class="pricing-table">([\s\S]*?)<\/table>/i)
  return firstTableMatch?.[1] ?? null
}

function extractPaidTierCell(tableHtml, label) {
  const rows = tableHtml.match(/<tr>[\s\S]*?<\/tr>/gi) ?? []

  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((entry) => entry[1])

    if (cells.length < 3) {
      continue
    }

    if (stripTags(cells[0]).toLowerCase() !== label.toLowerCase()) {
      continue
    }

    return cells[2] ?? cells.at(-1) ?? null
  }

  return null
}

function extractGeminiRules(html) {
  const sectionPattern = /<h2[^>]+id="(gemini-[^"]+)"[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2[^>]+id="|$)/gi
  const rules = []
  const seen = new Set()

  for (const match of html.matchAll(sectionPattern)) {
    const modelId = normalizeModelId(match[1])

    if (!modelId || seen.has(modelId) || !shouldIncludeGeminiModel(modelId)) {
      continue
    }

    const tableHtml = extractPaidTierTable(match[3])

    if (!tableHtml) {
      continue
    }

    const inputCell = extractPaidTierCell(tableHtml, 'Input price')
    const outputCell = extractPaidTierCell(tableHtml, 'Output price (including thinking tokens)')
    const cacheCell =
      extractPaidTierCell(tableHtml, 'Context caching price') ??
      extractPaidTierCell(tableHtml, 'Cache price')

    if (!inputCell || !outputCell) {
      continue
    }

    const inputPrices = extractMoneyList(inputCell)
    const outputPrices = extractMoneyList(outputCell)
    const cachePrices = cacheCell ? extractMoneyList(cacheCell) : []

    if (inputPrices.length === 0 || outputPrices.length === 0) {
      continue
    }

    const notes = ['默认按 Gemini 官方价格页 Standard Paid Tier 首档价格同步，可手动调整。']

    if (inputPrices.length > 1 || outputPrices.length > 1) {
      notes.push('官方为分档计费，这里默认取首档价格。')
    }

    if (cachePrices.length > 1) {
      notes.push('缓存价格未包含 storage 小时费，仅取首档 token 单价。')
    }

    rules.push(
      buildRule({
        id: modelId,
        name: stripTags(match[2]).replace(/\s+/g, ' ').trim() || toDisplayName(modelId),
        inputPricePerMillion: inputPrices[0],
        outputPricePerMillion: outputPrices[0],
        cacheReadPricePerMillion: cachePrices[0] ?? 0,
        sourceUrl: GEMINI_PRICING_URL,
        notes: notes.join(' '),
      }),
    )
    seen.add(modelId)
  }

  return finalizeRules(rules)
}

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return response.text()
  } catch (fetchError) {
    const { stdout } = await execFileAsync('curl', ['-L', '--fail', '--silent', '--show-error', '--max-time', '30', url])

    if (!stdout.trim()) {
      throw fetchError
    }

    return stdout
  }
}

function mergeProviderRules(baseRules, providerKey, nextRules) {
  return [
    ...baseRules.filter((rule) => classifyProviderByRuleId(rule.id) !== providerKey),
    ...nextRules,
  ]
}

function buildFallbackPayload() {
  return {
    currency: DEFAULT_CURRENCY,
    generatedAt: null,
    referenceLinks: REFERENCE_LINKS,
    warnings: [],
    rules: [...FALLBACK_RULES],
  }
}

async function readPreviousPayload() {
  try {
    const raw = await fs.readFile(OUTPUT_JSON_PATH, 'utf8')
    const parsed = JSON.parse(raw)

    if (!parsed || !Array.isArray(parsed.rules)) {
      return null
    }

    return {
      currency: typeof parsed.currency === 'string' && parsed.currency.trim() ? parsed.currency : DEFAULT_CURRENCY,
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : null,
      referenceLinks: Array.isArray(parsed.referenceLinks) ? parsed.referenceLinks : REFERENCE_LINKS,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item) => typeof item === 'string') : [],
      rules: parsed.rules,
    }
  } catch {
    return null
  }
}

function buildTypeScriptModule(payload) {
  const serialized = JSON.stringify(payload, null, 2)

  return `import type { UsagePricingConfig, UsagePricingSourceLink } from '../../shared/types'

type GeneratedUsagePricingPayload = {
  currency: string
  generatedAt: string | null
  referenceLinks: UsagePricingSourceLink[]
  rules: UsagePricingConfig['rules']
  warnings: string[]
}

const generatedUsagePricingPayload: GeneratedUsagePricingPayload = ${serialized}

export const USAGE_PRICING_GENERATED_AT = generatedUsagePricingPayload.generatedAt
export const USAGE_PRICING_REFERENCE_LINKS = generatedUsagePricingPayload.referenceLinks
export const USAGE_PRICING_SYNC_WARNINGS = generatedUsagePricingPayload.warnings
export const USAGE_PRICING_DEFAULTS: UsagePricingConfig = {
  currency: generatedUsagePricingPayload.currency,
  defaultsUpdatedAt: generatedUsagePricingPayload.generatedAt,
  removedRuleIds: [],
  rules: generatedUsagePricingPayload.rules,
  syncWarnings: generatedUsagePricingPayload.warnings,
}
`
}

async function main() {
  const previousPayload = await readPreviousPayload()
  const seedPayload = previousPayload ?? buildFallbackPayload()
  let rules = [...seedPayload.rules]
  const warnings = []

  for (const provider of PROVIDER_SPECS) {
    try {
      const html = await fetchText(provider.url)
      const nextRules = provider.parse(html)

      if (nextRules.length === 0) {
        throw new Error('No pricing rows parsed')
      }

      rules = mergeProviderRules(rules, provider.key, nextRules)
      console.log(`[usage-pricing] Synced ${provider.label}: ${nextRules.length} rules`)
    } catch (error) {
      const hasExistingRules = rules.some((rule) => classifyProviderByRuleId(rule.id) === provider.key)
      const message = `${
        provider.label
      } 价格同步失败（${error instanceof Error ? error.message : String(error)}），已${hasExistingRules ? '保留上次结果' : '回退到兜底规则'}。`
      warnings.push(message)
      console.warn(`[usage-pricing] ${message}`)
    }
  }

  const payload = {
    currency: DEFAULT_CURRENCY,
    generatedAt: new Date().toISOString(),
    referenceLinks: REFERENCE_LINKS,
    rules: finalizeRules(rules),
    warnings,
  }

  await fs.mkdir(GENERATED_DIR, { recursive: true })
  await fs.writeFile(OUTPUT_JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`)
  await fs.writeFile(OUTPUT_TS_PATH, `${buildTypeScriptModule(payload)}\n`)
  console.log(`[usage-pricing] Wrote ${OUTPUT_TS_PATH}`)
}

main().catch((error) => {
  console.error(`[usage-pricing] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
