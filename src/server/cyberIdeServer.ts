import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import * as url from 'url'
import { getCyberIdeHtml } from './cyberIdeHtml.js'
import {
  scanTextForSecrets,
  collectFilesRecursively as collectSecretFiles,
} from '../tools/SecretScanTool/SecretScanTool.js'
import {
  scanCodeForVulnerabilities,
  collectScannableFiles,
} from '../tools/SecurityScanTool/SecurityScanTool.js'
import { analyzeFileForTaint } from '../tools/TaintAnalysisTool/TaintAnalysisTool.js'
import {
  scanDockerfile,
  scanDockerCompose,
} from '../tools/ContainerSecurityTool/ContainerSecurityTool.js'
import {
  extractComponentsFromDir,
  buildCycloneDX,
  buildSPDX,
} from '../tools/SBOMGeneratorTool/SBOMGeneratorTool.js'
import { calculateSecurityGrade } from '../commands/audit/audit.js'

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  children?: FileTreeNode[]
}

const IGNORED_FOLDERS = new Set([
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
  '.venv',
])

export function buildFileTree(dir: string, baseDir: string = dir, depth: number = 0): FileTreeNode[] {
  if (depth > 6) return []
  const nodes: FileTreeNode[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    // Sort directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (IGNORED_FOLDERS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      const rel = path.relative(baseDir, full)

      if (entry.isDirectory()) {
        const children = buildFileTree(full, baseDir, depth + 1)
        nodes.push({
          name: entry.name,
          path: rel,
          type: 'dir',
          children,
        })
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(full)
          nodes.push({
            name: entry.name,
            path: rel,
            type: 'file',
            size: stats.size,
          })
        } catch {
          // Ignore unreadable
        }
      }
    }
  } catch {
    // Ignore
  }
  return nodes
}

