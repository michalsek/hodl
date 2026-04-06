import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { version?: string };

describe('hodl cli', () => {
  it.each(['version', '--version', '-v'])(
    'prints the package version for %s',
    async (command) => {
      const result = await runCli(command);
      expect(result).toBe(packageVersion.version);
    }
  );

  it('prints the version when invoked through a symlinked entrypoint', async () => {
    const symlinkPath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), 'hodl-cli-')),
      'Hodl.ts'
    );
    await fs.symlink(
      '/Users/michalsek/Documents/home/hodl/src/cli/Hodl.ts',
      symlinkPath
    );

    const result = await runCli('version', symlinkPath);
    expect(result).toBe(packageVersion.version);
  });
});

const execFileAsync = promisify(execFile);

async function runCli(
  command: string,
  entrypoint = '/Users/michalsek/Documents/home/hodl/src/cli/Hodl.ts'
) {
  const { stdout } = await execFileAsync(
    './node_modules/.bin/tsx',
    [entrypoint, command],
    {
      cwd: '/Users/michalsek/Documents/home/hodl',
    }
  );

  return stdout.trim();
}
