import { describe, it, expect } from 'bun:test'
import {
  calculateShannonEntropy,
  maskSecret,
  scanTextForSecrets,
  formatSecretReportMarkdown,
} from './SecretScanTool.js'

describe('SecretScanTool', () => {
  it('calculates Shannon entropy accurately', () => {
    // Repeated chars have 0 entropy
    expect(calculateShannonEntropy('aaaaaaaa')).toBe(0)
    // Low entropy string
    const low = calculateShannonEntropy('abcabcabc')
    // High entropy random string
    const high = calculateShannonEntropy('x8*Jk$91Lp!qWz#4')
    expect(high).toBeGreaterThan(low)
    expect(high).toBeGreaterThan(3.5)
  })

  it('masks sensitive secrets safely', () => {
    expect(maskSecret('1234')).toBe('****')
    expect(maskSecret('AKIA1234567890ABCDEF')).toBe('AKIA****CDEF')
  })

  it('detects AWS access keys', () => {
    const code = `const awsKey = "AKIA1234567890ABCDEF";`
    const findings = scanTextForSecrets(code, 'src/config.ts')
    expect(findings.length).toBe(1)
    expect(findings[0].secretType).toBe('AWS Access Key ID')
    expect(findings[0].severity).toBe('CRITICAL')
    expect(findings[0].maskedSecret).toBe('AKIA****CDEF')
  })

  it('detects GitHub personal access tokens', () => {
    const code = `const token = "ghp_123456789012345678901234567890123456";`
    const findings = scanTextForSecrets(code, '.env')
    expect(findings.length).toBe(1)
    expect(findings[0].secretType).toBe('GitHub Personal Access Token')
    expect(findings[0].severity).toBe('CRITICAL')
  })

  it('detects OpenAI and Anthropic API keys', () => {
    const code = `
      const oai = "sk-proj-1234567890123456789012345678901234567890";
      const claude = "sk-ant-api03-1234567890123456789012345678901234567890";
    `
    const findings = scanTextForSecrets(code, 'keys.js')
    expect(findings.length).toBe(2)
    const types = findings.map(f => f.secretType)
    expect(types).toContain('OpenAI API Key')
    expect(types).toContain('Anthropic API Key')
  })

  it('detects database connection URIs containing credentials', () => {
    const code = `const uri = "postgres://admin:SuperSecretPassword123!@db.internal:5432/prod";`
    const findings = scanTextForSecrets(code, 'db.ts')
    expect(findings.length).toBe(1)
    expect(findings[0].secretType).toBe('Database URI with Password')
  })

  it('filters out dummy placeholders', () => {
    const code = `
      const a = "your_api_key_here_placeholder";
      const b = "example_secret_key";
    `
    const findings = scanTextForSecrets(code, 'sample.ts')
    expect(findings.length).toBe(0)
  })

  it('generates a clean markdown report', () => {
    const report = {
      filesScanned: 5,
      secretsFound: 1,
      countsByType: { 'AWS Access Key ID': 1 },
      findings: [
        {
          ruleId: 'aws-access-key',
          secretType: 'AWS Access Key ID',
          file: 'config.ts',
          line: 12,
          maskedSecret: 'AKIA****MPLE',
          severity: 'CRITICAL' as const,
          contextSnippet: 'const awsKey = "AKIAIOSFODNN7EXAMPLE"',
        },
      ],
    }
    const md = formatSecretReportMarkdown(report)
    expect(md).toContain('Secret & Credential Leak Scan Report')
    expect(md).toContain('AKIA****MPLE')
  })
})
