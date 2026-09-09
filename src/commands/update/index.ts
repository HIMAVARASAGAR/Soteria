import type { Command, LocalCommandCall } from '../../types/command.js';
import chalk from 'chalk';
import { getLatestVersion, installGlobalPackage } from '../../utils/autoUpdater.js';
import { gt } from '../../utils/semver.js';

const call: LocalCommandCall = async () => {
  const currentVersion = MACRO.DISPLAY_VERSION ?? MACRO.VERSION;
  const channel = 'latest';

  const latest = await getLatestVersion(channel);
  if (!latest) {
    return {
      type: 'text',
      value: chalk.yellow(
        `Unable to reach the npm registry to check for updates.\n` +
          `Please verify your internet connection or update manually:\n` +
          `  npm install -g ${MACRO.PACKAGE_URL}@latest`,
      ),
    };
  }

  if (!gt(latest, currentVersion)) {
    return {
      type: 'text',
      value: chalk.green(`✓ Soteria is up to date (v${currentVersion}).`),
    };
  }

  // An update is available!
  const status = await installGlobalPackage(latest);
  if (status === 'success') {
    return {
      type: 'text',
      value: chalk.green(
        `✓ Successfully updated Soteria from v${currentVersion} to v${latest}!\n` +
          `Please restart Soteria to run the new version.`,
      ),
    };
  }

  if (status === 'no_permissions') {
    return {
      type: 'text',
      value: chalk.yellow(
        `Update available (v${currentVersion} → v${latest}), but global install requires elevated permissions.\n` +
          `Please run in your terminal:\n` +
          `  npm install -g ${MACRO.PACKAGE_URL}@latest\n` +
          `(or with sudo on macOS/Linux)`,
      ),
    };
  }

  if (status === 'in_progress') {
    return {
      type: 'text',
      value: chalk.yellow(
        `Another update process is currently running. Please wait a moment.`,
      ),
    };
  }

  return {
    type: 'text',
    value: chalk.red(
      `Failed to install update automatically.\n` +
        `Please update manually from your terminal:\n` +
        `  npm install -g ${MACRO.PACKAGE_URL}@latest`,
    ),
  };
};

const update: Command = {
  type: 'local',
  name: 'update',
  description: 'Check for updates and automatically update Soteria to the latest version',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
};

export default update;
