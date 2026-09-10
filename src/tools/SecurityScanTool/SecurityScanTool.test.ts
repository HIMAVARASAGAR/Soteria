import { describe, it, expect } from 'bun:test'
import {
  scanCodeForVulnerabilities,
  formatSASTReportMarkdown,
} from './SecurityScanTool.js'

describe('SecurityScanTool', () => {
  it('detects SQL injection in JavaScript / TypeScript', () => {
    const code = `
      export async function getUser(req, res) {
        const id = req.query.id;
        const result = await db.query(\`SELECT * FROM users WHERE id = '\${id}'\`);
        return res.json(result);
      }
    `
    const findings = scanCodeForVulnerabilities(code, 'controllers/user.ts')
    expect(findings.length).toBe(1)
    expect(findings[0].cwe).toBe('CWE-89')
    expect(findings[0].severity).toBe('CRITICAL')
  })

  it('detects command injection via child_process', () => {
    const code = `
      import cp from 'child_process';
      function runBackup(folder) {
        cp.exec('tar -czf backup.tar.gz ' + folder);
      }
    `
    const findings = scanCodeForVulnerabilities(code, 'backup.js')
    expect(findings.length).toBe(1)
    expect(findings[0].cwe).toBe('CWE-78')
    expect(findings[0].severity).toBe('CRITICAL')
  })

  it('detects dynamic code execution (eval)', () => {
    const code = `
      const computed = eval(userInput);
    `
    const findings = scanCodeForVulnerabilities(code, 'parser.ts')
    expect(findings.length).toBe(1)
    expect(findings[0].cwe).toBe('CWE-95')
  })

  it('detects insecure MD5 / SHA-1 hashing', () => {
    const code = `
      import crypto from 'crypto';
      const hash = crypto.createHash('md5').update(pwd).digest('hex');
    `
    const findings = scanCodeForVulnerabilities(code, 'auth.ts')
    expect(findings.length).toBe(1)
    expect(findings[0].cwe).toBe('CWE-328')
    expect(findings[0].severity).toBe('HIGH')
  })

  it('detects disabled TLS verification', () => {
    const code = `
      const agent = new https.Agent({ rejectUnauthorized: false });
    `
    const findings = scanCodeForVulnerabilities(code, 'api.ts')
    expect(findings.length).toBe(1)
    expect(findings[0].cwe).toBe('CWE-295')
  })

  it('ignores comments and safe code', () => {
    const code = `
      // const result = await db.query(\`SELECT * FROM users WHERE id = '\${id}'\`);
      // eval(something)
      const safe = "SELECT * FROM users WHERE id = $1";
      const hash = crypto.createHash('sha256').update(data).digest('hex');
    `
    const findings = scanCodeForVulnerabilities(code, 'safe.ts')
    expect(findings.length).toBe(0)
  })

  it('formats SAST report markdown nicely', () => {
    const report = {
      filesScanned: 3,
      totalFindings: 1,
      countsBySeverity: { CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 0 },
      countsByCwe: { 'CWE-89': 1 },
      findings: [
        {
          ruleId: 'sast-sql-injection-template',
          cwe: 'CWE-89',
          title: 'SQL Injection via Template String',
          severity: 'CRITICAL' as const,
          file: 'user.ts',
          line: 4,
          snippet: 'db.query(`SELECT * FROM users WHERE id = ${id}`)',
          recommendation: 'Use parameterized queries',
        },
      ],
    }
    const md = formatSASTReportMarkdown(report)
    expect(md).toContain('Static Application Security Testing (SAST) Report')
    expect(md).toContain('CWE-89')
  })
})
