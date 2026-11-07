#!/usr/bin/env node
// tools/sync-web.mjs — eklentinin JS kodunu Android projesinin assets klasörüne kopyalar ve mobil dosyaları üretir.
// Kullanım: node tools/sync-web.mjs [../webtoon-translator]
// Yalnızca mobil dosyaları yeniden üretmek için: node tools/sync-web.mjs --bundle-only

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const extDir = path.resolve(process.argv[2] || path.join(root, '..', 'webtoon-translator'));
const out = path.join(root, 'app/src/main/assets/web');

// Mobil ayarlar, içerik betiği ve Android kancaları ayrı uyarlanır. Eklentiden
// eşitlerken bunları kopyalamamak kota ayarlarının ve AFK köprüsünün korunmasını sağlar.
const FILES = [
  'shared/sites.js', 'shared/geometry.js', 'shared/items.js',
  'background/sites-sync.js', 'background/pipeline.js', 'background/prompts.js',
  'background/cache.js', 'background/quota.js', 'background/scheduler.js',
  'background/image.js', 'background/log.js', 'background/providers/gemini.js', 'background/providers/ollama.js',
  'content/content.css', 'options/options.css',
];

if (process.argv[2] !== '--bundle-only') {
  const sources = FILES.map((f) => [f, fs.readFileSync(path.join(extDir, f))]);
  for (const [f, contents] of sources) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), contents);
  }
}

// mobil katman
const mobileOut = path.join(out, 'mobile');
fs.mkdirSync(mobileOut, { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'web-src/mobile'))) {
  fs.copyFileSync(path.join(root, 'web-src/mobile', f), path.join(mobileOut, f));
}

// ayarlar sayfası: chrome shim'i en başa ekle
let html = fs.readFileSync(path.join(out, 'options/options.html'), 'utf8');
if (!html.includes('<head>')) throw new Error('options.html <head> bulunamadı');
html = html.replace(
  '<head>',
  '<head>\n  <script src="../mobile/chrome-shim.js"></script>',
);
fs.writeFileSync(path.join(out, 'options/options-mobile.html'), html);

// sayfa paketi
const tpl = fs.readFileSync(path.join(root, 'web-src/page-bundle.template.js'), 'utf8');
const css = fs.readFileSync(path.join(out, 'content/content.css'), 'utf8');
const content = fs.readFileSync(path.join(out, 'content/content.js'), 'utf8');
const bundle = tpl
  .replace("/*__CSS__*/ ''", () => JSON.stringify(css))
  .replace('/*__CONTENT__*/', () => content);
fs.writeFileSync(path.join(mobileOut, 'page-bundle.js'), bundle);

console.log('Mobil ayarlar sayfası ve içerik paketi üretildi.');
