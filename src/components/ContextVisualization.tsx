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
const MANUAL_COMPACT_BUFFER_NAME = 'Compact buffer';
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
        <Box flexDirection="column" marginTop={0}>
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
    gridRows,
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
      cat.name !== MANUAL_COMPACT_BUFFER_NAME &&
      !cat.isDeferred,
  );

  const freeCat = categories.find(c => c.name === 'Free space');
  const freeTokens = freeCat ? freeCat.tokens : Math.max(0, rawMaxTokens - totalTokens);

  const autocompactCategory = categories.find(
    c => c.name === RESERVED_CATEGORY_NAME || c.name === MANUAL_COMPACT_BUFFER_NAME,
  );
  const hasDeferredMcpTools = categories.some(cat => cat.isDeferred && cat.name.includes('MCP'));

  // Build aligned legend items
  interface LegendItem {
    name: string;
    tokens: number;
    color?: any;
    symbol: string;
    isDeferred?: boolean;
    isDim?: boolean;
  }

  const legendItems: LegendItem[] = [];

  for (const cat of visibleCategories) {
    legendItems.push({
      name: cat.name,
      tokens: cat.tokens,
      color: cat.color,
      symbol: '⛁',
      isDeferred: cat.isDeferred,
    });
  }

  if (autocompactCategory && autocompactCategory.tokens > 0) {
    legendItems.push({
      name: autocompactCategory.name,
      tokens: autocompactCategory.tokens,
      color: autocompactCategory.color,
      symbol: '⛝',
      isDim: true,
    });
  }

  if (freeTokens > 0) {
    legendItems.push({
      name: 'Free space',
      tokens: freeTokens,
      symbol: '⛶',
      isDim: true,
    });
  }

  const maxLabelLen = legendItems.length > 0 ? Math.max(...legendItems.map(i => `${i.name}:`.length)) : 12;
  const maxTokensLen = legendItems.length > 0 ? Math.max(...legendItems.map(i => formatTokens(i.tokens).length)) : 4;

  const usageColor = percentage >= 80 ? 'error' : percentage >= 60 ? 'warning' : undefined;

  const suggestions = generateContextSuggestions(data);

  const loadedMcpTools = mcpTools.filter(t => t.isLoaded);
  const deferredMcpTools = mcpTools.filter(t => !t.isLoaded);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {/* Title */}
      <Box marginBottom={1}>
        <Text bold={true}>Context Usage</Text>
      </Box>

      {/* Grid and Summary Side-by-Side */}
      <Box flexDirection="row" gap={2}>
        {/* Left Column: 2D Grid */}
        <Box flexDirection="column" flexShrink={0}>
          {gridRows.map((row, rowIndex) => (
            <Text key={rowIndex}>
              {row.map((square, colIndex) => {
                if (square.categoryName === 'Free space') {
                  return (
                    <Text key={colIndex} dimColor={true}>
                      {'⛶ '}
                    </Text>
                  );
                }
                if (
                  square.categoryName === RESERVED_CATEGORY_NAME ||
                  square.categoryName === MANUAL_COMPACT_BUFFER_NAME
                ) {
                  return (
                    <Text key={colIndex} color={square.color}>
                      {'⛝ '}
                    </Text>
                  );
                }
                return (
                  <Text key={colIndex} color={square.color}>
                    {square.squareFullness >= 0.7 ? '⛁ ' : '⛀ '}
                  </Text>
                );
              })}
            </Text>
          ))}
        </Box>

        {/* Right Column: Model Stats & Aligned Category Breakdown */}
        <Box flexDirection="column" flexShrink={0}>
          <Box flexDirection="row">
            <Text bold={true}>{model}</Text>
            <Text dimColor={true}> · </Text>
            <Text bold={true} color={usageColor}>
              {formatTokens(totalTokens)}
            </Text>
            <Text dimColor={true}>
              /{formatTokens(rawMaxTokens)} ({percentage}%)
            </Text>
          </Box>

          {apiUsage && (apiUsage.cache_read_input_tokens > 0 || apiUsage.cache_creation_input_tokens > 0) && (
            <Box marginTop={0}>
              <Text dimColor={true}>
                Cache: read <Text bold={true}>{formatTokens(apiUsage.cache_read_input_tokens)}</Text>
                {' · '}created <Text bold={true}>{formatTokens(apiUsage.cache_creation_input_tokens)}</Text>
              </Text>
            </Box>
          )}

          <CollapseStatus />

          <Box marginTop={1} marginBottom={0}>
            <Text dimColor={true} italic={true}>
              Estimated usage by category
            </Text>
          </Box>

          {legendItems.map((item, index) => {
            const label = `${item.name}:`.padEnd(maxLabelLen, ' ');
            const tokenDisplay = formatTokens(item.tokens).padStart(maxTokensLen, ' ');
            const percentDisplay = item.isDeferred
              ? '   N/A'
              : `${((item.tokens / rawMaxTokens) * 100).toFixed(1)}%`.padStart(6, ' ');
            return (
              <Box key={index} flexDirection="row">
                <Text color={item.color} dimColor={item.isDim}>
                  {item.symbol}
                </Text>
                <Text dimColor={item.isDim}> {label} </Text>
                <Text bold={!item.isDim}>{tokenDisplay}</Text>
                <Text dimColor={true}> tokens ({percentDisplay})</Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* MCP Tools */}
      {mcpTools.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text bold={true}>MCP tools</Text>
            <Text dimColor={true}>
              {' '}· /mcp{hasDeferredMcpTools ? ' (loaded on-demand)' : ''}
            </Text>
          </Box>
          {hasDeferredMcpTools ? (
            <>
              {loadedMcpTools.length > 0 && (
                <Box flexDirection="column" marginTop={0}>
                  <Text dimColor={true}>Loaded</Text>
                  {loadedMcpTools.map((tool, i) => (
                    <Box key={i}>
                      <Text>└ {tool.name}: </Text>
                      <Text dimColor={true}>{formatTokens(tool.tokens)} tokens</Text>
                    </Box>
                  ))}
                </Box>
              )}
              {deferredMcpTools.length > 0 && (
                <Box flexDirection="column" marginTop={0}>
                  <Text dimColor={true}>Available</Text>
                  {deferredMcpTools.slice(0, 10).map((tool, i) => (
                    <Box key={i}>
                      <Text dimColor={true}>└ {tool.name}</Text>
                    </Box>
                  ))}
                  {deferredMcpTools.length > 10 && (
                    <Box>
                      <Text dimColor={true}>
                        └ ... and {deferredMcpTools.length - 10} more (run /mcp to view all)
                      </Text>
                    </Box>
                  )}
                </Box>
              )}
            </>
          ) : (
            <Box flexDirection="column" marginTop={0}>
              {mcpTools.map((tool, i) => (
                <Box key={i}>
                  <Text>└ {tool.name}: </Text>
                  <Text dimColor={true}>{formatTokens(tool.tokens)} tokens</Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Custom Agents */}
      {agents.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text bold={true}>Custom agents</Text>
            <Text dimColor={true}> · /agents</Text>
          </Box>
          {Array.from(groupBySource(agents).entries()).map(([source, sourceAgents]) => (
            <Box key={source} flexDirection="column" marginTop={0}>
              <Text dimColor={true}>[{source}]</Text>
              {sourceAgents.map((agent, i) => (
                <Box key={i}>
                  <Text>└ @{agent.agentType}: </Text>
                  <Text dimColor={true}>{formatTokens(agent.tokens)} tokens</Text>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )}

      {/* Memory Files */}
      {memoryFiles.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text bold={true}>Memory files</Text>
            <Text dimColor={true}> · /memory</Text>
          </Box>
          {memoryFiles.map((file, i) => (
            <Box key={i}>
              <Text>└ {getDisplayPath(file.path)}: </Text>
              <Text dimColor={true}>{formatTokens(file.tokens)} tokens</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Skills */}
      {skills && skills.tokens > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text bold={true}>Skills</Text>
            <Text dimColor={true}> · /skills</Text>
          </Box>
          {Array.from(groupBySource(skills.skillFrontmatter).entries()).map(
            ([source, sourceSkills]) => (
              <Box key={source} flexDirection="column" marginTop={0}>
                <Text dimColor={true}>[{source}]</Text>
                {sourceSkills.map((skill, i) => (
                  <Box key={i}>
                    <Text>└ {skill.name}: </Text>
                    <Text dimColor={true}>{formatTokens(skill.tokens)} tokens</Text>
                  </Box>
                ))}
              </Box>
            ),
          )}
        </Box>
      )}

      {/* Optimization Suggestions */}
      {suggestions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <ContextSuggestions suggestions={suggestions} />
        </Box>
      )}
    </Box>
  );
}
