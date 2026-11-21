// Builds the static site.
//   node scripts/build.mjs --pages   regenerate join/, portal/, console/ from the page template
//   node scripts/build.mjs --vendor  copy SLDS (CSS + icon sprites) into assets/vendor for local use
//   node scripts/build.mjs           both, then copy the publishable site into build/ (what Hostinger serves)
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = new Set(process.argv.slice(2));

const PAGES = {
  join: ['Join Broker Portal', 'Request to join or sign up your brokerage with an invitation.'],
  portal: ['Broker Portal', 'Your firm workspace: leads, deals, marketing, compliance and commission.'],
  console: ['Broker Portal · ThinkVibes console', 'Internal console for ThinkVibes sales and operations. Staff only.'],
};

function fail(message) {
  console.error(`build failed: ${message}`);
  process.exit(1);
}

function pages() {
  const tpl = readFileSync(path.join(root, 'scripts', 'page.template.html'), 'utf8');
  for (const [app, [title, description]] of Object.entries(PAGES)) {
    const html = tpl.replaceAll('{{title}}', title).replaceAll('{{description}}', description).replaceAll('{{app}}', app);
    mkdirSync(path.join(root, app), { recursive: true });
    writeFileSync(path.join(root, app, 'index.html'), html);
  }
  console.log('pages: join/, portal/, console/');
}

function vendor() {
  let slds;
  try {
    slds = path.join(path.dirname(require.resolve('@salesforce-ux/design-system/package.json')), 'assets');
  } catch {
    fail('@salesforce-ux/design-system is not installed. Run "npm install".');
  }
  const out = path.join(root, 'assets', 'vendor');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(path.join(out, 'icons'), { recursive: true });
  cpSync(path.join(slds, 'styles', 'salesforce-lightning-design-system.min.css'), path.join(out, 'slds.min.css'));
  for (const sprite of ['utility-sprite', 'standard-sprite']) {
    cpSync(path.join(slds, 'icons', sprite), path.join(out, 'icons', sprite), { recursive: true, filter: (p) => !p.endsWith('.png') && !p.endsWith('-rtl.svg') });
  }
  console.log('vendor: SLDS css and icon sprites copied to assets/vendor');
}

const PUBLISH = ['index.html', 'robots.txt', '.htaccess', 'join', 'portal', 'console', 'assets', 'js', 'api'];

function build() {
  const out = path.join(root, 'build');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  for (const item of PUBLISH) {
    const src = path.join(root, item);
    if (!existsSync(src)) continue;
    cpSync(src, path.join(out, item), { recursive: true, filter: (p) => !p.endsWith('config.php') });
  }
  const version = stampVersion(out);
  console.log(`build: site copied to build/ (version ${version})`);
}

// Browsers keep GitHub Pages / Hostinger files for up to 10 minutes. Without a version on every
// URL, a deploy can leave a browser running a mix of old and new modules. We stamp ?v=<content hash>
// on the app entry, the stylesheet and every relative module import, so one deploy = one consistent set.
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p) : [p];
  });
}

function stampVersion(out) {
  const jsFiles = listFiles(path.join(out, 'js')).filter((f) => f.endsWith('.js')).sort();
  const hash = createHash('sha256');
  for (const f of [...jsFiles, path.join(out, 'assets', 'bp.css')]) {
    if (!existsSync(f)) continue;
    hash.update(path.relative(out, f));
    hash.update(readFileSync(f));
  }
  const v = hash.digest('hex').slice(0, 10);
  const importRe = /((?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g;
  for (const f of jsFiles) {
    const src = readFileSync(f, 'utf8');
    const next = src.replace(importRe, `$1$2?v=${v}$3`);
    if (next !== src) writeFileSync(f, next);
  }
  writeFileSync(path.join(out, 'version.json'), JSON.stringify({ v }));
  return v;
}

if (args.has('--pages')) pages();
else if (args.has('--vendor')) vendor();
else {
  pages();
  vendor();
  build();
}
