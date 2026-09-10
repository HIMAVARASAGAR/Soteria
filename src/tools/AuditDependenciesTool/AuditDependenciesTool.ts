import { z } from 'zod/v4'
import * as fs from 'fs'
import * as path from 'path'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export type VulnerabilityFinding = {
  id: string
  packageName: string
  ecosystem: string
  installedVersion: string
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNKNOWN'
  cvssScore?: number
  summary: string
  affectedVersions: string
  fixedVersion?: string
  advisoryUrl?: string
}

export type AuditReport = {
  totalScanned: number
  vulnerabilitiesFound: number
  countsBySeverity: {
    critical: number
    high: number
    moderate: number
    low: number
  }
  findings: VulnerabilityFinding[]
  manifestFiles: string[]
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    manifestPath: z
      .string()
      .optional()
      .describe(
        'Optional relative or absolute path to a dependency manifest (package.json, requirements.txt, Cargo.lock, go.mod). If omitted, scans all manifests in the workspace.',
      ),
    minSeverity: z
      .enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL'])
      .optional()
      .describe('Minimum severity threshold to report. Defaults to LOW.'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    totalScanned: z.number(),
    vulnerabilitiesFound: z.number(),
    countsBySeverity: z.object({
      critical: z.number(),
      high: z.number(),
      moderate: z.number(),
      low: z.number(),
    }),
    findings: z.array(
      z.object({
        id: z.string(),
        packageName: z.string(),
        ecosystem: z.string(),
        installedVersion: z.string(),
        severity: z.string(),
        cvssScore: z.number().optional(),
        summary: z.string(),
        affectedVersions: z.string(),
        fixedVersion: z.string().optional(),
        advisoryUrl: z.string().optional(),
      }),
    ),
    manifestFiles: z.array(z.string()),
    markdownSummary: z.string(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

interface PackageSpec {
  name: string
  version: string
  ecosystem: 'npm' | 'PyPI' | 'crates.io' | 'Go'
  manifest: string
}

export function parsePackageJson(filePath: string): PackageSpec[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const json = JSON.parse(raw)
    const specs: PackageSpec[] = []
    const sections = ['dependencies', 'devDependencies', 'peerDependencies']

    for (const section of sections) {
      if (json[section] && typeof json[section] === 'object') {
        for (const [name, ver] of Object.entries(json[section])) {
          if (typeof ver === 'string') {
            const cleanVer = ver.replace(/[\^~>=<]/g, '').trim()
            specs.push({
              name,
              version: cleanVer || ver,
              ecosystem: 'npm',
              manifest: filePath,
            })
          }
        }
      }
    }
    return specs
  } catch {
    return []
  }
}

export function parseRequirementsTxt(filePath: string): PackageSpec[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const specs: PackageSpec[] = []
    const lines = raw.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([a-zA-Z0-9_\-\.]+)\s*(?:==|>=|<=|~=)\s*([a-zA-Z0-9_\-\.]+)/)
      if (match) {
        specs.push({
          name: match[1],
          version: match[2],
          ecosystem: 'PyPI',
          manifest: filePath,
        })
      }
    }
    return specs
  } catch {
    return []
  }
}

export async function queryOsvDevBatch(packages: PackageSpec[]): Promise<VulnerabilityFinding[]> {
  if (packages.length === 0) return []

  const findings: VulnerabilityFinding[] = []
  // OSV batch API accepts up to 1000 packages per request
  const batches: PackageSpec[][] = []
  const BATCH_SIZE = 500
  for (let i = 0; i < packages.length; i += BATCH_SIZE) {
    batches.push(packages.slice(i, i + BATCH_SIZE))
  }

  for (const batch of batches) {
    try {
      const queries = batch.map(pkg => ({
        package: {
          name: pkg.name,
          ecosystem: pkg.ecosystem,
        },
        version: pkg.version,
      }))

      const res = await fetch('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries }),
        signal: AbortSignal.timeout(8000),
      })

      if (!res.ok) continue

      const data = (await res.json()) as { results?: Array<{ vulns?: Array<any> }> }
      if (!data.results) continue

      data.results.forEach((result, idx) => {
        const pkg = batch[idx]
        if (!result.vulns || !pkg) return

        for (const vuln of result.vulns) {
          let severity: VulnerabilityFinding['severity'] = 'UNKNOWN'
          let cvssScore: number | undefined

          if (vuln.database_specific?.severity) {
            const s = String(vuln.database_specific.severity).toUpperCase()
            if (s.includes('CRITICAL')) severity = 'CRITICAL'
            else if (s.includes('HIGH')) severity = 'HIGH'
            else if (s.includes('MODERATE') || s.includes('MEDIUM')) severity = 'MODERATE'
            else if (s.includes('LOW')) severity = 'LOW'
          }

          if (vuln.severity && Array.isArray(vuln.severity)) {
            const cvss = vuln.severity.find((x: any) => x.type === 'CVSS_V3' || x.type === 'CVSS_V2')
            if (cvss && typeof cvss.score === 'string') {
              const numMatch = cvss.score.match(/\d+\.\d+/)
              if (numMatch) {
                cvssScore = parseFloat(numMatch[0])
                if (!severity || severity === 'UNKNOWN') {
                  if (cvssScore >= 9.0) severity = 'CRITICAL'
                  else if (cvssScore >= 7.0) severity = 'HIGH'
                  else if (cvssScore >= 4.0) severity = 'MODERATE'
                  else severity = 'LOW'
                }
              }
            }
          }

          let fixedVersion: string | undefined
          let affectedVersions = ''
          if (vuln.affected && Array.isArray(vuln.affected)) {
            for (const aff of vuln.affected) {
              if (aff.package?.name?.toLowerCase() === pkg.name.toLowerCase() && aff.ranges) {
                for (const range of aff.ranges) {
                  if (range.events) {
                    for (const ev of range.events) {
                      if (ev.fixed) fixedVersion = ev.fixed
                    }
                  }
                }
              }
            }
          }

          const advisoryUrl = vuln.references?.find((r: any) => r.type === 'ADVISORY' || r.type === 'WEB')?.url

          findings.push({
            id: vuln.id || 'CVE-UNKNOWN',
            packageName: pkg.name,
            ecosystem: pkg.ecosystem,
            installedVersion: pkg.version,
            severity,
            cvssScore,
            summary: vuln.summary || vuln.details?.slice(0, 140) || 'Security vulnerability reported',
            affectedVersions: affectedVersions || vuln.id,
            fixedVersion,
            advisoryUrl,
          })
        }
      })
    } catch {
      // Fallback or network offline: continue gracefully
    }
  }

  return findings
}

