// Builds the static site.
//   node scripts/build.mjs --pages   regenerate join/, portal/, console/ from the page template
//   node scripts/build.mjs --vendor  copy SLDS (CSS + icon sprites) into assets/vendor for local use
//   node scripts/build.mjs           both, then copy the publishable site into build/ (what Hostinger serves)
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
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
    cpSync(path.join(slds, 'icons', sprite), path.join(out, 'icons', sprite), { recursive: true, filter: (p) => !p.endsWith('.png') });
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
  console.log('build: site copied to build/');
}

if (args.has('--pages')) pages();
else if (args.has('--vendor')) vendor();
else {
  pages();
  vendor();
  build();
}
