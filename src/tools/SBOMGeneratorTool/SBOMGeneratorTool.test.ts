import { describe, it, expect } from 'bun:test'
import {
  generatePurl,
  buildCycloneDX,
  buildSPDX,
  formatSBOMMarkdown,
  type SBOMComponent,
} from './SBOMGeneratorTool.js'

describe('SBOMGeneratorTool', () => {
  it('generates standard package URLs (purls)', () => {
    expect(generatePurl('npm', 'lodash', '4.17.21')).toBe('pkg:npm/lodash@4.17.21')
    expect(generatePurl('npm', '@types/node', '^20.0.0')).toBe('pkg:npm/%40types/node@20.0.0')
    expect(generatePurl('pypi', 'Requests', '2.31.0')).toBe('pkg:pypi/requests@2.31.0')
    expect(generatePurl('cargo', 'tokio', '1.35.0')).toBe('pkg:cargo/tokio@1.35.0')
    expect(generatePurl('golang', 'github.com/gin-gonic/gin', 'v1.9.1')).toBe('pkg:golang/github.com/gin-gonic/gin@1.9.1')
  })

  it('builds valid CycloneDX 1.5 JSON', () => {
    const components: SBOMComponent[] = [
      {
        name: 'express',
        version: '4.19.2',
        ecosystem: 'npm',
        purl: 'pkg:npm/express@4.19.2',
      },
    ]
    const cdx = buildCycloneDX('my-app', '1.0.0', components)
    expect(cdx.bomFormat).toBe('CycloneDX')
    expect(cdx.specVersion).toBe('1.5')
    expect(cdx.metadata.component?.name).toBe('my-app')
    expect(cdx.components.length).toBe(1)
    expect(cdx.components[0].purl).toBe('pkg:npm/express@4.19.2')
  })

  it('builds valid SPDX 2.3 JSON', () => {
    const components: SBOMComponent[] = [
      {
        name: 'flask',
        version: '3.0.0',
        ecosystem: 'pypi',
        purl: 'pkg:pypi/flask@3.0.0',
      },
    ]
    const spdx = buildSPDX('python-svc', '2.1.0', components)
    expect(spdx.spdxVersion).toBe('SPDX-2.3')
    expect(spdx.name).toBe('python-svc@2.1.0')
    expect(spdx.packages.length).toBe(1)
    expect(spdx.packages[0].name).toBe('flask')
    expect(spdx.packages[0].externalRefs[0].referenceLocator).toBe('pkg:pypi/flask@3.0.0')
  })

  it('formats SBOM markdown table', () => {
    const components: SBOMComponent[] = [
      {
        name: 'zod',
        version: '3.22.4',
        ecosystem: 'npm',
        purl: 'pkg:npm/zod@3.22.4',
      },
    ]
    const md = formatSBOMMarkdown('soteria-cli', '0.18.5', components)
    expect(md).toContain('Software Bill of Materials (SBOM) Summary')
    expect(md).toContain('soteria-cli@0.18.5')
    expect(md).toContain('pkg:npm/zod@3.22.4')
  })
})
