/**
 * Provider detection for the welcome header.
 * Returns a clean model name + provider label for display in the welcome box.
 * This is a React component hook — must be called inside a component.
 */

import * as React from 'react';
import { useMainLoopModel } from '../hooks/useMainLoopModel.js';
import { useAppState } from '../state/AppState.js';
import { getRuntimeMainLoopModel, renderModelName } from './model/model.js';
import { detectProvider } from '../components/StartupScreen.js';

export function useWelcomeProviderInfo(): { model: string; provider: string } {
  const mainLoopModel = useMainLoopModel();
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);

  return React.useMemo(() => {
    const msgs: unknown[] = [];
    const exceeds200k = false;

    const runtimeModel = getRuntimeMainLoopModel({
      permissionMode,
      mainLoopModel,
      exceeds200kTokens: exceeds200k,
    });

    const modelName = renderModelName(runtimeModel);
    const detected = detectProvider();

    return {
      model: modelName,
      provider: detected.name,
    };
  }, [mainLoopModel, permissionMode]);
}
