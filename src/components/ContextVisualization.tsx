import { feature } from 'bun:bundle';
import * as React from 'react';
import { Box, Text } from '../ink.js';
import type { ContextData } from '../utils/analyzeContext.js';
import { generateContextSuggestions } from '../utils/contextSuggestions.js';
import { getDisplayPath } from '../utils/file.js';
import { formatTokens } from '../utils/format.js';
import { getSourceDisplayName, type SettingSource } from '../utils/settings/constants.js';
import { plural } from '../utils/stringUtils.js';
import { ContextSuggestions } from './ContextSuggestions.js';

const RESERVED_CATEGORY_NAME = 'Autocompact buffer';
const SOURCE_DISPLAY_ORDER = ['Project', 'User', 'Managed', 'Plugin', 'Built-in'] as const;

/**
 * One-liner status for context-collapse strategy (when enabled).
 */
function CollapseStatus() {
  if (feature('CONTEXT_COLLAPSE')) {
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const {
        getStats,
        isContextCollapseEnabled,
      } = require('../services/contextCollapse/index.js') as typeof import('../services/contextCollapse/index.js');
      /* eslint-enable @typescript-eslint/no-require-imports */
      if (!isContextCollapseEnabled()) {
        return null;
      }
      const s = getStats();
      const { health: h } = s;
      const parts: string[] = [];
      if (s.collapsedSpans > 0) {
        parts.push(
          `${s.collapsedSpans} ${plural(s.collapsedSpans, 'span')} summarized (${s.collapsedMessages} msgs)`,
        );
      }
      if (s.stagedSpans > 0) {
        parts.push(`${s.stagedSpans} staged`);
      }
      const summary =
        parts.length > 0
          ? parts.join(', ')
          : h.totalSpawns > 0
            ? `${h.totalSpawns} ${plural(h.totalSpawns, 'spawn')}, nothing staged yet`
            : 'waiting for first trigger';
      let errorLine: React.ReactNode = null;
      if (h.totalErrors > 0) {
        errorLine = (
          <Text color="warning">
            Collapse errors: {h.totalErrors}/{h.totalSpawns} spawns failed
            {h.lastError ? ` (last: ${h.lastError.slice(0, 60)})` : ''}
          </Text>
        );
      } else if (h.emptySpawnWarningEmitted) {
        errorLine = (
          <Text color="warning">
            Collapse idle: {h.totalEmptySpawns} consecutive empty runs
          </Text>
        );
      }
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor={true}>Context strategy: collapse ({summary})</Text>
          {errorLine}
        </Box>
      );
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Group items by source type for display, sorted by tokens descending within each group.
 */
function groupBySource<
  T extends {
    source: SettingSource | 'plugin' | 'built-in';
    tokens: number;
  },
>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getSourceDisplayName(item.source);
    const existing = groups.get(key) || [];
    existing.push(item);
    groups.set(key, existing);
  }
  for (const [key, group] of groups.entries()) {
    groups.set(
      key,
      group.sort((a, b) => b.tokens - a.tokens),
    );
  }
  const orderedGroups = new Map<string, T[]>();
  for (const source of SOURCE_DISPLAY_ORDER) {
    const group = groups.get(source);
    if (group) {
      orderedGroups.set(source, group);
    }
  }
  for (const [key, group] of groups.entries()) {
    if (!orderedGroups.has(key)) {
      orderedGroups.set(key, group);
    }
  }
  return orderedGroups;
}

interface Props {
  data: ContextData;
}

