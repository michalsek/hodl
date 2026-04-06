import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPackageVersion, runHodl } from '../cli/Hodl.js';

describe('hodl cli', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['version', '--version', '-v'])('prints the package version for %s', async (command) => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runHodl([command]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(getPackageVersion());
  });
});
