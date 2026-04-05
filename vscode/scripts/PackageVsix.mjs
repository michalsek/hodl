import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const packageRoot = path.resolve(__dirname, '..');
const artifactsDirectory = path.join(packageRoot, '.artifacts');
const stageDirectory = path.join(artifactsDirectory, 'vsix-stage');
const outputPath = path.join(artifactsDirectory, 'hodl-vscode-plugin.vsix');
const vsceCliPath = require.resolve('@vscode/vsce/vsce');

await fs.rm(stageDirectory, { recursive: true, force: true });
await fs.mkdir(stageDirectory, { recursive: true });

await copyPackageFile('package.json');
await copyPackageFile('README.md');
await copyDirectory('dist');

await runVscePackage();

async function copyPackageFile(fileName) {
  await fs.copyFile(path.join(packageRoot, fileName), path.join(stageDirectory, fileName));
}

async function copyDirectory(directoryName) {
  await fs.cp(path.join(packageRoot, directoryName), path.join(stageDirectory, directoryName), {
    recursive: true,
  });
}

async function runVscePackage() {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [vsceCliPath, 'package', '--allow-missing-repository', '--out', outputPath],
      {
        cwd: stageDirectory,
        stdio: 'inherit',
      }
    );

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`vsce package failed with exit code ${code ?? 'unknown'}.`));
    });

    child.on('error', reject);
  });
}
