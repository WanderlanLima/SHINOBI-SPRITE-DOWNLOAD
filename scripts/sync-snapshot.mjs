#!/usr/bin/env node
/**
 * Sincroniza metadados leves de https://naruto.jotagame.com/jogar?app=1
 * para public/data/studio-snapshot.json, permitindo que o site funcione
 * 100% estático no GitHub Pages (o manifesto completo e todos os assets
 * são baixados diretamente do CDN oficial https://cdn.jotagame.com/ via CORS).
 */
import fs from 'node:fs';
import path from 'node:path';

const SOURCE_PAGE_URL = 'https://naruto.jotagame.com/jogar?app=1';
const OUT_FILE = path.resolve('public/data/studio-snapshot.json');

function extractBalancedJson(str) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return str.slice(0, i + 1);
      }
    }
  }
  return null;
}

async function main() {
  console.log('Sincronizando metadados de', SOURCE_PAGE_URL);
  const res = await fetch(SOURCE_PAGE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ao acessar ${SOURCE_PAGE_URL}`);
  }
  const html = await res.text();

  const build = html.match(/window\.__VDF_BUILD__\s*=\s*"([^"]+)"/)?.[1] || 'unknown';
  const dataBuild = html.match(/window\.__VDF_DATA_BUILD__\s*=\s*"([^"]+)"/)?.[1] || 'unknown';
  const cdnBase = (html.match(/window\.__VDF_CDN__\s*=\s*"([^"]+)"/)?.[1] || 'https://cdn.jotagame.com/').replace(
    /\/?$/,
    '/'
  );
  const recRaw = html.match(/window\.__VDF_RECURSOS__\s*=\s*(\{[^;]+\})/)?.[1];
  const manifestFile = recRaw ? JSON.parse(recRaw).manifesto || '' : '';

  if (!manifestFile) {
    throw new Error('Manifesto de recursos não encontrado na página do jogo.');
  }

  let estudio = { herois: {}, skills: {}, textos: {}, itens: {} };
  const marker = 'window.__VDF_ESTUDIO__ = ';
  const idx = html.indexOf(marker);
  if (idx !== -1) {
    const slice = html.slice(idx + marker.length);
    const jsonText = extractBalancedJson(slice);
    if (jsonText) {
      estudio = JSON.parse(jsonText);
    }
  }

  const snapshot = {
    sourceUrl: 'https://naruto.jotagame.com/',
    cdnBase,
    build,
    dataBuild,
    manifestFile,
    syncedAt: new Date().toISOString(),
    estudio,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(snapshot), 'utf8');
  const sizeKb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log(
    `Snapshot salvo em ${OUT_FILE} (${sizeKb} KB) — build ${build}, manifesto ${manifestFile}`
  );
}

main().catch((err) => {
  console.error('Erro na sincronização:', err);
  process.exit(1);
});
