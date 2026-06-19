import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

export const call: LocalCommandCall = async (args, context) => {
  const currentEnabled = context.getAppState().thinkingEnabled ?? true
  const nextState = !currentEnabled

  // Update AppState so the change takes effect in the current session immediately
  context.setAppState(prev => ({
    ...prev,
    thinkingEnabled: nextState,
  }))

  // Persist the preference to settings so it is remembered in future sessions
  updateSettingsForSource('userSettings', {
    alwaysThinkingEnabled: nextState ? undefined : false,
  })

  // Also update global config
  saveGlobalConfig(current => ({
    ...current,
    alwaysThinkingEnabled: nextState ? undefined : false,
  }))

  logEvent('tengu_thinking_toggled', {
    enabled: nextState as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  return {
    type: 'text',
    value: `Thinking mode is now ${nextState ? 'enabled' : 'disabled'}.`,
  }
}
