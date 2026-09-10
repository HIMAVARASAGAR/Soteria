import { z } from 'zod/v4'
import * as fs from 'fs'
import * as path from 'path'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export type SecretFinding = {
  ruleId: string
  secretType: string
  file: string
  line: number
  maskedSecret: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'
  entropy?: number
  contextSnippet: string
}

export type SecretScanReport = {
  filesScanned: number
  secretsFound: number
  findings: SecretFinding[]
  countsByType: Record<string, number>
}

export function calculateShannonEntropy(str: string): number {
  const len = str.length
  if (len === 0) return 0
  const freqs: Record<string, number> = {}
  for (let i = 0; i < len; i++) {
    const c = str[i]
    freqs[c] = (freqs[c] || 0) + 1
  }
  let entropy = 0
  for (const char in freqs) {
    const p = freqs[char] / len
    entropy -= p * Math.log2(p)
  }
  return Number(entropy.toFixed(2))
}

export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '****'
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`
}

interface SecretRule {
  id: string
  name: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'
  regex: RegExp
  requireEntropy?: number
}

export const SECRET_RULES: SecretRule[] = [
  {
    id: 'aws-access-key',
    name: 'AWS Access Key ID',
    severity: 'CRITICAL',
    regex: /\b(AKIA[0-9A-Z]{16})\b/g,
  },
  {
    id: 'github-pat',
    name: 'GitHub Personal Access Token',
    severity: 'CRITICAL',
    regex: /\b(ghp_[A-Za-z0-9_]{36}|gho_[A-Za-z0-9_]{36}|github_pat_[A-Za-z0-9_]{60,82})\b/g,
  },
  {
    id: 'gcp-api-key',
    name: 'Google Cloud API Key',
    severity: 'CRITICAL',
    regex: /\b(AIza[0-9A-Za-z\-_]{35})\b/g,
  },
  {
    id: 'openai-api-key',
    name: 'OpenAI API Key',
    severity: 'CRITICAL',
    regex: /\b(sk-[a-zA-Z0-9]{32,}|sk-proj-[a-zA-Z0-9_-]{40,})\b/g,
  },
  {
    id: 'anthropic-api-key',
    name: 'Anthropic API Key',
    severity: 'CRITICAL',
    regex: /\b(sk-ant-[a-zA-Z0-9_\-]{40,})\b/g,
  },
  {
    id: 'stripe-secret-key',
    name: 'Stripe Secret Key',
    severity: 'CRITICAL',
    regex: /\b((?:sk|rk)_live_[0-9a-zA-Z]{24,34})\b/g,
  },
  {
    id: 'slack-token',
    name: 'Slack Token / Webhook',
    severity: 'HIGH',
    regex: /\b(xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}|https:\/\/hooks\.slack\.com\/services\/T[0-9A-Z]+\/B[0-9A-Z]+\/[0-9A-Za-z]+)\b/g,
  },
  {
    id: 'private-key',
    name: 'Private Encryption Key',
    severity: 'CRITICAL',
    regex: /(-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP)?\s*PRIVATE KEY-----)/g,
  },
  {
    id: 'database-connection-string',
    name: 'Database URI with Password',
    severity: 'CRITICAL',
    regex: /\b((?:postgres|postgresql|mysql|mongodb|redis|amqp):\/\/[^:\s]+:([^@\s]+)@[^\s]+)\b/g,
  },
  {
    id: 'hardcoded-password',
    name: 'Hardcoded Secret Assignment',
    severity: 'HIGH',
    regex: /\b(?:password|passwd|api_secret|client_secret|auth_token)\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
    requireEntropy: 3.4,
  },
]

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.astro',
  '.turbo',
  'coverage',
  '.system_generated',
  'vendor',
])

const IGNORED_FILES = new Set([
  'bun.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'poetry.lock',
])

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
  '.wasm', '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf',
])

export function scanTextForSecrets(text: string, filePath: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  const lines = text.split('\n')

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    if (!line || line.length > 2000) continue // Skip minified lines

    for (const rule of SECRET_RULES) {
      rule.regex.lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = rule.regex.exec(line)) !== null) {
        const rawSecret = match[1] || match[0]
        if (!rawSecret) continue

        // If entropy requirement exists, calculate Shannon entropy
        let entropy: number | undefined
        if (rule.requireEntropy !== undefined) {
          entropy = calculateShannonEntropy(rawSecret)
          if (entropy < rule.requireEntropy) {
            continue
          }
        }

        // False positive suppression for common dummy strings
        const lower = rawSecret.toLowerCase()
        if (
          lower.includes('placeholder') ||
          lower.includes('example') ||
          lower.includes('your_') ||
          lower.includes('my-secret') ||
          lower === 'password' ||
          lower === '12345678'
        ) {
          continue
        }

        findings.push({
          ruleId: rule.id,
          secretType: rule.name,
          file: filePath,
          line: lineIndex + 1,
          maskedSecret: maskSecret(rawSecret),
          severity: rule.severity,
          entropy,
          contextSnippet: line.trim().slice(0, 100),
        })
      }
    }
  }

  return findings
}

export function collectFilesRecursively(dir: string, baseDir: string = dir): string[] {
  const result: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        result.push(...collectFilesRecursively(full, baseDir))
      } else if (entry.isFile()) {
        if (IGNORED_FILES.has(entry.name)) continue
        const ext = path.extname(entry.name).toLowerCase()
        if (BINARY_EXTENSIONS.has(ext)) continue

        try {
          const stats = fs.statSync(full)
          if (stats.size > 1024 * 1024) continue // Skip files > 1MB
          result.push(full)
        } catch {
          // Ignore unreadable files
        }
      }
    }
  } catch {
    // Ignore unreadable directories
  }
  return result
}

export function formatSecretReportMarkdown(report: SecretScanReport): string {
  let md = `### Secret & Credential Leak Scan Report\n\n`
  md += `**Files Scanned:** ${report.filesScanned}\n`
  md += `**Secrets Detected:** ${report.secretsFound}\n\n`

  if (report.secretsFound === 0) {
    md += `✅ No leaked credentials, private keys, or API tokens detected.\n`
    return md
  }

  md += `| Severity | Type | File:Line | Masked Secret | Preview |\n`
  md += `|:---|:---|:---|:---|:---|\n`

  for (const f of report.findings) {
    md += `| **${f.severity}** | ${f.secretType} | \`${f.file}:${f.line}\` | \`${f.maskedSecret}\` | \`${f.contextSnippet.replace(/\|/g, '\\|')}\` |\n`
  }

  return md
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    path: z
      .string()
      .optional()
      .describe('Relative or absolute path of file or directory to scan. Defaults to workspace root.'),
    minSeverity: z
      .enum(['MEDIUM', 'HIGH', 'CRITICAL'])
      .optional()
      .describe('Minimum secret severity to report. Defaults to MEDIUM.'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    filesScanned: z.number(),
    secretsFound: z.number(),
    findings: z.array(
      z.object({
        ruleId: z.string(),
        secretType: z.string(),
        file: z.string(),
        line: z.number(),
        maskedSecret: z.string(),
        severity: z.string(),
        entropy: z.number().optional(),
        contextSnippet: z.string(),
      }),
    ),
    countsByType: z.record(z.string(), z.number()),
    markdownSummary: z.string(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

import { getCwd } from '../../utils/cwd.js'

export const SecretScanTool = buildTool({
  name: 'scan_secrets',
  searchHint: 'scan leaked secrets API keys tokens credentials private keys passwords',
  description: async () =>
    'Scans files and directories for leaked credentials, API keys (AWS, GitHub, OpenAI, Anthropic, GCP, Stripe, Slack), private keys, and high-entropy secrets. Returns file locations and safely masked previews.',
  prompt: async () =>
    'Scans files and directories for leaked credentials, API keys, private keys, and high-entropy secrets.',
  maxResultSizeChars: 100_000,
  renderToolUseMessage: () => null,
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.markdownSummary,
    }
  },
  inputSchema: inputSchema(),
  outputSchema: outputSchema(),
  isConcurrencySafe: () => true,
  isReadOnly: () => true,
  isEnabled: () => true,
  async call({ path: targetPath, minSeverity }, _context) {
    const cwd = getCwd()
    const resolvedTarget = targetPath
      ? path.isAbsolute(targetPath)
        ? targetPath
        : path.join(cwd, targetPath)
      : cwd

    let filesToScan: string[] = []
    if (fs.existsSync(resolvedTarget)) {
      const stat = fs.statSync(resolvedTarget)
      if (stat.isDirectory()) {
        filesToScan = collectFilesRecursively(resolvedTarget)
      } else if (stat.isFile()) {
        filesToScan = [resolvedTarget]
      }
    }

    const allFindings: SecretFinding[] = []

    for (const file of filesToScan) {
      try {
        const content = fs.readFileSync(file, 'utf8')
        const relPath = path.relative(cwd, file)
        const findings = scanTextForSecrets(content, relPath)
        allFindings.push(...findings)
      } catch {
        // Skip unreadable files
      }
    }

    const severityOrder = { CRITICAL: 3, HIGH: 2, MEDIUM: 1 }
    const minThreshold = minSeverity ? severityOrder[minSeverity] : 1
    const filtered = allFindings.filter(f => severityOrder[f.severity] >= minThreshold)

    const countsByType: Record<string, number> = {}
    for (const f of filtered) {
      countsByType[f.secretType] = (countsByType[f.secretType] || 0) + 1
    }

    const report: SecretScanReport = {
      filesScanned: filesToScan.length,
      secretsFound: filtered.length,
      findings: filtered,
      countsByType,
    }

    const markdownSummary = formatSecretReportMarkdown(report)

    return {
      data: {
        ...report,
        markdownSummary,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
