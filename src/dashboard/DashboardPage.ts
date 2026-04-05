import fs from 'node:fs/promises';

const dashboardPageAssets = new Map([
  ['/page/index.css', { fileName: 'index.css', contentType: 'text/css; charset=utf-8' }],
  ['/page/index.js', { fileName: 'index.js', contentType: 'text/javascript; charset=utf-8' }],
]);

export async function renderDashboardHtml(): Promise<string> {
  return fs.readFile(resolveDashboardPageFile('index.html'), 'utf8');
}

export async function readDashboardPageAsset(
  pathname: string
): Promise<{ body: Buffer<ArrayBufferLike>; contentType: string } | null> {
  const asset = dashboardPageAssets.get(pathname);

  if (asset == null) {
    return null;
  }

  return {
    body: await fs.readFile(resolveDashboardPageFile(asset.fileName)),
    contentType: asset.contentType,
  };
}

function resolveDashboardPageFile(fileName: string): URL {
  return new URL(`./page/${fileName}`, import.meta.url);
}