export function ContextVisualization({ data }: Props) {
  const {
    categories,
    totalTokens,
    rawMaxTokens,
    percentage,
    model,
    memoryFiles,
    mcpTools,
    agents,
    skills,
    apiUsage,
  } = data;

  const visibleCategories = categories.filter(
    cat =>
      cat.tokens > 0 &&
      cat.name !== 'Free space' &&
      cat.name !== RESERVED_CATEGORY_NAME &&
      !cat.isDeferred,
  );

  const freeCat = categories.find(c => c.name === 'Free space');
  const freeTokens = freeCat ? freeCat.tokens : Math.max(0, rawMaxTokens - totalTokens);
  const freePercent = ((freeTokens / rawMaxTokens) * 100).toFixed(1);

  const autocompactCategory = categories.find(c => c.name === RESERVED_CATEGORY_NAME);
  const hasDeferredMcpTools = categories.some(cat => cat.isDeferred && cat.name.includes('MCP'));

  // Multi-segment progress bar computation
  const BAR_WIDTH = 42;
  const activeSegments: Array<{ name: string; color: any; blocks: number }> = [];
  let allocatedBlocks = 0;

  for (const cat of visibleCategories) {
    const share = cat.tokens / rawMaxTokens;
    let blocks = Math.round(share * BAR_WIDTH);
    if (blocks === 0 && cat.tokens > 0 && allocatedBlocks < BAR_WIDTH) {
      blocks = 1;
    }
    blocks = Math.min(blocks, BAR_WIDTH - allocatedBlocks);
    allocatedBlocks += blocks;
    if (blocks > 0) {
      activeSegments.push({
        name: cat.name,
        color: cat.color || 'cyan',
        blocks,
      });
    }
  }

  let autocompactBlocks = 0;
  if (autocompactCategory && autocompactCategory.tokens > 0) {
    const share = autocompactCategory.tokens / rawMaxTokens;
    autocompactBlocks = Math.min(
      Math.max(1, Math.round(share * BAR_WIDTH)),
      Math.max(0, BAR_WIDTH - allocatedBlocks),
    );
    allocatedBlocks += autocompactBlocks;
  }

  const freeBlocks = Math.max(0, BAR_WIDTH - allocatedBlocks);

  // Suggestions
  const suggestions = generateContextSuggestions(data);

  // Usage color indicator
  const usageColor = percentage >= 80 ? 'error' : percentage >= 60 ? 'warning' : 'success';

  return (
    <Box flexDirection="column" paddingX={1} marginY={1}>
      {/* Overview Main Card */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="inactive"
        paddingX={2}
        paddingY={1}
      >
        {/* Title and Model Header */}
        <Box flexDirection="row" justifyContent="space-between">
          <Box>
            <Text bold={true} color="claudeBlue">
              ⚡ Context Window
            </Text>
            <Text dimColor={true}> · {model}</Text>
          </Box>
          <Box>
            <Text color={usageColor} bold={true}>
              {percentage}%
            </Text>
            <Text dimColor={true}> utilized</Text>
          </Box>
        </Box>

        {/* Token Count Badges */}
        <Box flexDirection="row" marginTop={1} gap={1}>
          <Text>
            Used: <Text bold={true}>{formatTokens(totalTokens)}</Text>
            <Text dimColor={true}> / {formatTokens(rawMaxTokens)} tokens</Text>
          </Text>
          <Text dimColor={true}>·</Text>
          <Text>
            Available: <Text color="success" bold={true}>{formatTokens(freeTokens)}</Text>
            <Text dimColor={true}> tokens ({freePercent}%)</Text>
          </Text>
        </Box>

        {/* Multi-Segment Visual Progress Bar */}
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row" alignItems="center">
            <Text dimColor={true}>[</Text>
            {activeSegments.map(seg => (
              <Text key={seg.name} color={seg.color}>
                {'█'.repeat(seg.blocks)}
              </Text>
            ))}
            {autocompactBlocks > 0 && (
              <Text color="warning">
                {'▨'.repeat(autocompactBlocks)}
              </Text>
            )}
            {freeBlocks > 0 && (
              <Text dimColor={true}>
                {'░'.repeat(freeBlocks)}
              </Text>
            )}
            <Text dimColor={true}>]</Text>
          </Box>
        </Box>

        {/* API Usage / Cache Info (if available) */}
        {apiUsage && (
          <Box flexDirection="row" marginTop={1} gap={2}>
            <Text dimColor={true}>
              Cache: read <Text bold={true}>{formatTokens(apiUsage.cache_read_input_tokens)}</Text>
              {' · '}created <Text bold={true}>{formatTokens(apiUsage.cache_creation_input_tokens)}</Text>
            </Text>
          </Box>
        )}

        {/* Context Collapse Status */}
        <CollapseStatus />

        {/* Category Breakdown Table */}
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between" width="100%" marginBottom={1}>
            <Box width={24}>
              <Text dimColor={true} bold={true}>
                CATEGORY
              </Text>
            </Box>
            <Box width={16}>
              <Text dimColor={true} bold={true}>
                TOKENS
              </Text>
            </Box>
            <Box width={10}>
              <Text dimColor={true} bold={true}>
                SHARE
              </Text>
            </Box>
            <Box flexGrow={1}>
              <Text dimColor={true} bold={true}>
                DISTRIBUTION
              </Text>
            </Box>
          </Box>

          {/* Active Categories */}
          {visibleCategories.map(cat => {
            const catPercent = ((cat.tokens / rawMaxTokens) * 100).toFixed(1);
            const miniBarLen = Math.max(1, Math.min(20, Math.round((cat.tokens / rawMaxTokens) * 20)));
            return (
              <Box key={cat.name} flexDirection="row" justifyContent="space-between" width="100%">
                <Box width={24}>
                  <Text color={cat.color || 'cyan'}>● </Text>
                  <Text>{cat.name}</Text>
                </Box>
                <Box width={16}>
                  <Text dimColor={true}>{formatTokens(cat.tokens)}</Text>
                </Box>
                <Box width={10}>
                  <Text dimColor={true}>{catPercent}%</Text>
                </Box>
                <Box flexGrow={1}>
                  <Text color={cat.color || 'cyan'}>{'━'.repeat(miniBarLen)}</Text>
                </Box>
              </Box>
            );
          })}

          {/* Autocompact Buffer if present */}
          {autocompactCategory && autocompactCategory.tokens > 0 && (
            <Box flexDirection="row" justifyContent="space-between" width="100%">
              <Box width={24}>
                <Text color="warning">▨ </Text>
                <Text dimColor={true}>{autocompactCategory.name}</Text>
              </Box>
              <Box width={16}>
                <Text dimColor={true}>{formatTokens(autocompactCategory.tokens)}</Text>
              </Box>
              <Box width={10}>
                <Text dimColor={true}>
                  {((autocompactCategory.tokens / rawMaxTokens) * 100).toFixed(1)}%
                </Text>
              </Box>
              <Box flexGrow={1}>
                <Text color="warning">
                  {'╌'.repeat(Math.max(1, Math.round((autocompactCategory.tokens / rawMaxTokens) * 20)))}
                </Text>
              </Box>
            </Box>
          )}

          {/* Free Space */}
          <Box flexDirection="row" justifyContent="space-between" width="100%">
            <Box width={24}>
              <Text dimColor={true}>○ Free space</Text>
            </Box>
            <Box width={16}>
              <Text dimColor={true}>{formatTokens(freeTokens)}</Text>
            </Box>
            <Box width={10}>
              <Text dimColor={true}>{freePercent}%</Text>
            </Box>
            <Box flexGrow={1}>
              <Text dimColor={true}>
                {'┄'.repeat(Math.max(1, Math.min(20, Math.round((freeTokens / rawMaxTokens) * 20))))}
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* MCP Tools Section */}
      {mcpTools.length > 0 && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor="inactive"
          paddingX={2}
          paddingY={1}
        >
          <Box flexDirection="row" justifyContent="space-between">
            <Box>
              <Text bold={true} color="magenta">
                🔌 MCP Tools
              </Text>
              <Text dimColor={true}> · /mcp{hasDeferredMcpTools ? ' (on-demand)' : ''}</Text>
            </Box>
            <Text dimColor={true}>
              {mcpTools.length} {plural(mcpTools.length, 'tool')}
            </Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {mcpTools.map((tool, idx) => (
              <Box key={idx} flexDirection="row" justifyContent="space-between">
                <Box>
                  <Text color={tool.isLoaded ? 'success' : 'inactive'}>
                    {tool.isLoaded ? '● ' : '○ '}
                  </Text>
                  <Text>{tool.name}</Text>
                </Box>
                <Text dimColor={true}>{formatTokens(tool.tokens)} tokens</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Skills Section */}
      {skills && skills.tokens > 0 && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor="inactive"
          paddingX={2}
          paddingY={1}
        >
          <Box flexDirection="row" justifyContent="space-between">
            <Box>
              <Text bold={true} color="claudeBlue">
                ⚡ Skills
              </Text>
              <Text dimColor={true}> · /skills</Text>
            </Box>
            <Text dimColor={true}>{formatTokens(skills.tokens)} tokens</Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {Array.from(groupBySource(skills.skillFrontmatter).entries()).map(
              ([source, sourceSkills]) => (
                <Box key={source} flexDirection="column" marginTop={1}>
                  <Text dimColor={true} bold={true}>
                    [{source}]
                  </Text>
                  {sourceSkills.map((skill, idx) => (
                    <Box key={idx} flexDirection="row" justifyContent="space-between" paddingLeft={2}>
                      <Text>• {skill.name}</Text>
                      <Text dimColor={true}>{formatTokens(skill.tokens)} tokens</Text>
                    </Box>
                  ))}
                </Box>
              ),
            )}
          </Box>
        </Box>
      )}

      {/* Memory Files Section */}
      {memoryFiles.length > 0 && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor="inactive"
          paddingX={2}
          paddingY={1}
        >
          <Box flexDirection="row" justifyContent="space-between">
            <Box>
              <Text bold={true} color="warning">
                🧠 Memory Files
              </Text>
              <Text dimColor={true}> · /memory</Text>
            </Box>
            <Text dimColor={true}>
              {memoryFiles.length} {plural(memoryFiles.length, 'file')}
            </Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {memoryFiles.map((file, idx) => (
              <Box key={idx} flexDirection="row" justifyContent="space-between">
                <Text>• {getDisplayPath(file.path)}</Text>
                <Text dimColor={true}>{formatTokens(file.tokens)} tokens</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Custom Agents Section */}
      {agents.length > 0 && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor="inactive"
          paddingX={2}
          paddingY={1}
        >
          <Box flexDirection="row" justifyContent="space-between">
            <Box>
              <Text bold={true} color="info">
                🤖 Custom Agents
              </Text>
              <Text dimColor={true}> · /agents</Text>
            </Box>
            <Text dimColor={true}>
              {agents.length} {plural(agents.length, 'agent')}
            </Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {Array.from(groupBySource(agents).entries()).map(([source, sourceAgents]) => (
              <Box key={source} flexDirection="column" marginTop={1}>
                <Text dimColor={true} bold={true}>
                  [{source}]
                </Text>
                {sourceAgents.map((agent, idx) => (
                  <Box key={idx} flexDirection="row" justifyContent="space-between" paddingLeft={2}>
                    <Text>• @{agent.agentType}</Text>
                    <Text dimColor={true}>{formatTokens(agent.tokens)} tokens</Text>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Optimization Suggestions Card */}
      {suggestions.length > 0 && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor="warning"
          paddingX={2}
          paddingY={1}
        >
          <ContextSuggestions suggestions={suggestions} />
        </Box>
      )}
    </Box>
  );
}
