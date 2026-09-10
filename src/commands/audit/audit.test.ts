import { describe, it, expect } from 'bun:test'
import { calculateSecurityGrade, call } from './audit.js'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

describe('Audit Command', () => {
  it('calculates security grades accurately', () => {
    expect(calculateSecurityGrade(100).grade).toBe('A+')
    expect(calculateSecurityGrade(90).grade).toBe('A')
    expect(calculateSecurityGrade(75).grade).toBe('B')
    expect(calculateSecurityGrade(55).grade).toBe('C')
    expect(calculateSecurityGrade(30).grade).toBe('F')
  })

  it('executes audit and returns formatted report text', async () => {
    const tmpDir = path.join(os.tmpdir(), `test-audit-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })

    // Write a dummy file with a secret and a vulnerable code line
    fs.writeFileSync(
      path.join(tmpDir, 'vuln.ts'),
      `
      const key = "AKIA1234567890ABCDEF";
      export function run(req) {
        eval(req.query.cmd);
      }
      `,
    )

    const result = await call(tmpDir, { cwd: tmpDir } as any)
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('Soteria Comprehensive Cybersecurity Audit')
      expect(result.value).toContain('Security Score:')
      expect(result.value).toContain('AWS Access Key ID')
      expect(result.value).toContain('CWE-95')
    }

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})
