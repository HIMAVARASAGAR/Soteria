import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { BRAND_ACCENT_RGB } from '../../constants/brand.js';

export type ClawdPose =
  | 'default'
  | 'blink'
  | 'look-left'
  | 'look-right'
  | 'arms-up'
  | 'focus'
  | 'wink';

type Props = {
  pose?: ClawdPose;
};

const EYE_COLOR = 'rgb(56,189,248)'; // Luminous cyan

type PoseStructure = {
  top: string;
  midLeft: string;
  eyes: string;
  midRight: string;
  bottom: string;
};

const POSES: Record<ClawdPose, PoseStructure> = {
  default: {
    top: '  ◢▄▄▄▄▄▄◣  ',
    midLeft: ' ▐█ ',
    eyes: '●  ●',
    midRight: ' █▌ ',
    bottom: '  ▀█▄▄▄▄█▀  ',
  },
  blink: {
    top: '  ◢▄▄▄▄▄▄◣  ',
    midLeft: ' ▐█ ',
    eyes: '─  ─',
    midRight: ' █▌ ',
    bottom: '  ▀█▄▄▄▄█▀  ',
  },
  'look-left': {
    top: '  ◢▄▄▄▄▄▄◣  ',
    midLeft: ' ▐█',
    eyes: '●  ● ',
    midRight: ' █▌ ',
    bottom: '  ▀█▄▄▄▄█▀  ',
  },
  'look-right': {
    top: '  ◢▄▄▄▄▄▄◣  ',
    midLeft: ' ▐█ ',
    eyes: ' ●  ●',
    midRight: '█▌ ',
    bottom: '  ▀█▄▄▄▄█▀  ',
  },
  'arms-up': {
    top: ' ◢█▀▄▄▄▄▀█◣ ',
    midLeft: ' ▐█ ',
    eyes: '^  ^',
    midRight: ' █▌ ',
    bottom: '  ▀█▄▄▄▄█▀  ',
  },
  focus: {
    top: '  ◢▄▄▄▄▄▄◣  ',
    midLeft: ' ▐█ ',
    eyes: '◎  ◎',
    midRight: ' █▌ ',
    bottom: '  ▀█▄▄▄▄█▀  ',
  },
  wink: {
    top: '  ◢▄▄▄▄▄▄◣  ',
    midLeft: ' ▐█ ',
    eyes: '●  ─',
    midRight: ' █▌ ',
    bottom: '  ▀█▄▄▄▄█▀  ',
  },
};

export function Clawd({ pose = 'default' }: Props) {
  const p = POSES[pose] ?? POSES.default;
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text color={BRAND_ACCENT_RGB}>{p.top}</Text>
      <Box flexDirection="row">
        <Text color={BRAND_ACCENT_RGB}>{p.midLeft}</Text>
        <Text bold color={EYE_COLOR}>{p.eyes}</Text>
        <Text color={BRAND_ACCENT_RGB}>{p.midRight}</Text>
      </Box>
      <Text color={BRAND_ACCENT_RGB}>{p.bottom}</Text>
    </Box>
  );
}

export default Clawd;