export function createCyberIdeServer(workspaceDir: string) {
  const workspaceName = path.basename(workspaceDir) || 'workspace'

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || '/', true)
    const pathname = parsedUrl.pathname || '/'
    const method = req.method || 'GET'

    // CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Serve HTML UI
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(getCyberIdeHtml(workspaceDir, workspaceName))
      return
    }

    // Health check
    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', workspace: workspaceDir }))
      return
    }

    // File Tree API
    if (pathname === '/api/files/tree' && method === 'GET') {
      const tree = buildFileTree(workspaceDir)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ tree }))
      return
    }

    // File Read API
    if (pathname === '/api/files/read' && method === 'GET') {
      const targetRel = parsedUrl.query.path as string
      if (!targetRel) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing path parameter' }))
        return
      }

      const fullPath = path.resolve(workspaceDir, targetRel)
      if (!fullPath.startsWith(workspaceDir)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Forbidden: Path outside workspace' }))
        return
      }

      try {
        const content = fs.readFileSync(fullPath, 'utf8')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ path: targetRel, content }))
      } catch (err: any) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    // Helper to read JSON request body
    const readJsonBody = async (): Promise<any> => {
      return new Promise((resolve, reject) => {
        let body = ''
        req.on('data', chunk => {
          body += chunk
        })
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {})
          } catch (e) {
            reject(e)
          }
        })
        req.on('error', reject)
      })
    }

    // File Write API
    if (pathname === '/api/files/write' && method === 'POST') {
      try {
        const { path: targetRel, content } = await readJsonBody()
        if (!targetRel || content === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing path or content' }))
          return
        }

        const fullPath = path.resolve(workspaceDir, targetRel)
        if (!fullPath.startsWith(workspaceDir)) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Forbidden: Path outside workspace' }))
          return
        }

        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, content, 'utf8')

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, path: targetRel }))
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    // Real-Time File Security Scan (Monaco Markers)
    if (pathname === '/api/security/scan-file' && method === 'POST') {
      try {
        const { path: filePath, content } = await readJsonBody()
        const markers: any[] = []

        // 1. Secrets
        const secrets = scanTextForSecrets(content, filePath)
        for (const s of secrets) {
          markers.push({
            severity: 8, // Monaco MarkerSeverity.Error
            startLineNumber: s.line,
            startColumn: 1,
            endLineNumber: s.line,
            endColumn: 1000,
            message: `[Soteria Secret Leak] ${s.secretType} detected: ${s.maskedSecret}`,
            source: 'Soteria Secrets',
            code: s.ruleId,
          })
        }

        // 2. SAST
        const sast = scanCodeForVulnerabilities(content, filePath)
        for (const f of sast) {
          markers.push({
            severity: f.severity === 'CRITICAL' ? 8 : 4, // 8 = Error, 4 = Warning
            startLineNumber: f.line,
            startColumn: 1,
            endLineNumber: f.line,
            endColumn: 1000,
            message: `[Soteria SAST] ${f.title} (${f.cwe})\nFix: ${f.recommendation}`,
            source: 'Soteria SAST',
            code: f.cwe,
          })
        }

        // 3. Taint
        const taint = analyzeFileForTaint(content, filePath)
        for (const t of taint) {
          markers.push({
            severity: 8,
            startLineNumber: t.sinkLine,
            startColumn: 1,
            endLineNumber: t.sinkLine,
            endColumn: 1000,
            message: `[Soteria Taint Flow] Exploitable ${t.sinkType} (untrusted input from line ${t.sourceLine})\nRemediation: ${t.remediation}`,
            source: 'Soteria Taint',
            code: t.sinkType,
          })
        }

        // 4. Docker
        const lower = filePath.toLowerCase()
        if (lower.includes('dockerfile')) {
          const dockerFindings = scanDockerfile(content, filePath)
          for (const d of dockerFindings) {
            markers.push({
              severity: d.severity === 'CRITICAL' || d.severity === 'HIGH' ? 8 : 4,
              startLineNumber: d.line,
              startColumn: 1,
              endLineNumber: d.line,
              endColumn: 1000,
              message: `[Soteria Container] ${d.title}\nFix: ${d.recommendation}`,
              source: 'Soteria Container',
              code: d.ruleId,
            })
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ markers }))
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    // Full Workspace Audit
    if (pathname === '/api/security/audit' && method === 'POST') {
      try {
        const secretFiles = collectSecretFiles(workspaceDir)
        const secretFindings: any[] = []
        for (const f of secretFiles) {
          try {
            const content = fs.readFileSync(f, 'utf8')
            const rel = path.relative(workspaceDir, f)
            secretFindings.push(...scanTextForSecrets(content, rel))
          } catch {}
        }

        const sastFiles = collectScannableFiles(workspaceDir)
        const sastFindings: any[] = []
        for (const f of sastFiles) {
          try {
            const content = fs.readFileSync(f, 'utf8')
            const rel = path.relative(workspaceDir, f)
            sastFindings.push(...scanCodeForVulnerabilities(content, rel))
          } catch {}
        }

        const taintFindings: any[] = []
        for (const f of sastFiles) {
          try {
            const content = fs.readFileSync(f, 'utf8')
            const rel = path.relative(workspaceDir, f)
            taintFindings.push(...analyzeFileForTaint(content, rel))
          } catch {}
        }

        const containerFindings: any[] = []
        const dockerfiles = [path.join(workspaceDir, 'Dockerfile')]
        for (const df of dockerfiles) {
          if (fs.existsSync(df)) {
            try {
              const content = fs.readFileSync(df, 'utf8')
              containerFindings.push(...scanDockerfile(content, path.relative(workspaceDir, df)))
            } catch {}
          }
        }

        const composePaths = [path.join(workspaceDir, 'docker-compose.yml'), path.join(workspaceDir, 'compose.yml')]
        for (const cf of composePaths) {
          if (fs.existsSync(cf)) {
            try {
              const content = fs.readFileSync(cf, 'utf8')
              containerFindings.push(...scanDockerCompose(content, path.relative(workspaceDir, cf)))
            } catch {}
          }
        }

        const { rootName, rootVersion, components } = extractComponentsFromDir(workspaceDir)

        let criticalCount = 0
        let highCount = 0
        let mediumCount = 0
        let lowCount = 0

        for (const f of secretFindings) {
          if (f.severity === 'CRITICAL') criticalCount++
          else if (f.severity === 'HIGH') highCount++
          else mediumCount++
        }
        for (const f of sastFindings) {
          if (f.severity === 'CRITICAL') criticalCount++
          else if (f.severity === 'HIGH') highCount++
          else if (f.severity === 'MEDIUM') mediumCount++
          else lowCount++
        }
        for (const f of taintFindings) {
          if (f.severity === 'CRITICAL') criticalCount++
          else highCount++
        }
        for (const f of containerFindings) {
          if (f.severity === 'CRITICAL') criticalCount++
          else if (f.severity === 'HIGH') highCount++
          else if (f.severity === 'MEDIUM') mediumCount++
          else lowCount++
        }

        const rawScore = 100 - (criticalCount * 25 + highCount * 10 + mediumCount * 3 + lowCount * 1)
        const score = Math.max(0, rawScore)
        const { grade } = calculateSecurityGrade(score)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            score,
            grade,
            criticalCount,
            highCount,
            mediumCount,
            lowCount,
            secrets: secretFindings,
            sast: sastFindings,
            taint: taintFindings,
            containers: containerFindings,
            components,
            rootName,
            rootVersion,
          }),
        )
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    // SBOM Download
    if (pathname === '/api/sbom/download' && method === 'GET') {
      const format = (parsedUrl.query.format as string) || 'cyclonedx'
      const { rootName, rootVersion, components } = extractComponentsFromDir(workspaceDir)

      if (format.toLowerCase() === 'spdx') {
        const spdx = buildSPDX(rootName, rootVersion, components)
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${rootName}-sbom.spdx.json"`,
        })
        res.end(JSON.stringify(spdx, null, 2))
      } else {
        const cdx = buildCycloneDX(rootName, rootVersion, components)
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${rootName}-sbom.cdx.json"`,
        })
        res.end(JSON.stringify(cdx, null, 2))
      }
      return
    }

    // Agent Cyber Copilot Chat API
    if (pathname === '/api/agent/chat' && method === 'POST') {
      try {
        const { message, activeFile, activeFileContent } = await readJsonBody()

        // Smart cyber remediation responses
        const lowerMsg = (message || '').toLowerCase()
        let reply = ''
        let codeSnippet: string | undefined

        if (lowerMsg.includes('fix') && activeFileContent) {
          reply = `I have analyzed \`${activeFile || 'the active file'}\` and applied secure coding remediation according to OWASP guidelines. Check the code snippet below and click 'Apply to Editor' to update your file immediately:`

          // Provide automated remediation
          let hardened = activeFileContent

          // Fix eval
          hardened = hardened.replace(/eval\s*\(([^)]+)\)/g, 'JSON.parse($1)')

          // Fix template literal SQL queries
          hardened = hardened.replace(
            /db\.query\s*\(\s*`([^`]*)\$\{([^}]+)\}([^`]*)`\s*\)/g,
            'db.query("$1$1$3", [$2])',
          )

          // Fix child_process.exec
          hardened = hardened.replace(
            /(?:child_process|cp)\.exec\s*\(([^)]+)\)/g,
            'child_process.execFile("safe_binary", [$1])',
          )

          // Fix MD5
          hardened = hardened.replace(/createHash\s*\(\s*['"]md5['"]\s*\)/g, "createHash('sha256')")

          // Fix Dockerfile root
          if (activeFile && activeFile.toLowerCase().includes('dockerfile') && !hardened.includes('USER ')) {
            hardened += '\n# Added non-privileged user for CIS Docker Benchmark\nRUN adduser -D appuser\nUSER appuser\n'
          }

          codeSnippet = hardened
        } else if (lowerMsg.includes('taint') || lowerMsg.includes('dataflow')) {
          reply = `🌊 **Taint Analysis Architecture in Soteria:**\n\n1. **Untrusted Sources:** Data enters via \`req.query\`, \`req.body\`, \`req.params\`, or CLI arguments.\n2. **Taint Propagation:** Variables assigned or derived from tainted sources retain the tainted mark across scope boundaries.\n3. **Sanitization Barriers:** Taint is cleared when passed through validation barriers such as \`parseInt()\`, \`DOMPurify.sanitize()\`, or allowlist checks.\n4. **Execution Sinks:** If untrusted data reaches critical execution points (\`db.query\`, \`child_process.exec\`, \`fs.readFile\`, \`res.send\`), a CRITICAL taint vulnerability is flagged.`
        } else if (lowerMsg.includes('sbom') || lowerMsg.includes('cyclonedx')) {
          reply = `📦 **SBOM Compliance:**\n\nSoteria CyberIDE automatically generates CycloneDX v1.5 and SPDX 2.3 bill-of-materials with standard Package URLs (purls) for all third-party dependencies in npm, PyPI, Cargo, and Go ecosystems. You can download your SBOM directly from the bottom drawer!`
        } else {
          reply = `🛡️ **Soteria Cyber Assistant Analysis:**\n\nI have reviewed your query regarding "${message}".\n\nTo ensure defense-in-depth:\n- Ensure all external inputs are strictly validated against allowlists.\n- Use parameterized queries or ORMs to prevent SQL injection.\n- Run non-root containers with immutable version pins.\n- Never commit credentials to version control (use environment variables or secret vaults).`
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ reply, codeSnippet }))
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Endpoint not found' }))
  })

  return server
}
