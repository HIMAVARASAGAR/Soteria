import figures from 'figures';
import * as React from 'react';
import { Box, Text } from '../ink.js';
import type { ContextSuggestion } from '../utils/contextSuggestions.js';
import { formatTokens } from '../utils/format.js';
import { StatusIcon } from './design-system/StatusIcon.js';

type Props = {
  suggestions: ContextSuggestion[];
};

export function ContextSuggestions({ suggestions }: Props) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold={true} color="yellow">
          💡 Optimization Suggestions
        </Text>
      </Box>
      {suggestions.map((suggestion, i) => (
        <Box key={i} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
          <Box flexDirection="row" alignItems="center">
            <StatusIcon status={suggestion.severity} withSpace={true} />
            <Text bold={true}>{suggestion.title}</Text>
            {suggestion.savingsTokens ? (
              <Text color="success" bold={true}>
                {' '}
                [save ~{formatTokens(suggestion.savingsTokens)} tokens]
              </Text>
            ) : null}
          </Box>
          <Box marginLeft={2}>
            <Text dimColor={true}>{suggestion.detail}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
