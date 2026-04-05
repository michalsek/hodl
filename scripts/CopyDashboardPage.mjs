import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const sourceDirectory = path.join(packageRoot, 'src', 'dashboard', 'page');
const outputDirectory = path.join(packageRoot, 'dist', 'dashboard', 'page');
const staleDashboardHtmlArtifacts = [
  'DashboardHtml.d.ts',
  'DashboardHtml.d.ts.map',
  'DashboardHtml.js',
  'DashboardHtml.js.map',
];

await Promise.all(
  staleDashboardHtmlArtifacts.map((fileName) =>
    fs.rm(path.join(packageRoot, 'dist', 'dashboard', fileName), { force: true })
  )
);

await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(path.dirname(outputDirectory), { recursive: true });
await fs.cp(sourceDirectory, outputDirectory, { recursive: true });
