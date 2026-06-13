import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { classify, safeTokenize } from './tools/classifier.js';
import { sanitizeCommandOutput, fuzzySeverity } from './security/sanitizer.js';
import { hashString, computeHmac } from './utils/crypto.js';
import { ChainLogger, verifyLog } from './storage/chain-logger.js';
import { EventBus } from './runtime/events.js';
import { ToolHistory } from './runtime/history.js';
import { AutoApprovePolicy, DenyAllPolicy, SecurityApprovalPolicy } from './runtime/approval.js';
import { ContextManager } from './runtime/context-manager.js';

describe('CSage v2 Core Systems Suite', () => {

  describe('Command Classifier', () => {
    it('should tokenize commands correctly and handle quotes', () => {
      const tokenResult = safeTokenize('nmap -sV "192.168.1.1" -p 80');
      expect(tokenResult.ok).toBe(true);
      expect(tokenResult.tokens).toEqual(['nmap', '-sV', '192.168.1.1', '-p', '80']);
    });

    it('should reject unclosed quotes in safeTokenize', () => {
      const tokenResult = safeTokenize('nmap -sV "192.168.1.1');
      expect(tokenResult.ok).toBe(false);
      expect(tokenResult.error).toContain('Unclosed double quote');
    });

    it('should classify safe install commands as safe', () => {
      const res = classify('brew install nmap');
      expect(res.safe).toBe(true);
      expect(res.risk).toBe('LOW');
    });

    it('should classify pentest tools as risky', () => {
      const res = classify('nmap -sV 127.0.0.1');
      expect(res.safe).toBe(false);
      expect(res.risk).toBe('HIGH');
    });

    it('should block shell operator injections', () => {
      const res = classify('brew install nmap && rm -rf /');
      expect(res.safe).toBe(false);
      expect(res.risk).toBe('HIGH');
      expect(res.reason).toContain('shell operator');
    });

    it('should block destructive commands', () => {
      const res = classify('rm -rf /etc');
      expect(res.safe).toBe(false);
      expect(res.risk).toBe('HIGH');
      expect(res.reason).toContain('destructive');
    });
  });

  describe('Input/Output Sanitizer', () => {
    it('should strip ANSI escape sequences', () => {
      const raw = '\x1b[31mError:\x1b[0m Failed connection';
      const clean = sanitizeCommandOutput(raw);
      expect(clean).toBe('Error: Failed connection');
    });

    it('should truncate lines and characters', () => {
      const raw = 'line1\nline2\nline3\nline4\nline5';
      const truncated = sanitizeCommandOutput(raw, 2, 20);
      expect(truncated).toContain('[...3 lines omitted]');
    });

    it('should fuzzy map severities correctly', () => {
      expect(fuzzySeverity('FATAL')).toBe('CRITICAL');
      expect(fuzzySeverity('critical')).toBe('CRITICAL');
      expect(fuzzySeverity('MAJOR')).toBe('HIGH');
      expect(fuzzySeverity('minor')).toBe('LOW');
      expect(fuzzySeverity('unknown')).toBe('HIGH'); // conservative fallback
    });
  });

  describe('Cryptography Helpers', () => {
    it('should generate deterministic SHA-256 hashes', () => {
      const str = 'csage-test-vector';
      const h1 = hashString(str);
      const h2 = hashString(str);
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(64);
    });

    it('should compute valid HMAC-SHA256 digests', () => {
      const key = Buffer.from('secret-key');
      const data = 'some-logged-entry';
      const digest = computeHmac(key, '', data);
      expect(digest).toHaveLength(64);
    });
  });

  describe('HMAC Tamper-Evident Logger', () => {
    const testSessionId = 'test-session-12345';
    const logFilePath = join(homedir(), '.csage', 'logs', `${testSessionId}.jsonl`);

    beforeEach(() => {
      // Clear log file if left over
      if (existsSync(logFilePath)) {
        rmSync(logFilePath, { force: true });
      }
    });

    afterEach(() => {
      // Cleanup
      if (existsSync(logFilePath)) {
        rmSync(logFilePath, { force: true });
      }
    });

    it('should create a valid hash-chained log and verify successfully', () => {
      const logger = new ChainLogger(testSessionId);

      // Log events
      logger.logSessionStart('/tmp/path', 'http://127.0.0.1', 'gpt-4o', 'all');
      logger.logCommand('nmap -sV 127.0.0.1', 'MEDIUM', true, true, true);
      logger.logFinding('SQL Injection', 'HIGH', 'http://127.0.0.1/search.php?id=1');
      logger.logSessionEnd(1, 120);

      // Verify the log integrity
      const verifyResult = verifyLog(testSessionId);
      expect(verifyResult.ok).toBe(true);
      expect(verifyResult.message).toContain('verified');
    });
  });

  describe('Runtime - EventBus', () => {
    it('should deliver emitted events to handlers', async () => {
      const bus = new EventBus();
      const seen: string[] = [];
      bus.on((event) => {
        seen.push(event.type);
      });

      await bus.emit({ type: 'text', content: 'hello' });

      expect(seen).toEqual(['text']);
    });

    it('should unsubscribe handlers', async () => {
      const bus = new EventBus();
      let count = 0;
      const unsubscribe = bus.on(() => {
        count += 1;
      });

      unsubscribe();
      await bus.emit({ type: 'text', content: 'hello' });

      expect(count).toBe(0);
    });

    it('should remove all handlers', async () => {
      const bus = new EventBus();
      let count = 0;
      bus.on(() => {
        count += 1;
      });
      bus.removeAll();

      await bus.emit({ type: 'text', content: 'hello' });

      expect(count).toBe(0);
    });
  });

  describe('Runtime - ToolHistory', () => {
    it('should record and return all executions', () => {
      const history = new ToolHistory();
      history.record({
        id: 'exec-1',
        callId: 'call-1',
        name: 'shell_exec',
        arguments: { command: 'nmap 127.0.0.1' },
        status: 'pending',
        iterationIndex: 1,
      });

      expect(history.getAll()).toHaveLength(1);
    });

    it('should update the matching record', () => {
      const history = new ToolHistory();
      history.record({
        id: 'exec-1',
        callId: 'call-1',
        name: 'shell_exec',
        arguments: {},
        status: 'pending',
        iterationIndex: 1,
      });

      history.update('exec-1', { status: 'completed', output: 'done' });

      expect(history.getAll()[0]?.status).toBe('completed');
      expect(history.getAll()[0]?.output).toBe('done');
    });

    it('should filter by tool name', () => {
      const history = new ToolHistory();
      history.record({
        id: 'exec-1',
        callId: 'call-1',
        name: 'shell_exec',
        arguments: {},
        status: 'pending',
        iterationIndex: 1,
      });
      history.record({
        id: 'exec-2',
        callId: 'call-2',
        name: 'read_file',
        arguments: {},
        status: 'pending',
        iterationIndex: 1,
      });

      expect(history.getByTool('read_file')).toHaveLength(1);
    });

    it('should filter by iteration', () => {
      const history = new ToolHistory();
      history.record({
        id: 'exec-1',
        callId: 'call-1',
        name: 'shell_exec',
        arguments: {},
        status: 'pending',
        iterationIndex: 1,
      });
      history.record({
        id: 'exec-2',
        callId: 'call-2',
        name: 'shell_exec',
        arguments: {},
        status: 'pending',
        iterationIndex: 2,
      });

      expect(history.getByIteration(2)).toHaveLength(1);
    });
  });

  describe('Runtime - ApprovalPolicy', () => {
    it('should allow safe install commands', () => {
      const policy = new SecurityApprovalPolicy(classify, async () => true);
      const decision = policy.check({
        name: 'shell_exec',
        arguments: { command: 'brew install nmap' },
      });

      expect(decision.action).toBe('allow');
    });

    it('should ask for pentest tools', () => {
      const policy = new SecurityApprovalPolicy(classify, async () => true);
      const decision = policy.check({
        name: 'shell_exec',
        arguments: { command: 'nmap -sV 127.0.0.1' },
      });

      expect(decision.action).toBe('ask');
    });

    it('should always allow with AutoApprovePolicy', () => {
      const policy = new AutoApprovePolicy();
      expect(policy.check({ name: 'read_file', arguments: {} }).action).toBe('allow');
    });

    it('should always deny with DenyAllPolicy', () => {
      const policy = new DenyAllPolicy();
      expect(policy.check({ name: 'read_file', arguments: {} }).action).toBe('deny');
    });
  });

  describe('Runtime - ContextManager', () => {
    it('should add and return messages', () => {
      const context = new ContextManager('system prompt');
      context.addMessage({ role: 'user', content: 'hello' });

      expect(context.getMessages()).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('should estimate tokens reasonably', () => {
      const context = new ContextManager('12345678');
      context.addMessage({ role: 'user', content: '12345678' });

      expect(context.getTokenEstimate()).toBeGreaterThanOrEqual(4);
    });

    it('should clear messages and keep system prompt', () => {
      const context = new ContextManager('system prompt');
      context.addMessage({ role: 'user', content: 'hello' });

      context.clear();

      expect(context.getMessages()).toHaveLength(0);
      expect(context.getSystemPrompt()).toBe('system prompt');
    });
  });
});
