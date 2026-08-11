import React from 'react';
import { Box, Text } from 'src/ink.js';
import { BRAND_NAME, BRAND_TAGLINE, BRAND_ACCENT_RGB } from '../../constants/brand.js';

/**
 * Clean welcome screen — minimal, no ASCII art, no clutter.
 * Shows: brand name, tagline, version, quick help.
 */
export function WelcomeV2() {
  return <Box flexDirection="column" paddingLeft={2}>
    <Text> </Text>
    <Text>{'  '}<Text color={BRAND_ACCENT_RGB} bold>{BRAND_NAME}</Text><Text dimColor> {'·'} {BRAND_TAGLINE}</Text></Text>
    <Text> </Text>
    <Text dimColor>{'  '}v{MACRO.DISPLAY_VERSION ?? MACRO.VERSION}</Text>
    <Text> </Text>
  </Box>;
}
