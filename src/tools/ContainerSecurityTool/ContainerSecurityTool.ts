import { z } from 'zod/v4'
import * as fs from 'fs'
import * as path from 'path'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export type ContainerSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface ContainerFinding {
  ruleId: string
  title: string
  severity: ContainerSeverity
  file: string
  line: number
  snippet: string
  recommendation: string
  fixSnippet?: string
}

export interface ContainerSecurityReport {
  filesScanned: number
  totalFindings: number
  countsBySeverity: Record<ContainerSeverity, number>
  findings: ContainerFinding[]
}

interface DockerfileRule {
  id: string
  title: string
  severity: ContainerSeverity
  check: (content: string, lines: string[], filePath: string) => ContainerFinding[]
}

const DOCKERFILE_RULES: DockerfileRule[] = [
  {
    id: 'dockerfile-user-root',
    title: 'Container process runs as root (missing non-root USER instruction)',
    severity: 'HIGH',
    check: (content, lines, filePath) => {
      const findings: ContainerFinding[] = []
      const hasUser = lines.some(l => /^\s*USER\s+(?!root\b)[a-zA-Z0-9_-]+/i.test(l))
      const hasFrom = lines.some(l => /^\s*FROM\b/i.test(l))
      if (hasFrom && !hasUser) {
        findings.push({
          ruleId: 'dockerfile-user-root',
          title: 'Container process runs as root (missing non-root USER instruction)',
          severity: 'HIGH',
          file: filePath,
          line: 1,
          snippet: lines[0]?.trim() || '',
          recommendation: 'Create and switch to a non-privileged user (e.g. `USER node` or `USER 1001`) before CMD/ENTRYPOINT.',
          fixSnippet: 'RUN adduser -D appuser && USER appuser',
        })
      }
      return findings
    },
  },
  {
    id: 'dockerfile-mutable-latest-tag',
    title: 'Base image uses unpinned or :latest tag',
    severity: 'MEDIUM',
    check: (_content, lines, filePath) => {
      const findings: ContainerFinding[] = []
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const fromMatch = line.match(/^\s*FROM\s+([^\s]+)/i)
        if (fromMatch) {
          const image = fromMatch[1]
          if (image.toLowerCase() === 'scratch') continue
          // If image has no colon tag or has :latest
          if (!image.includes(':') || image.endsWith(':latest')) {
            findings.push({
              ruleId: 'dockerfile-mutable-latest-tag',
              title: 'Base image uses unpinned or :latest tag',
              severity: 'MEDIUM',
              file: filePath,
              line: i + 1,
              snippet: line.trim(),
              recommendation: 'Pin base image to an immutable version tag or digest (e.g., node:20.11-alpine or node@sha256:...).',
              fixSnippet: `FROM ${image.split(':')[0]}:<specific-version>`,
            })
          }
        }
      }
      return findings
    },
  },
  {
    id: 'dockerfile-hardcoded-secret',
    title: 'Hardcoded secret or credential in ENV or ARG',
    severity: 'CRITICAL',
    check: (_content, lines, filePath) => {
      const findings: ContainerFinding[] = []
      const secretRegex = /^\s*(?:ENV|ARG)\s+([a-zA-Z0-9_-]*(?:SECRET|KEY|PASSWORD|TOKEN|AUTH|CREDENTIAL)[a-zA-Z0-9_-]*)\s*=\s*(["']?[^"'\s$]{6,}["']?)/i
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const match = line.match(secretRegex)
        if (match) {
          const val = match[2].toLowerCase()
          if (!val.includes('placeholder') && !val.includes('example') && !val.startsWith('$')) {
            findings.push({
              ruleId: 'dockerfile-hardcoded-secret',
              title: 'Hardcoded secret or credential in ENV or ARG',
              severity: 'CRITICAL',
              file: filePath,
              line: i + 1,
              snippet: line.trim().slice(0, 80),
              recommendation: 'Inject secrets at runtime via environment variables, secrets volume, or BuildKit secret mounts (`--mount=type=secret`).',
              fixSnippet: 'RUN --mount=type=secret,id=mysecret ...',
            })
          }
        }
      }
      return findings
    },
  },
  {
    id: 'dockerfile-use-copy-over-add',
    title: 'Use COPY instead of ADD for local files',
    severity: 'LOW',
    check: (_content, lines, filePath) => {
      const findings: ContainerFinding[] = []
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const addMatch = line.match(/^\s*ADD\s+([^\s]+)\s+([^\s]+)/i)
        if (addMatch) {
          const src = addMatch[1]
          if (!src.startsWith('http://') && !src.startsWith('https://') && !src.endsWith('.tar.gz') && !src.endsWith('.tar')) {
            findings.push({
              ruleId: 'dockerfile-use-copy-over-add',
              title: 'Use COPY instead of ADD for local files',
              severity: 'LOW',
              file: filePath,
              line: i + 1,
              snippet: line.trim(),
              recommendation: 'Use `COPY` instead of `ADD` when copying local files unless auto-tar extraction is explicitly needed.',
              fixSnippet: `COPY ${addMatch[1]} ${addMatch[2]}`,
            })
          }
        }
      }
      return findings
    },
  },
  {
    id: 'dockerfile-ssh-port-exposed',
    title: 'SSH Port 22 exposed in container',
    severity: 'HIGH',
    check: (_content, lines, filePath) => {
      const findings: ContainerFinding[] = []
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (/^\s*EXPOSE\s+.*\b22\b/i.test(line)) {
          findings.push({
            ruleId: 'dockerfile-ssh-port-exposed',
            title: 'SSH Port 22 exposed in container',
            severity: 'HIGH',
            file: filePath,
            line: i + 1,
            snippet: line.trim(),
            recommendation: 'Avoid running SSH inside containers. Use `docker exec` or container runtime shells for management.',
          })
        }
      }
      return findings
    },
  },
]

