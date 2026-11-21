// Builds dist/index.html: one self-contained page with the SLDS stylesheet inlined
// and only the SLDS icon symbols the page actually references.
// Usage: node scripts/build.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const SRC = path.join(root, 'src', 'app.html');
const OUT_DIR = path.join(root, 'dist');
const CSS_MARKER = '/*__SLDS__*/';
const ICON_MARKER = '<!--__ICONS__-->';

// Icons the code builds dynamically (names held in variables), so they can't all be found
// by pattern alone. The build fails if any of these is missing from the installed SLDS version.
const REQUIRED = {
  utility: ['check', 'clock', 'pause', 'play', 'notification', 'refresh', 'download', 'add', 'upload', 'call', 'chat',
    'change_owner', 'forward', 'close', 'success', 'warning', 'error', 'info', 'arrowup', 'arrowdown', 'knowledge_base',
    'minimize_window', 'assignment', 'email', 'merge', 'settings', 'ban', 'file', 'moneybag'],
  standard: ['lead', 'opportunity', 'campaign', 'dashboard', 'task', 'event', 'announcement', 'knowledge', 'contact',
    'log_a_call', 'assignment', 'disclosure_and_compliance', 'currency', 'budget', 'budget_allocation', 'metrics', 'feed',
    'people', 'report', 'timesheet', 'queue', 'custom', 'apps', 'flow', 'location', 'call', 'chart'],
};
const PREFIX = { utility: 'u', standard: 's' };

function fail(message) {
  console.error(`build failed: ${message}`);
  process.exit(1);
}

async function readOrFail(file, what) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    fail(`could not read ${what} (${file}): ${err.message}. Did you run "npm ci"?`);
  }
}

function sldsAssets() {
  try {
    return path.join(path.dirname(require.resolve('@salesforce-ux/design-system/package.json')), 'assets');
  } catch {
    fail('@salesforce-ux/design-system is not installed. Run "npm ci".');
  }
}

// Every identifier-like quoted word or #u-/#s- reference in the source is a candidate icon name.
function candidateNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/['"`#-]([a-z][a-z0-9_]+)['"`]/g)) names.add(m[1]);
  for (const m of source.matchAll(/#[us]-([a-z0-9_]+)/g)) names.add(m[1]);
  return names;
}

function extractSymbols(spriteSvg, names, prefix) {
  const found = new Map();
  for (const m of spriteSvg.matchAll(/<symbol\b[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<\/symbol>/g)) {
    const id = m[1];
    if (names.has(id)) found.set(id, m[0].replace(`id="${id}"`, `id="${prefix}-${id}"`));
  }
  return found;
}

async function main() {
  const source = await readOrFail(SRC, 'page source');
  if (!source.includes(CSS_MARKER)) fail(`marker ${CSS_MARKER} not found in src/app.html`);
  if (!source.includes(ICON_MARKER)) fail(`marker ${ICON_MARKER} not found in src/app.html`);

  const assets = sldsAssets();
  const css = await readOrFail(path.join(assets, 'styles', 'salesforce-lightning-design-system.min.css'), 'SLDS stylesheet');
  const names = candidateNames(source);

  const symbols = [];
  const missing = [];
  for (const sprite of ['utility', 'standard']) {
    const svg = await readOrFail(path.join(assets, 'icons', `${sprite}-sprite`, 'svg', 'symbols.svg'), `${sprite} sprite`);
    const found = extractSymbols(svg, names, PREFIX[sprite]);
    for (const n of REQUIRED[sprite]) if (!found.has(n)) missing.push(`${sprite}:${n}`);
    symbols.push(...found.values());
    console.log(`${sprite} icons: ${found.size}`);
  }
  if (missing.length) fail(`icons missing from this SLDS version: ${missing.join(', ')}`);

  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols.join('')}</svg>`;
  // Function replacers: the CSS contains "$" sequences that a string replacement would interpret.
  const html = source.replace(CSS_MARKER, () => css).replace(ICON_MARKER, () => sprite);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'index.html'), html, 'utf8');
  await writeFile(path.join(OUT_DIR, '.nojekyll'), '', 'utf8');
  console.log(`wrote dist/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
}

main().catch(err => fail(err.stack || String(err)));
