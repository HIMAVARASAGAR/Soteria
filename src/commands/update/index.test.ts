import { describe, expect, it, mock } from 'bun:test';

(globalThis as any).MACRO = {
  PACKAGE_URL: '@himavarasagar/soteria',
  VERSION: '0.18.4',
  DISPLAY_VERSION: '0.18.4',
};

let mockLatestVersion: string | null = '0.18.4';
let mockInstallStatus = 'success';

mock.module('../../utils/autoUpdater.js', () => ({
  getLatestVersion: async () => mockLatestVersion,
  installGlobalPackage: async () => mockInstallStatus,
  getMaxVersion: async () => undefined,
  shouldSkipVersion: () => false,
}));

import updateCommand from './index.js';

describe('/update command', () => {
  it('reports up to date when latest version is same or older', async () => {
    mockLatestVersion = '0.18.4';
    const loaded = await updateCommand.load();
    const result = await loaded.call('', {} as any);
    expect(result.type).toBe('text');
    expect(result.value).toContain('Soteria is up to date (v0.18.4)');
  });

  it('installs update when a newer version is available', async () => {
    mockLatestVersion = '0.18.5';
    mockInstallStatus = 'success';
    const loaded = await updateCommand.load();
    const result = await loaded.call('', {} as any);
    expect(result.type).toBe('text');
    expect(result.value).toContain('Successfully updated Soteria from v0.18.4 to v0.18.5');
  });

  it('notifies user when elevated permissions are needed', async () => {
    mockLatestVersion = '0.18.5';
    mockInstallStatus = 'no_permissions';
    const loaded = await updateCommand.load();
    const result = await loaded.call('', {} as any);
    expect(result.type).toBe('text');
    expect(result.value).toContain('requires elevated permissions');
  });

  it('handles unreachable registry gracefully', async () => {
    mockLatestVersion = null;
    const loaded = await updateCommand.load();
    const result = await loaded.call('', {} as any);
    expect(result.type).toBe('text');
    expect(result.value).toContain('Unable to reach the npm registry');
  });
});
