import { describe, it, expect } from 'bun:test'
import { parsePackageJson, parseRequirementsTxt, formatAuditMarkdown } from './AuditDependenciesTool.js'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('AuditDependenciesTool', () => {
  it('parses dependencies from package.json correctly', () => {
    const tmp = path.join(os.tmpdir(), `test-pkg-${Date.now()}.json`)
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        dependencies: {
          lodash: '^4.17.20',
          express: '4.18.2',
        },
        devDependencies: {
          typescript: '~5.0.0',
        },
      }),
    )

    const specs = parsePackageJson(tmp)
    fs.unlinkSync(tmp)

    expect(specs.length).toBe(3)
    expect(specs.find(s => s.name === 'lodash')?.version).toBe('4.17.20')
    expect(specs.find(s => s.name === 'express')?.version).toBe('4.18.2')
    expect(specs.find(s => s.name === 'typescript')?.version).toBe('5.0.0')
  })

  it('parses requirements.txt correctly', () => {
    const tmp = path.join(os.tmpdir(), `test-req-${Date.now()}.txt`)
    fs.writeFileSync(tmp, `
# Core dependencies
flask==2.0.1
requests>=2.25.1
django~=3.2.0
# Commented line
# boto3==1.18.0
    `)

    const specs = parseRequirementsTxt(tmp)
    fs.unlinkSync(tmp)

    expect(specs.length).toBe(3)
    expect(specs.find(s => s.name === 'flask')?.version).toBe('2.0.1')
    expect(specs.find(s => s.name === 'requests')?.version).toBe('2.25.1')
    expect(specs.find(s => s.name === 'django')?.version).toBe('3.2.0')
  })

  it('formats clean markdown report', () => {
    const report = {
      totalScanned: 10,
      vulnerabilitiesFound: 1,
      countsBySeverity: { critical: 1, high: 0, moderate: 0, low: 0 },
      manifestFiles: ['package.json'],
      findings: [
        {
          id: 'GHSA-35jh-r3h4-6jhm',
          packageName: 'lodash',
          ecosystem: 'npm',
          installedVersion: '4.17.20',
          severity: 'CRITICAL' as const,
          summary: 'Command Injection in lodash',
          affectedVersions: '<4.17.21',
          fixedVersion: '4.17.21',
          advisoryUrl: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm',
        },
      ],
    }

    const md = formatAuditMarkdown(report)
    expect(md).toContain('Dependency Security Audit Report')
    expect(md).toContain('CRITICAL')
    expect(md).toContain('lodash')
    expect(md).toContain('4.17.21')
  })
})
