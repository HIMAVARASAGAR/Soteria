import type { Notification } from 'src/context/notifications.js'
import { validateActiveProviderProfileModel } from 'src/utils/providerModelValidation.js'
import { useStartupNotification } from './useStartupNotification.js'

export function useProviderModelValidationNotification(): void {
  useStartupNotification(async (): Promise<Notification | null> => {
    const result = await validateActiveProviderProfileModel()
    if (result.state !== 'missing') {
      return null
    }

    return {
      key: 'provider-model-missing',
      text: `Saved model ${result.model} is not available for ${result.providerName}. Run /model to choose another model.`,
      color: 'warning',
      priority: 'high',
      timeoutMs: 12_000,
    }
  })
}
