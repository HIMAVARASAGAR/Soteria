import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import axios from 'axios';

// Set up MACRO global before importing autoUpdater
(globalThis as any).MACRO = {
  PACKAGE_URL: '@himavarasagar/soteria',
  VERSION: '0.18.4',
  DISPLAY_VERSION: '0.18.4',
};

import { getLatestVersion, getNpmDistTags } from './autoUpdater.js';

describe('autoUpdater registry check', () => {
  const originalGet = axios.get;

  afterEach(() => {
    axios.get = originalGet;
  });

  it('fetches latest version from npm registry via HTTP', async () => {
    axios.get = mock(async () => {
      return {
        status: 200,
        data: {
          'dist-tags': {
            latest: '0.18.2',
            stable: '0.18.1',
          },
        },
      };
    }) as any;

    const latest = await getLatestVersion('latest');
    expect(latest).toBe('0.18.2');
  });

  it('fetches stable tag when requested', async () => {
    axios.get = mock(async () => {
      return {
        status: 200,
        data: {
          'dist-tags': {
            latest: '0.18.2',
            stable: '0.18.1',
          },
        },
      };
    }) as any;

    const stable = await getLatestVersion('stable');
    expect(stable).toBe('0.18.1');
  });

  it('getNpmDistTags parses latest and stable tags correctly', async () => {
    axios.get = mock(async () => {
      return {
        status: 200,
        data: {
          'dist-tags': {
            latest: '0.18.2',
            stable: '0.18.0',
          },
        },
      };
    }) as any;

    const tags = await getNpmDistTags();
    expect(tags.latest).toBe('0.18.2');
    expect(tags.stable).toBe('0.18.0');
  });
});
