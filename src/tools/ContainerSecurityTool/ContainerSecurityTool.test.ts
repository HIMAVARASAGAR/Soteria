import { describe, it, expect } from 'bun:test'
import {
  scanDockerfile,
  scanDockerCompose,
  formatContainerReportMarkdown,
} from './ContainerSecurityTool.js'

describe('ContainerSecurityTool', () => {
  it('flags Dockerfile running as root and using latest tag', () => {
    const dockerfile = `
FROM node:latest
WORKDIR /app
COPY . .
RUN npm install
CMD ["node", "index.js"]
    `
    const findings = scanDockerfile(dockerfile, 'Dockerfile')
    expect(findings.length).toBe(2)
    const rules = findings.map(f => f.ruleId)
    expect(rules).toContain('dockerfile-user-root')
    expect(rules).toContain('dockerfile-mutable-latest-tag')
  })

  it('flags hardcoded secrets in Dockerfile ENV', () => {
    const dockerfile = `
FROM python:3.11-slim
ENV DB_PASSWORD="SuperSecretProductionPassword!"
USER appuser
CMD ["python", "app.py"]
    `
    const findings = scanDockerfile(dockerfile, 'Dockerfile')
    const secretFinding = findings.find(f => f.ruleId === 'dockerfile-hardcoded-secret')
    expect(secretFinding).toBeDefined()
    expect(secretFinding?.severity).toBe('CRITICAL')
  })

  it('flags SSH port exposed in Dockerfile', () => {
    const dockerfile = `
FROM ubuntu:22.04
EXPOSE 22 80
USER app
    `
    const findings = scanDockerfile(dockerfile, 'Dockerfile')
    const sshFinding = findings.find(f => f.ruleId === 'dockerfile-ssh-port-exposed')
    expect(sshFinding).toBeDefined()
  })

  it('flags dangerous docker-compose options (privileged & docker.sock)', () => {
    const compose = `
services:
  web:
    image: myapp:1.0.0
    privileged: true
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    `
    const findings = scanDockerCompose(compose, 'docker-compose.yml')
    expect(findings.length).toBe(2)
    const rules = findings.map(f => f.ruleId)
    expect(rules).toContain('compose-privileged-container')
    expect(rules).toContain('compose-docker-socket-mounted')
  })

  it('passes hardened Dockerfile with non-root user and pinned tag', () => {
    const dockerfile = `
FROM node:20.11-alpine
RUN adduser -D appuser
USER appuser
WORKDIR /app
COPY --chown=appuser:appuser package.json .
CMD ["node", "server.js"]
    `
    const findings = scanDockerfile(dockerfile, 'Dockerfile')
    const criticalOrHigh = findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')
    expect(criticalOrHigh.length).toBe(0)
  })

  it('formats container report markdown nicely', () => {
    const report = {
      filesScanned: 2,
      totalFindings: 1,
      countsBySeverity: { CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 0 },
      findings: [
        {
          ruleId: 'compose-privileged-container',
          title: 'Privileged container mode enabled',
          severity: 'CRITICAL' as const,
          file: 'docker-compose.yml',
          line: 5,
          snippet: 'privileged: true',
          recommendation: 'Remove privileged flag',
        },
      ],
    }
    const md = formatContainerReportMarkdown(report)
    expect(md).toContain('Container & Dockerfile Security Audit Report')
    expect(md).toContain('docker-compose.yml')
    expect(md).toContain('privileged: true')
  })
})
