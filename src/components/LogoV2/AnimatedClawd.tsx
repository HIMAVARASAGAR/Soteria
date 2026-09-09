import { useEffect, useRef, useState } from 'react';
import { Box } from '../../ink.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { Clawd, type ClawdPose } from './Clawd.js';

type Frame = {
  pose: ClawdPose;
  offset: number;
};

/** Hold a pose for n frames (60ms each). */
function hold(pose: ClawdPose, offset: number, frames: number): Frame[] {
  return Array.from({ length: frames }, () => ({
    pose,
    offset,
  }));
}

// Click animation: crouch, then spring up with both arms raised. Twice.
const JUMP_WAVE: readonly Frame[] = [
  ...hold('default', 1, 2),
  ...hold('arms-up', 0, 4),
  ...hold('default', 0, 1),
  ...hold('default', 1, 2),
  ...hold('arms-up', 0, 4),
  ...hold('default', 0, 1),
];

// Idle animation 1: glance right, glance left, back to center
const LOOK_AROUND: readonly Frame[] = [
  ...hold('look-right', 0, 7),
  ...hold('default', 0, 2),
  ...hold('look-left', 0, 7),
  ...hold('default', 0, 1),
];

// Idle animation 2: double blink
const BLINK: readonly Frame[] = [
  ...hold('blink', 0, 3),
  ...hold('default', 0, 2),
  ...hold('blink', 0, 3),
  ...hold('default', 0, 1),
];

// Idle animation 3: glance left
const GLANCE_LEFT: readonly Frame[] = [
  ...hold('look-left', 0, 9),
  ...hold('default', 0, 1),
];

// Idle animation 4: glance right
const GLANCE_RIGHT: readonly Frame[] = [
  ...hold('look-right', 0, 9),
  ...hold('default', 0, 1),
];

// Idle animation 5: focus scan
const FOCUS_SCAN: readonly Frame[] = [
  ...hold('focus', 0, 8),
  ...hold('default', 0, 2),
];

// Idle animation 6: wink
const WINK: readonly Frame[] = [
  ...hold('wink', 0, 6),
  ...hold('default', 0, 2),
];

const IDLE_ANIMATIONS: readonly (readonly Frame[])[] = [
  LOOK_AROUND,
  BLINK,
  GLANCE_LEFT,
  GLANCE_RIGHT,
  FOCUS_SCAN,
  WINK,
  BLINK,
];

const CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [
  JUMP_WAVE,
  WINK,
  LOOK_AROUND,
  FOCUS_SCAN,
];

const IDLE: Frame = {
  pose: 'default',
  offset: 0,
};

const FRAME_MS = 60;
const incrementFrame = (i: number) => i + 1;
const CLAWD_HEIGHT = 3;

/**
 * Animated Clawd mascot with both click-triggered and periodic idle animations.
 * Moves from time to time: blinks, glances left and right, or does a happy jump.
 */
export function AnimatedClawd() {
  const { pose, bounceOffset, onClick } = useClawdAnimation();

  return (
    <Box height={CLAWD_HEIGHT} flexDirection="column" onClick={onClick} flexShrink={0}>
      <Box marginTop={bounceOffset} flexShrink={0}>
        <Clawd pose={pose} />
      </Box>
    </Box>
  );
}

function useClawdAnimation(): {
  pose: ClawdPose;
  bounceOffset: number;
  onClick: () => void;
} {
  const [reducedMotion] = useState(
    () => getInitialSettings().prefersReducedMotion ?? false,
  );
  const [frameIndex, setFrameIndex] = useState(-1);
  const sequenceRef = useRef<readonly Frame[]>(JUMP_WAVE);

  const onClick = () => {
    if (reducedMotion || frameIndex !== -1) return;
    sequenceRef.current =
      CLICK_ANIMATIONS[Math.floor(Math.random() * CLICK_ANIMATIONS.length)]!;
    setFrameIndex(0);
  };

  // Step through frames of the current animation
  useEffect(() => {
    if (frameIndex === -1) return;
    if (frameIndex >= sequenceRef.current.length) {
      setFrameIndex(-1);
      return;
    }
    const timer = setTimeout(setFrameIndex, FRAME_MS, incrementFrame);
    return () => clearTimeout(timer);
  }, [frameIndex]);

  // Periodic idle animation timer: triggers a subtle movement every 5-10s
  useEffect(() => {
    if (reducedMotion) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const scheduleNext = () => {
      const delay = Math.floor(Math.random() * 5000) + 5000; // 5-10s
      timer = setTimeout(() => {
        if (cancelled) return;
        if (frameIndex === -1) {
          sequenceRef.current =
            IDLE_ANIMATIONS[Math.floor(Math.random() * IDLE_ANIMATIONS.length)]!;
          setFrameIndex(0);
        }
        scheduleNext();
      }, delay);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reducedMotion, frameIndex]);

  const seq = sequenceRef.current;
  const current =
    frameIndex >= 0 && frameIndex < seq.length ? seq[frameIndex]! : IDLE;

  return {
    pose: current.pose,
    bounceOffset: current.offset,
    onClick,
  };
}

export default AnimatedClawd;