export function scanDockerfile(content: string, filePath: string): ContainerFinding[] {
  const lines = content.split('\n')
  const findings: ContainerFinding[] = []
  for (const rule of DOCKERFILE_RULES) {
    findings.push(...rule.check(content, lines, filePath))
  }
  return findings
}

export function scanDockerCompose(content: string, filePath: string): ContainerFinding[] {
  const lines = content.split('\n')
  const findings: ContainerFinding[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) continue

    // Check privileged: true
    if (/^\s*privileged\s*:\s*true\b/i.test(line)) {
      findings.push({
        ruleId: 'compose-privileged-container',
        title: 'Privileged container mode enabled (grants full host root access)',
        severity: 'CRITICAL',
        file: filePath,
        line: i + 1,
        snippet: trimmed,
        recommendation: 'Remove `privileged: true`. Grant only specific Linux capabilities using `cap_add` instead.',
      })
    }

    // Check host network / pid / ipc
    if (/^\s*(?:network_mode|pid|ipc)\s*:\s*["']?host["']?\b/i.test(line)) {
      findings.push({
        ruleId: 'compose-host-namespace-shared',
        title: 'Host namespace shared with container (network/pid/ipc: host)',
        severity: 'HIGH',
        file: filePath,
        line: i + 1,
        snippet: trimmed,
        recommendation: 'Isolate container namespaces rather than sharing host namespace.',
      })
    }

    // Check dangerous capabilities
    if (/-\s*(?:SYS_ADMIN|ALL|NET_ADMIN)\b/.test(line)) {
      findings.push({
        ruleId: 'compose-dangerous-capability',
        title: 'Overly permissive Linux capability granted (SYS_ADMIN or ALL)',
        severity: 'HIGH',
        file: filePath,
        line: i + 1,
        snippet: trimmed,
        recommendation: 'Follow the principle of least privilege and grant only minimum required capabilities.',
      })
    }

    // Check Docker socket mounted
    if (/docker\.sock:/i.test(line)) {
      findings.push({
        ruleId: 'compose-docker-socket-mounted',
        title: 'Host Docker socket mounted into container (/var/run/docker.sock)',
        severity: 'CRITICAL',
        file: filePath,
        line: i + 1,
        snippet: trimmed,
        recommendation: 'Mounting docker.sock gives the container root control over the host. Avoid unless building a trusted CI agent.',
      })
    }
  }

  return findings
}

