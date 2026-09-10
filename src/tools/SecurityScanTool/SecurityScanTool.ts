import { z } from 'zod/v4'
import * as fs from 'fs'
import * as path from 'path'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export type SASTSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface SASTFinding {
  ruleId: string
  cwe: string
  owaspCategory?: string
  title: string
  severity: SASTSeverity
  file: string
  line: number
  snippet: string
  recommendation: string
  fixSnippet?: string
}

export interface SecurityScanReport {
  filesScanned: number
  totalFindings: number
  countsBySeverity: Record<SASTSeverity, number>
  countsByCwe: Record<string, number>
  findings: SASTFinding[]
}

export interface SASTRule {
  id: string
  cwe: string
  owaspCategory: string
  title: string
  severity: SASTSeverity
  languages: ('javascript' | 'typescript' | 'python' | 'go' | 'all')[]
  pattern: RegExp
  recommendation: string
  fixSnippet?: string
}

export const SAST_RULES: SASTRule[] = [
  {
    id: 'sast-sql-injection-template',
    cwe: 'CWE-89',
    owaspCategory: 'A03:2021-Injection',
    title: 'SQL Injection via Template String or Concatenation',
    severity: 'CRITICAL',
    languages: ['javascript', 'typescript'],
    pattern: /(?:\.query|\.execute|executeSql|db\.raw)\s*\(\s*(?:`[^`]*\$\{.*?\}[^`]*`|["'][^"']*\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|UNION)\b[^"']*["']\s*\+)/gi,
    recommendation: 'Use parameterized queries or prepared statements instead of concatenating untrusted inputs into SQL strings.',
    fixSnippet: 'db.query("SELECT * FROM users WHERE id = $1", [userId])',
  },
  {
    id: 'sast-sql-injection-py',
    cwe: 'CWE-89',
    owaspCategory: 'A03:2021-Injection',
    title: 'SQL Injection via String Formatting in Python',
    severity: 'CRITICAL',
    languages: ['python'],
    pattern: /(?:cursor|session|conn|db)\.execute\s*\(\s*(?:f["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*["']|["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*["']\s*%\s*\(?|["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*["']\.format\()/gi,
    recommendation: 'Pass query parameters as a tuple/list to the cursor/ORM execute method rather than using f-strings or % formatting.',
    fixSnippet: 'cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))',
  },
  {
    id: 'sast-command-injection-node',
    cwe: 'CWE-78',
    owaspCategory: 'A03:2021-Injection',
    title: 'OS Command Injection via child_process',
    severity: 'CRITICAL',
    languages: ['javascript', 'typescript'],
    pattern: /(?:(?:child_process|cp)\.(?:exec|execSync)|\bexecSync|\bexec)\s*\(\s*(?:`[^`]*\$\{.*?\}[^`]*`|["'][^"']*["']\s*\+|\b[a-zA-Z0-9_$.]+\s*\+)/g,
    recommendation: 'Use execFile or spawn without shell invocation (shell: false) and pass command arguments as an array.',
    fixSnippet: 'execFile("git", ["log", "-n", "10"], callback)',
  },
  {
    id: 'sast-command-injection-py',
    cwe: 'CWE-78',
    owaspCategory: 'A03:2021-Injection',
    title: 'OS Command Injection in Python (shell=True or os.system)',
    severity: 'CRITICAL',
    languages: ['python'],
    pattern: /(?:os\.system\s*\(\s*(?:f["']|.*?\+)|subprocess\.(?:Popen|run|call|check_output)\s*\([^)]*shell\s*=\s*True)/g,
    recommendation: 'Avoid shell=True in subprocess calls. Pass arguments as a list of strings instead of shell-formatted strings.',
    fixSnippet: 'subprocess.run(["ls", "-l", user_dir], check=True)',
  },
  {
    id: 'sast-eval-remote-code-exec',
    cwe: 'CWE-95',
    owaspCategory: 'A03:2021-Injection',
    title: 'Dynamic Code Execution via eval() or Function()',
    severity: 'CRITICAL',
    languages: ['javascript', 'typescript', 'python'],
    pattern: /\b(?:eval|new\s+Function|vm\.runInThisContext|vm\.runInNewContext)\s*\(/g,
    recommendation: 'Avoid dynamic evaluation of code. Parse data with JSON.parse() or use safe interpreters.',
  },
  {
    id: 'sast-insecure-crypto-md5-sha1',
    cwe: 'CWE-328',
    owaspCategory: 'A02:2021-Cryptographic Failures',
    title: 'Weak / Broken Hash Algorithm (MD5 or SHA-1)',
    severity: 'HIGH',
    languages: ['javascript', 'typescript', 'python', 'all'],
    pattern: /(?:crypto\.createHash\s*\(\s*["'](?:md5|sha1)["']|hashlib\.(?:md5|sha1)\s*\()/gi,
    recommendation: 'Use SHA-256 or SHA-512 for integrity, or bcrypt/argon2/scrypt for password hashing.',
    fixSnippet: 'crypto.createHash("sha256")',
  },
  {
    id: 'sast-insecure-deserialization-py',
    cwe: 'CWE-502',
    owaspCategory: 'A08:2021-Software and Data Integrity Failures',
    title: 'Insecure Deserialization via pickle or yaml.load',
    severity: 'CRITICAL',
    languages: ['python'],
    pattern: /(?:pickle\.loads?\s*\(|yaml\.load\s*\([^)]*(?:Loader\s*=\s*yaml\.(?:UnsafeLoader|Loader)|(?<!safe_load)))/g,
    recommendation: 'Never unpickle untrusted data. Use yaml.safe_load() or JSON for data serialization.',
    fixSnippet: 'yaml.safe_load(untrusted_stream)',
  },
  {
    id: 'sast-disabled-tls-verification',
    cwe: 'CWE-295',
    owaspCategory: 'A02:2021-Cryptographic Failures',
    title: 'Disabled TLS Certificate Verification',
    severity: 'CRITICAL',
    languages: ['all'],
    pattern: /(?:rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0["']?|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true)/g,
    recommendation: 'Ensure TLS certificate validation is enabled. Do not disable rejectUnauthorized or verify=False in production.',
  },
  {
    id: 'sast-xss-react-innerhtml',
    cwe: 'CWE-79',
    owaspCategory: 'A03:2021-Injection',
    title: 'Potential Cross-Site Scripting (XSS) via innerHTML / dangerouslySetInnerHTML',
    severity: 'HIGH',
    languages: ['javascript', 'typescript'],
    pattern: /(?:dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:|\.innerHTML\s*=)/g,
    recommendation: 'Sanitize untrusted HTML with DOMPurify before inserting, or use standard React text rendering.',
    fixSnippet: '<div>{DOMPurify.sanitize(userInput)}</div>',
  },
  {
    id: 'sast-weak-random-token',
    cwe: 'CWE-338',
    owaspCategory: 'A02:2021-Cryptographic Failures',
    title: 'Cryptographically Weak Pseudo-Random Number Generator',
    severity: 'MEDIUM',
    languages: ['javascript', 'typescript', 'python'],
    pattern: /(?:token|secret|session|nonce|key|id|auth)[^=;]*=\s*(?:Math\.random\s*\(\)|random\.(?:random|randint|choice)\s*\()/gi,
    recommendation: 'Use a cryptographically secure random generator (crypto.randomBytes or secrets in Python) for security-sensitive values.',
    fixSnippet: 'crypto.randomBytes(32).toString("hex")',
  },
  {
    id: 'sast-path-traversal-fs',
    cwe: 'CWE-22',
    owaspCategory: 'A01:2021-Broken Access Control',
    title: 'Potential Path Traversal in File System Access',
    severity: 'HIGH',
    languages: ['javascript', 'typescript', 'python'],
    pattern: /(?:fs\.(?:readFileSync|readFile|createReadStream|writeFileSync|writeFile|unlinkSync|unlink)\s*\([^)]*(?:req\.(?:query|params|body)|user_input|filename|path\.join\([^)]*req\.)|open\s*\([^)]*(?:request\.(?:args|form|values)))/gi,
    recommendation: 'Validate and canonicalize paths using path.resolve and verify they stay within an intended base root directory.',
  },
  {
    id: 'sast-prototype-pollution',
    cwe: 'CWE-1321',
    owaspCategory: 'A03:2021-Injection',
    title: 'Potential Prototype Pollution via Object Assignment',
    severity: 'HIGH',
    languages: ['javascript', 'typescript'],
    pattern: /(?:Object\.assign\s*\(\s*\{\s*\}\s*,\s*(?:req\.body|userInput|body)|__proto__|prototype\[)/g,
    recommendation: 'Validate object keys against __proto__ and constructor. Use Object.create(null) for dictionary maps.',
  },
]

const EXTENSION_MAP: Record<string, 'javascript' | 'typescript' | 'python' | 'go'> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.go': 'go',
}

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
  '__pycache__',
  '.venv',
  'venv',
])

export function scanCodeForVulnerabilities(code: string, filePath: string): SASTFinding[] {
  const findings: SASTFinding[] = []
  const ext = path.extname(filePath).toLowerCase()
  const lang = EXTENSION_MAP[ext]
  const lines = code.split('\n')

  for (const rule of SAST_RULES) {
    if (
      !rule.languages.includes('all') &&
      lang &&
      !rule.languages.includes(lang)
    ) {
      continue
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line || line.length > 1500) continue
      // Skip commented-out lines
      const trimmed = line.trim()
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue
      }

      rule.pattern.lastIndex = 0
      if (rule.pattern.test(line)) {
        findings.push({
          ruleId: rule.id,
          cwe: rule.cwe,
          owaspCategory: rule.owaspCategory,
          title: rule.title,
          severity: rule.severity,
          file: filePath,
          line: i + 1,
          snippet: trimmed.slice(0, 120),
          recommendation: rule.recommendation,
          fixSnippet: rule.fixSnippet,
        })
      }
    }
  }

  return findings
}

export function collectScannableFiles(dir: string, baseDir: string = dir): string[] {
  const result: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        result.push(...collectScannableFiles(full, baseDir))
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (EXTENSION_MAP[ext]) {
          try {
            const stats = fs.statSync(full)
            if (stats.size <= 1024 * 1024) {
              result.push(full)
            }
          } catch {
            // Ignore unreadable
          }
        }
      }
    }
  } catch {
    // Ignore unreadable
  }
  return result
}

export function formatSASTReportMarkdown(report: SecurityScanReport): string {
  let md = `### Static Application Security Testing (SAST) Report\n\n`
  md += `**Files Scanned:** ${report.filesScanned}\n`
  md += `**Total Vulnerabilities:** ${report.totalFindings}\n`
  md += `**Severity Breakdown:** CRITICAL: ${report.countsBySeverity.CRITICAL} | HIGH: ${report.countsBySeverity.HIGH} | MEDIUM: ${report.countsBySeverity.MEDIUM} | LOW: ${report.countsBySeverity.LOW}\n\n`

  if (report.totalFindings === 0) {
    md += `✅ No security vulnerabilities detected in scanned files.\n`
    return md
  }

  md += `| Severity | Rule / CWE | File:Line | Vulnerable Code | Recommendation |\n`
  md += `|:---|:---|:---|:---|:---|\n`

  for (const f of report.findings) {
    const snippetClean = f.snippet.replace(/\|/g, '\\|')
    const recClean = f.recommendation.replace(/\|/g, '\\|')
    md += `| **${f.severity}** | ${f.title} (\`${f.cwe}\`) | \`${f.file}:${f.line}\` | \`${snippetClean}\` | ${recClean} |\n`
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
      .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
      .optional()
      .describe('Minimum vulnerability severity to include. Defaults to LOW.'),
    cweFilter: z
      .string()
      .optional()
      .describe('Optional CWE filter, e.g. "CWE-89" for SQL Injection only.'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    filesScanned: z.number(),
    totalFindings: z.number(),
    countsBySeverity: z.record(z.string(), z.number()),
    countsByCwe: z.record(z.string(), z.number()),
    findings: z.array(
      z.object({
        ruleId: z.string(),
        cwe: z.string(),
        owaspCategory: z.string().optional(),
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

export const SecurityScanTool = buildTool({
  name: 'security_scan',
  searchHint: 'sast static code analysis vulnerabilities cwe owasp security bugs injection xss',
  description: async () =>
    'Performs Static Application Security Testing (SAST) across source files for OWASP Top 10 and CWE flaws (SQL Injection, Command Injection, Path Traversal, Eval/RCE, Insecure Crypto, Disabled TLS, Prototype Pollution, XSS).',
  prompt: async () =>
    'Performs Static Application Security Testing (SAST) across source files for OWASP Top 10 and CWE flaws.',
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
  async call({ path: targetPath, minSeverity, cweFilter }, _context) {
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
        filesToScan = collectScannableFiles(resolvedTarget)
      } else if (stat.isFile()) {
        filesToScan = [resolvedTarget]
      }
    }

    const allFindings: SASTFinding[] = []

    for (const file of filesToScan) {
      try {
        const content = fs.readFileSync(file, 'utf8')
        const relPath = path.relative(cwd, file)
        const fileFindings = scanCodeForVulnerabilities(content, relPath)
        allFindings.push(...fileFindings)
      } catch {
        // Skip unreadable files
      }
    }

    const severityOrder: Record<SASTSeverity, number> = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    }
    const minThreshold = minSeverity ? severityOrder[minSeverity] : 1

    const filtered = allFindings.filter(f => {
      if (severityOrder[f.severity] < minThreshold) return false
      if (cweFilter && !f.cwe.toLowerCase().includes(cweFilter.toLowerCase())) return false
      return true
    })

    const countsBySeverity: Record<SASTSeverity, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    }
    const countsByCwe: Record<string, number> = {}

    for (const f of filtered) {
      countsBySeverity[f.severity]++
      countsByCwe[f.cwe] = (countsByCwe[f.cwe] || 0) + 1
    }

    const report: SecurityScanReport = {
      filesScanned: filesToScan.length,
      totalFindings: filtered.length,
      countsBySeverity,
      countsByCwe,
      findings: filtered,
    }

    const markdownSummary = formatSASTReportMarkdown(report)

    return {
      data: {
        ...report,
        markdownSummary,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
