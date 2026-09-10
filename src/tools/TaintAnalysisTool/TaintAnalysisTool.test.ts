import { describe, it, expect } from 'bun:test'
import {
  analyzeFileForTaint,
  formatTaintReportMarkdown,
} from './TaintAnalysisTool.js'

describe('TaintAnalysisTool', () => {
  it('detects and traces multi-step taint propagation to SQL sink', () => {
    const code = `
      function handleSearch(req, res) {
        const term = req.query.search;
        const sql = "SELECT * FROM items WHERE title = " + term;
        db.query(sql);
      }
    `
    const findings = analyzeFileForTaint(code, 'controllers/search.ts')
    expect(findings.length).toBeGreaterThan(0)
    const f = findings.find(x => x.sinkType === 'SQL_INJECTION')
    expect(f).toBeDefined()
    expect(f?.sinkVariable).toBe('sql')
    expect(f?.trace.length).toBe(3)
    expect(f?.trace[0].description).toContain("Untrusted data source introduced from 'Express / Fastify Query'")
    expect(f?.trace[1].description).toContain("Taint propagated from 'term' to 'sql'")
    expect(f?.trace[2].description).toContain("Tainted variable 'sql' reaches sink 'SQL_INJECTION'")
  })

  it('detects command injection taint flow', () => {
    const code = `
      function deploy(req, res) {
        const target = req.body.branch;
        child_process.exec(target);
      }
    `
    const findings = analyzeFileForTaint(code, 'deploy.ts')
    expect(findings.length).toBe(1)
    expect(findings[0].sinkType).toBe('COMMAND_INJECTION')
    expect(findings[0].severity).toBe('CRITICAL')
  })

  it('detects path traversal taint flow', () => {
    const code = `
      app.get('/download', (req, res) => {
        const filePath = req.query.filename;
        const data = fs.readFileSync(filePath);
        res.send(data);
      });
    `
    const findings = analyzeFileForTaint(code, 'download.ts')
    const pathTrav = findings.find(f => f.sinkType === 'PATH_TRAVERSAL')
    expect(pathTrav).toBeDefined()
  })

  it('recognizes sanitized variables and does not flag them', () => {
    const code = `
      function safeQuery(req, res) {
        const id = parseInt(req.query.id);
        const sql = "SELECT * FROM users WHERE id = " + id;
        db.query(sql);
      }
    `
    const findings = analyzeFileForTaint(code, 'safe.ts')
    expect(findings.length).toBe(0)
  })

  it('formats clean markdown report with trace steps', () => {
    const report = {
      filesAnalyzed: 1,
      flowsDetected: 1,
      findings: [
        {
          sinkType: 'SQL_INJECTION' as const,
          sourceVariable: 'req.query.search',
          sinkVariable: 'sql',
          file: 'search.ts',
          sourceLine: 3,
          sinkLine: 5,
          severity: 'CRITICAL' as const,
          remediation: 'Use parameterized queries',
          trace: [
            {
              stepNumber: 1,
              file: 'search.ts',
              line: 3,
              description: 'Untrusted data source',
              codeSnippet: 'const term = req.query.search;',
            },
            {
              stepNumber: 2,
              file: 'search.ts',
              line: 5,
              description: 'Tainted reaches sink',
              codeSnippet: 'db.query(sql);',
            },
          ],
        },
      ],
    }

    const md = formatTaintReportMarkdown(report)
    expect(md).toContain('Data-Flow Taint Analysis Report')
    expect(md).toContain('SQL_INJECTION')
    expect(md).toContain('Execution Trace')
  })
})
