import { describe, it, expect, afterAll, beforeAll } from 'bun:test'
import { createCyberIdeServer, buildFileTree } from './cyberIdeServer.js'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { Readable } from 'stream'

function simulateRequest(
  server: http.Server,
  method: string,
  requestUrl: string,
  bodyData?: any,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const stream = new Readable({
      read() {
        if (bodyData) {
          const str = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData)
          this.push(str)
        }
        this.push(null)
      },
    })

    const req = Object.assign(stream, {
      url: requestUrl,
      method,
      headers: {
        'content-type': 'application/json',
      },
    }) as unknown as http.IncomingMessage

    const res = new http.ServerResponse(req)
    let body = ''
    const headers: Record<string, string> = {}

    res.writeHead = (statusCode: number, ...args: any[]) => {
      res.statusCode = statusCode
      if (args[0] && typeof args[0] === 'object') {
        Object.assign(headers, args[0])
      }
      return res
    }

    res.setHeader = (key: string, val: any) => {
      headers[key.toLowerCase()] = String(val)
      return res
    }

    res.write = (chunk: any) => {
      body += chunk
      return true
    }

    res.end = (chunk: any) => {
      if (chunk) body += chunk
      resolve({ status: res.statusCode || 200, headers, body })
      return res
    }

    server.emit('request', req, res)
  })
}

describe('CyberIdeServer', () => {
  let server: http.Server
  let tmpDir: string

  beforeAll(() => {
    tmpDir = path.join(os.tmpdir(), `test-ide-server-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })

    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-cyber-project', version: '1.2.3', dependencies: { lodash: '4.17.21' } }),
    )

    fs.writeFileSync(
      path.join(tmpDir, 'server.ts'),
      `
      const secretKey = "AKIA1234567890ABCDEF";
      export function handle(req, res) {
        const query = req.query.q;
        const sql = "SELECT * FROM users WHERE name = " + query;
        db.query(sql);
        eval(req.query.cmd);
      }
      `,
    )

    server = createCyberIdeServer(tmpDir)
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('builds recursive file tree correctly', () => {
    const tree = buildFileTree(tmpDir)
    expect(tree.length).toBeGreaterThan(0)
    const fileNames = tree.map(t => t.name)
    expect(fileNames).toContain('package.json')
    expect(fileNames).toContain('server.ts')
  })

  it('serves the CyberIDE HTML frontend on /', async () => {
    const res = await simulateRequest(server, 'GET', '/')
    expect(res.status).toBe(200)
    expect(res.body).toContain('Soteria')
    expect(res.body).toContain('CyberIDE')
    expect(res.body).toContain('monaco')
  })

  it('responds to /api/health', async () => {
    const res = await simulateRequest(server, 'GET', '/api/health')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.status).toBe('ok')
    expect(data.workspace).toBe(tmpDir)
  })

  it('reads and writes files via /api/files/read and /api/files/write', async () => {
    // Write new file
    const writeRes = await simulateRequest(server, 'POST', '/api/files/write', {
      path: 'notes.txt',
      content: 'Cyber security notes',
    })
    expect(writeRes.status).toBe(200)
    const writeData = JSON.parse(writeRes.body)
    expect(writeData.success).toBe(true)

    // Read back
    const readRes = await simulateRequest(server, 'GET', '/api/files/read?path=notes.txt')
    expect(readRes.status).toBe(200)
    const readData = JSON.parse(readRes.body)
    expect(readData.content).toBe('Cyber security notes')
  })

  it('scans a file and returns Monaco-compatible markers', async () => {
    const vulnContent = `
      const key = "AKIA1234567890ABCDEF";
      eval(userInput);
    `
    const res = await simulateRequest(server, 'POST', '/api/security/scan-file', {
      path: 'test.ts',
      content: vulnContent,
    })
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(Array.isArray(data.markers)).toBe(true)
    expect(data.markers.length).toBeGreaterThanOrEqual(2)

    const secretMarker = data.markers.find((m: any) => m.source === 'Soteria Secrets')
    expect(secretMarker).toBeDefined()
    expect(secretMarker.severity).toBe(8) // Error

    const sastMarker = data.markers.find((m: any) => m.source === 'Soteria SAST')
    expect(sastMarker).toBeDefined()
    expect(sastMarker.code).toBe('CWE-95')
  })

  it('runs full workspace audit via /api/security/audit', async () => {
    const res = await simulateRequest(server, 'POST', '/api/security/audit')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.score).toBeDefined()
    expect(data.grade).toBeDefined()
    expect(data.secrets.length).toBeGreaterThan(0)
    expect(data.sast.length).toBeGreaterThan(0)
    expect(data.components.length).toBeGreaterThan(0)
  })

  it('serves CycloneDX SBOM download', async () => {
    const res = await simulateRequest(server, 'GET', '/api/sbom/download?format=cyclonedx')
    expect(res.status).toBe(200)
    const cdx = JSON.parse(res.body)
    expect(cdx.bomFormat).toBe('CycloneDX')
    expect(cdx.components.length).toBe(1)
    expect(cdx.components[0].name).toBe('lodash')
  })

  it('provides AI remediation via /api/agent/chat', async () => {
    const res = await simulateRequest(server, 'POST', '/api/agent/chat', {
      message: 'Fix the vulnerabilities in this file',
      activeFile: 'vuln.js',
      activeFileContent: 'const r = eval(x);',
    })
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.reply).toContain('OWASP')
    expect(data.codeSnippet).toContain('JSON.parse(x)')
  })
})
