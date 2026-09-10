import { z } from 'zod/v4'
import * as fs from 'fs'
import * as path from 'path'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export type SinkType =
  | 'SQL_INJECTION'
  | 'COMMAND_INJECTION'
  | 'PATH_TRAVERSAL'
  | 'CODE_EXECUTION'
  | 'SSRF'
  | 'REFLECTED_XSS'

export interface TaintTraceStep {
  stepNumber: number
  file: string
  line: number
  description: string
  codeSnippet: string
}

export interface TaintFinding {
  sinkType: SinkType
  sourceVariable: string
  sinkVariable: string
  file: string
  sourceLine: number
  sinkLine: number
  trace: TaintTraceStep[]
  severity: 'CRITICAL' | 'HIGH'
  remediation: string
}

export interface TaintReport {
  filesAnalyzed: number
  flowsDetected: number
  findings: TaintFinding[]
}

// Patterns matching untrusted input sources
const TAINT_SOURCES: { name: string; pattern: RegExp }[] = [
  { name: 'Express / Fastify Query', pattern: /\breq(?:uest)?\.query(?:\.([a-zA-Z0-9_$]+)|\[['"]([a-zA-Z0-9_$]+)['"]\])?/ },
  { name: 'Express / Fastify Body', pattern: /\breq(?:uest)?\.body(?:\.([a-zA-Z0-9_$]+)|\[['"]([a-zA-Z0-9_$]+)['"]\])?/ },
  { name: 'Express / Fastify Params', pattern: /\breq(?:uest)?\.params(?:\.([a-zA-Z0-9_$]+)|\[['"]([a-zA-Z0-9_$]+)['"]\])?/ },
  { name: 'Express Headers', pattern: /\breq(?:uest)?\.headers(?:\.([a-zA-Z0-9_$]+)|\[['"]([a-zA-Z0-9_$]+)['"]\])?/ },
  { name: 'Process Argv', pattern: /\bprocess\.argv\[\d+\]/ },
  { name: 'URL Search Params', pattern: /\bsearchParams\.get\(['"]([a-zA-Z0-9_$]+)['"]\)/ },
  { name: 'Python Flask/Django Request', pattern: /\brequest\.(?:args|form|json|GET|POST)(?:\[['"]([a-zA-Z0-9_$]+)['"]\]|\.get\(['"]([a-zA-Z0-9_$]+)['"]\))/ },
]

// Sanitizer functions that neutralize taint
const SANITIZERS = [
  'DOMPurify.sanitize',
  'validator.escape',
  'encodeURIComponent',
  'parseInt',
  'Number',
  'parseFloat',
  'path.basename',
  'escapeHtml',
  'sanitizeHtml',
]

// Sinks where tainted data creates a security vulnerability
const SINKS: { type: SinkType; pattern: RegExp; remediation: string }[] = [
  {
    type: 'SQL_INJECTION',
    pattern: /(?:\.query|\.execute|executeSql|db\.raw)\s*\([^)]*\bVARIABLE\b/g,
    remediation: 'Use parameterized queries ($1, ? or :param) instead of injecting tainted variables.',
  },
  {
    type: 'COMMAND_INJECTION',
    pattern: /(?:child_process|cp)\.(?:exec|execSync|spawn)\s*\([^)]*\bVARIABLE\b/g,
    remediation: 'Avoid passing user-controlled variables into shell execution commands. Use execFile with explicit argument arrays.',
  },
  {
    type: 'PATH_TRAVERSAL',
    pattern: /(?:fs\.(?:readFileSync|readFile|createReadStream|writeFileSync|writeFile|unlinkSync|unlink))\s*\([^)]*\bVARIABLE\b/g,
    remediation: 'Validate input against an allowlist or verify that path.resolve(baseDir, userInput).startsWith(baseDir).',
  },
  {
    type: 'CODE_EXECUTION',
    pattern: /\b(?:eval|new\s+Function|vm\.runInThisContext)\s*\([^)]*\bVARIABLE\b/g,
    remediation: 'Never pass user-tainted strings into dynamic code execution engines.',
  },
  {
    type: 'SSRF',
    pattern: /(?:fetch|axios(?:\.get|\.post)?|https?\.get)\s*\([^)]*\bVARIABLE\b/g,
    remediation: 'Validate destination URLs against an allowlist of permitted hosts and prevent requests to private IP ranges (127.0.0.1, 169.254.169.254).',
  },
  {
    type: 'REFLECTED_XSS',
    pattern: /(?:res\.send|res\.write|document\.write|\.innerHTML\s*=)\s*\([^)]*\bVARIABLE\b/g,
    remediation: 'Sanitize untrusted input before rendering it to the client output or DOM.',
  },
]

export function analyzeFileForTaint(code: string, filePath: string): TaintFinding[] {
  const lines = code.split('\n')
  const findings: TaintFinding[] = []

  // Map of tainted variable name -> { sourceLine: number, sourceExpr: string, history: TaintTraceStep[] }
  const taintedVars = new Map<string, { sourceLine: number; sourceExpr: string; history: TaintTraceStep[] }>()

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1
    const rawLine = lines[lineIdx]
    const line = rawLine.trim()

    if (!line || line.startsWith('//') || line.startsWith('#') || line.startsWith('/*')) {
      continue
    }

    // 1. Check for sanitization clearing taint
    for (const [varName] of taintedVars) {
      for (const san of SANITIZERS) {
        if (line.includes(`${san}(${varName})`) || line.includes(`${san}(`) && line.includes(varName)) {
          // If assigned to a new var or reassigned, taint is sanitized
          const assignMatch = line.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*/);
          if (assignMatch && assignMatch[1] === varName) {
            taintedVars.delete(varName)
          }
        }
      }
    }

    // 2. Check for direct Source introduction:
    // e.g. const id = req.query.id
    for (const src of TAINT_SOURCES) {
      if (src.pattern.test(line)) {
        // Find assigned variable: const x = req.query... or let x = req.body...
        const varDeclMatch = line.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*([^;]+)/)
        if (varDeclMatch) {
          const varName = varDeclMatch[1]
          const expr = varDeclMatch[2]
          const isSanitized = SANITIZERS.some(s => expr.includes(s))
          if (!isSanitized) {
            taintedVars.set(varName, {
              sourceLine: lineNum,
              sourceExpr: expr.trim(),
              history: [
                {
                  stepNumber: 1,
                  file: filePath,
                  line: lineNum,
                  description: `Untrusted data source introduced from '${src.name}' into variable '${varName}'`,
                  codeSnippet: line,
                },
              ],
            })
          }
        }

        // Destructuring: const { id, name } = req.query
        const destructureMatch = line.match(/(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*([^;]+)/)
        if (destructureMatch) {
          const destructuredVars = destructureMatch[1].split(',').map(v => v.trim().split(':')[0].trim())
          const rhs = destructureMatch[2]
          for (const dVar of destructuredVars) {
            if (dVar) {
              taintedVars.set(dVar, {
                sourceLine: lineNum,
                sourceExpr: rhs.trim(),
                history: [
                  {
                    stepNumber: 1,
                    file: filePath,
                    line: lineNum,
                    description: `Untrusted data source introduced from destructuring '${rhs.trim()}' into variable '${dVar}'`,
                    codeSnippet: line,
                  },
                ],
              })
            }
          }
        }
      }
    }

    // 3. Check for Taint Propagation:
    // e.g. const sql = "SELECT * FROM users WHERE id = " + id
    // or const cmd = `run ${id}`
    for (const [tVar, info] of Array.from(taintedVars.entries())) {
      // Check if line assigns a new variable referencing tVar
      const assignMatch = line.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*([^;]+)/)
      if (assignMatch) {
        const newVar = assignMatch[1]
        const rhs = assignMatch[2]
        // If RHS contains the tainted variable and is not sanitized
        const varRegex = new RegExp(`\\b${tVar}\\b`)
        if (newVar !== tVar && varRegex.test(rhs)) {
          // Check if sanitized
          const isSanitized = SANITIZERS.some(s => rhs.includes(s))
          if (!isSanitized) {
            const nextStep: TaintTraceStep = {
              stepNumber: info.history.length + 1,
              file: filePath,
              line: lineNum,
              description: `Taint propagated from '${tVar}' to '${newVar}'`,
              codeSnippet: line,
            }
            taintedVars.set(newVar, {
              sourceLine: info.sourceLine,
              sourceExpr: info.sourceExpr,
              history: [...info.history, nextStep],
            })
          }
        }
      }
    }

    // 4. Check for Taint Sinks:
    for (const [tVar, info] of taintedVars.entries()) {
      for (const sink of SINKS) {
        // Build regex with the tainted variable name
        const sinkPattern = new RegExp(sink.pattern.source.replace('VARIABLE', tVar), 'g')
        if (sinkPattern.test(line)) {
          const finalStep: TaintTraceStep = {
            stepNumber: info.history.length + 1,
            file: filePath,
            line: lineNum,
            description: `Tainted variable '${tVar}' reaches sink '${sink.type}' without adequate sanitization`,
            codeSnippet: line,
          }

          findings.push({
            sinkType: sink.type,
            sourceVariable: info.sourceExpr,
            sinkVariable: tVar,
            file: filePath,
            sourceLine: info.sourceLine,
            sinkLine: lineNum,
            trace: [...info.history, finalStep],
            severity: 'CRITICAL',
            remediation: sink.remediation,
          })
        }
      }
    }
  }

  return findings
}

export function formatTaintReportMarkdown(report: TaintReport): string {
  let md = `### Data-Flow Taint Analysis Report (Source-to-Sink)\n\n`
  md += `**Files Analyzed:** ${report.filesAnalyzed}\n`
  md += `**Exploitable Taint Flows Detected:** ${report.flowsDetected}\n\n`

  if (report.flowsDetected === 0) {
    md += `✅ No untrusted source-to-sink data flows detected in analyzed files.\n`
    return md
  }

  for (let i = 0; i < report.findings.length; i++) {
    const f = report.findings[i]
    md += `#### Flow #${i + 1}: ${f.sinkType} in \`${f.file}\`\n`
    md += `- **Severity:** ${f.severity}\n`
    md += `- **Source Line:** ${f.sourceLine} (\`${f.sourceVariable}\`)\n`
    md += `- **Sink Line:** ${f.sinkLine} (\`${f.sinkVariable}\`)\n`
    md += `- **Remediation:** ${f.remediation}\n\n`
    md += `**Execution Trace:**\n`
    for (const step of f.trace) {
      md += `  ${step.stepNumber}. **Line ${step.line}**: ${step.description}\n`
      md += `     \`\`\`typescript\n     ${step.codeSnippet}\n     \`\`\`\n`
    }
    md += `\n---\n\n`
  }

  return md
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    path: z
      .string()
      .optional()
      .describe('File or directory path to perform taint analysis on. Defaults to workspace root.'),
    sinkFilter: z
      .enum([
        'SQL_INJECTION',
        'COMMAND_INJECTION',
        'PATH_TRAVERSAL',
        'CODE_EXECUTION',
        'SSRF',
        'REFLECTED_XSS',
      ])
      .optional()
      .describe('Filter findings to a specific sink vulnerability type.'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    filesAnalyzed: z.number(),
    flowsDetected: z.number(),
    findings: z.array(
      z.object({
        sinkType: z.string(),
        sourceVariable: z.string(),
        sinkVariable: z.string(),
        file: z.string(),
        sourceLine: z.number(),
        sinkLine: z.number(),
        trace: z.array(
          z.object({
            stepNumber: z.number(),
            file: z.string(),
            line: z.number(),
            description: z.string(),
            codeSnippet: z.string(),
          }),
        ),
        severity: z.string(),
        remediation: z.string(),
      }),
    ),
    markdownSummary: z.string(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

import { getCwd } from '../../utils/cwd.js'

export const TaintAnalysisTool = buildTool({
  name: 'taint_analysis',
  searchHint: 'taint analysis dataflow source to sink variable tracing sqli rce ssrf',
  description: async () =>
    'Performs cross-statement data-flow taint analysis tracing untrusted user input (req.query, req.body, argv) through variable assignments and operations to dangerous execution sinks (SQL, OS command, filesystem, SSRF, XSS).',
  prompt: async () =>
    'Performs cross-statement data-flow taint analysis tracing untrusted user input to dangerous execution sinks.',
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
  async call({ path: targetPath, sinkFilter }, _context) {
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
        const { collectScannableFiles } = await import('../SecurityScanTool/SecurityScanTool.js')
        filesToScan = collectScannableFiles(resolvedTarget)
      } else if (stat.isFile()) {
        filesToScan = [resolvedTarget]
      }
    }

    const allFindings: TaintFinding[] = []

    for (const file of filesToScan) {
      try {
        const content = fs.readFileSync(file, 'utf8')
        const relPath = path.relative(cwd, file)
        const fileFindings = analyzeFileForTaint(content, relPath)
        allFindings.push(...fileFindings)
      } catch {
        // Skip unreadable files
      }
    }

    const filtered = sinkFilter
      ? allFindings.filter(f => f.sinkType === sinkFilter)
      : allFindings

    const report: TaintReport = {
      filesAnalyzed: filesToScan.length,
      flowsDetected: filtered.length,
      findings: filtered,
    }

    const markdownSummary = formatTaintReportMarkdown(report)

    return {
      data: {
        ...report,
        markdownSummary,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