export function formatContainerReportMarkdown(report: ContainerSecurityReport): string {
  let md = `### Container & Dockerfile Security Audit Report\n\n`
  md += `**Files Scanned:** ${report.filesScanned}\n`
  md += `**Total Misconfigurations:** ${report.totalFindings}\n`
  md += `**Severity Breakdown:** CRITICAL: ${report.countsBySeverity.CRITICAL} | HIGH: ${report.countsBySeverity.HIGH} | MEDIUM: ${report.countsBySeverity.MEDIUM} | LOW: ${report.countsBySeverity.LOW}\n\n`

  if (report.totalFindings === 0) {
    md += `✅ No container security misconfigurations or Dockerfile vulnerabilities detected.\n`
    return md
  }

  md += `| Severity | Rule | File:Line | Snippet | Recommendation |\n`
  md += `|:---|:---|:---|:---|:---|\n`

  for (const f of report.findings) {
    const snippetClean = f.snippet.replace(/\|/g, '\\|')
    const recClean = f.recommendation.replace(/\|/g, '\\|')
    md += `| **${f.severity}** | ${f.title} | \`${f.file}:${f.line}\` | \`${snippetClean}\` | ${recClean} |\n`
  }

  return md
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    path: z
      .string()
      .optional()
      .describe('Path to Dockerfile or docker-compose.yml, or directory containing them. Defaults to workspace root.'),
    minSeverity: z
      .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
      .optional()
      .describe('Minimum severity threshold to report. Defaults to LOW.'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    filesScanned: z.number(),
    totalFindings: z.number(),
    countsBySeverity: z.record(z.string(), z.number()),
    findings: z.array(
      z.object({
        ruleId: z.string(),
        title: z.string(),
        severity: z.string(),
        file: z.string(),
        line: z.number(),
        snippet: z.string(),
        recommendation: z.string(),
        fixSnippet: z.string().optional(),
      }),
    ),
    markdownSummary: z.string(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

import { getCwd } from '../../utils/cwd.js'

export const ContainerSecurityTool = buildTool({
  name: 'audit_container',
  searchHint: 'docker dockerfile compose container security linter misconfiguration root cve',
  description: async () =>
    'Audits Dockerfiles and docker-compose manifests for security misconfigurations (running as root, mutable :latest tags, hardcoded secrets, privileged flags, docker.sock mount, exposed SSH ports).',
  prompt: async () =>
    'Audits Dockerfiles and docker-compose manifests for container security misconfigurations.',
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

    const filesToScan: { file: string; type: 'dockerfile' | 'compose' }[] = []

    function walkDir(dir: string) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            walkDir(full)
          } else if (entry.isFile()) {
            const lower = entry.name.toLowerCase()
            if (lower === 'dockerfile' || lower.startsWith('dockerfile.') || lower.endsWith('.dockerfile')) {
              filesToScan.push({ file: full, type: 'dockerfile' })
            } else if (
              lower === 'docker-compose.yml' ||
              lower === 'docker-compose.yaml' ||
              lower === 'compose.yml' ||
              lower === 'compose.yaml'
            ) {
              filesToScan.push({ file: full, type: 'compose' })
            }
          }
        }
      } catch {
        // Ignore
      }
    }

    if (fs.existsSync(resolvedTarget)) {
      const stat = fs.statSync(resolvedTarget)
      if (stat.isDirectory()) {
        walkDir(resolvedTarget)
      } else if (stat.isFile()) {
        const lower = path.basename(resolvedTarget).toLowerCase()
        if (lower.includes('compose')) {
          filesToScan.push({ file: resolvedTarget, type: 'compose' })
        } else {
          filesToScan.push({ file: resolvedTarget, type: 'dockerfile' })
        }
      }
    }

    const allFindings: ContainerFinding[] = []

    for (const item of filesToScan) {
      try {
        const content = fs.readFileSync(item.file, 'utf8')
        const relPath = path.relative(cwd, item.file)
        if (item.type === 'dockerfile') {
          allFindings.push(...scanDockerfile(content, relPath))
        } else {
          allFindings.push(...scanDockerCompose(content, relPath))
        }
      } catch {
        // Skip unreadable
      }
    }

    const severityOrder: Record<ContainerSeverity, number> = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    }
    const minThreshold = minSeverity ? severityOrder[minSeverity] : 1
    const filtered = allFindings.filter(f => severityOrder[f.severity] >= minThreshold)

    const countsBySeverity: Record<ContainerSeverity, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    }
    for (const f of filtered) {
      countsBySeverity[f.severity]++
    }

    const report: ContainerSecurityReport = {
      filesScanned: filesToScan.length,
      totalFindings: filtered.length,
      countsBySeverity,
      findings: filtered,
    }

    const markdownSummary = formatContainerReportMarkdown(report)

    return {
      data: {
        ...report,
        markdownSummary,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