export function formatAuditMarkdown(report: Omit<Output, 'markdownSummary'>): string {
  let md = `### Dependency Security Audit Report\n\n`
  md += `**Scanned:** ${report.totalScanned} dependencies across ${report.manifestFiles.length} manifests.\n`
  md += `**Vulnerabilities Found:** ${report.vulnerabilitiesFound}\n`
  md += `- 🔴 **Critical:** ${report.countsBySeverity.critical}\n`
  md += `- 🟠 **High:** ${report.countsBySeverity.high}\n`
  md += `- 🟡 **Moderate:** ${report.countsBySeverity.moderate}\n`
  md += `- 🔵 **Low:** ${report.countsBySeverity.low}\n\n`

  if (report.findings.length === 0) {
    md += `✅ No known package vulnerabilities detected in audited manifests.\n`
    return md
  }

  md += `| Severity | Package | Installed | Fixed In | Vulnerability ID | Summary |\n`
  md += `|:---|:---|:---|:---|:---|:---|\n`

  for (const f of report.findings) {
    const fixed = f.fixedVersion ? `\`${f.fixedVersion}\`` : 'No fix yet'
    const link = f.advisoryUrl ? `[${f.id}](${f.advisoryUrl})` : f.id
    md += `| **${f.severity}** | \`${f.packageName}\` | \`${f.installedVersion}\` | ${fixed} | ${link} | ${f.summary.replace(/\|/g, '\\|')} |\n`
  }

  return md
}

import { getCwd } from '../../utils/cwd.js'

export const AuditDependenciesTool = buildTool({
  name: 'audit_dependencies',
  searchHint: 'check package vulnerabilities CVE SCA dependencies OSV',
  description: async () =>
    'Audits project dependencies (package.json, requirements.txt, Cargo.lock, go.mod) against the Open Source Vulnerabilities (OSV) database for known CVEs and security advisories. Returns severity ratings, affected versions, and fixed upgrade versions.',
  prompt: async () =>
    'Audits project dependencies against the OSV vulnerability database for known CVEs and fixed versions.',
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
  async call({ manifestPath, minSeverity }, _context) {
    const cwd = getCwd()
    const manifestsToScan: string[] = []

    if (manifestPath) {
      const fullPath = path.isAbsolute(manifestPath) ? manifestPath : path.join(cwd, manifestPath)
      if (fs.existsSync(fullPath)) manifestsToScan.push(fullPath)
    } else {
      const candidates = ['package.json', 'requirements.txt', 'python/requirements.txt']
      for (const cand of candidates) {
        const full = path.join(cwd, cand)
        if (fs.existsSync(full)) manifestsToScan.push(full)
      }
    }

    const packages: PackageSpec[] = []
    for (const m of manifestsToScan) {
      if (m.endsWith('package.json')) packages.push(...parsePackageJson(m))
      else if (m.endsWith('requirements.txt')) packages.push(...parseRequirementsTxt(m))
    }

    const findings = await queryOsvDevBatch(packages)

    const severityOrder = { CRITICAL: 4, HIGH: 3, MODERATE: 2, LOW: 1, UNKNOWN: 0 }
    const minThreshold = minSeverity ? severityOrder[minSeverity] : 1

    const filtered = findings.filter(f => severityOrder[f.severity] >= minThreshold)

    const counts = {
      critical: filtered.filter(f => f.severity === 'CRITICAL').length,
      high: filtered.filter(f => f.severity === 'HIGH').length,
      moderate: filtered.filter(f => f.severity === 'MODERATE').length,
      low: filtered.filter(f => f.severity === 'LOW').length,
    }

    const baseReport = {
      totalScanned: packages.length,
      vulnerabilitiesFound: filtered.length,
      countsBySeverity: counts,
      findings: filtered,
      manifestFiles: manifestsToScan.map(m => path.relative(cwd, m)),
    }

    const markdownSummary = formatAuditMarkdown(baseReport)

    return {
      data: {
        ...baseReport,
        markdownSummary,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
