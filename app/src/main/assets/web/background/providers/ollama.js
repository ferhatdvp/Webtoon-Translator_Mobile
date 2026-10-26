// background/providers/ollama.js — yerel Ollama sağlayıcısı (tamamen ücretsiz, kota yok).
// Görüntü destekli bir model gerekir (önerilen: qwen3-vl:8b).

import { AppError, ERR } from '../../shared/errors.js';
import { extractItems, normalizeItem } from '../../shared/items.js';
import { buildPrompt } from '../prompts.js';

const FORMAT_SCHEMA = {
  type: 'object',
  properties: {
    texts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          box_2d: { type: 'array', items: { type: 'integer' } },
          original: { type: 'string' },
          translation: { type: 'string' },
          kind: { type: 'string' },
          bg: { type: 'string' },
          fg: { type: 'string' },
        },
        required: ['box_2d', 'original', 'translation'],
      },
    },
  },
  required: ['texts'],
};

export function parseOllamaResponse(json, { coordMode, width, height }) {
  const text = json?.message?.content ?? '';
  const raw = extractItems(text);
  if (raw === null) throw new AppError(ERR.BAD_RESPONSE);
  const scale = coordMode === 'absolute' ? { w: width, h: height } : { w: 1000, h: 1000 };
  const items = raw.map((r) => normalizeItem(r, { order: 'xyxy', ...scale })).filter(Boolean);
  return { items };
}

export async function callOllama({ base64, width, height, endpoint, model, coordMode, glossary }) {
  const prompt = buildPrompt({ provider: 'ollama', glossary, coordMode, width, height });
  let res;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300_000);
  try {
    res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/chat`, {
      signal: ctrl.signal,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: FORMAT_SCHEMA,
        options: { temperature: 0.2 },
        messages: [{ role: 'user', content: prompt, images: [base64] }],
      }),
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new AppError(ERR.SERVER, 'Ollama 5 dakika içinde yanıt vermedi (model çok yavaş olabilir).');
    throw new AppError(ERR.OLLAMA_DOWN);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 403) throw new AppError(ERR.OLLAMA_ORIGIN);
  if (res.status === 404) throw new AppError(ERR.OLLAMA_MODEL);
  if (!res.ok) throw new AppError(ERR.SERVER, `Ollama hata verdi (HTTP ${res.status}).`);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new AppError(ERR.BAD_RESPONSE);
  }
  return parseOllamaResponse(json, { coordMode, width, height });
}

export async function testOllama({ endpoint, model }) {
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/tags`);
    if (res.status === 403) return { ok: false, message: new AppError(ERR.OLLAMA_ORIGIN).message };
    if (!res.ok) return { ok: false, message: `Ollama HTTP ${res.status} döndürdü.` };
    const { models = [] } = await res.json();
    const names = models.map((m) => m.name);
    const found = names.some((n) => n === model || n === `${model}:latest` || n.startsWith(`${model}:`));
    return found
      ? { ok: true, message: `Ollama çalışıyor, “${model}” yüklü.` }
      : { ok: false, message: `Ollama çalışıyor ama “${model}” yüklü değil. Yüklü modeller: ${names.join(', ') || '—'}` };
  } catch {
    return { ok: false, message: new AppError(ERR.OLLAMA_DOWN).message };
  }
}
