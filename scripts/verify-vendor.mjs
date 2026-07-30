import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pairs = [
  ['public/vendor/xterm.js', 'node_modules/@xterm/xterm/lib/xterm.js'],
  ['public/vendor/xterm.css', 'node_modules/@xterm/xterm/css/xterm.css'],
  ['public/vendor/addon-fit.js', 'node_modules/@xterm/addon-fit/lib/addon-fit.js'],
  ['public/vendor/addon-web-links.js', 'node_modules/@xterm/addon-web-links/lib/addon-web-links.js'],
  ['public/vendor/marked.min.js', 'node_modules/marked/marked.min.js'],
  ['public/vendor/purify.min.js', 'node_modules/dompurify/dist/purify.min.js'],
];

for (const [vendored, installed] of pairs) {
  assert.deepEqual(await readFile(vendored), await readFile(installed), `${vendored} is out of sync with ${installed}`);
}

console.log(`Vendor verification passed (${pairs.length} assets).`);
