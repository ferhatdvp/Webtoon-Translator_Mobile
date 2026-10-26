// shared/items.js — model çıktısını (JSON) güvenle ayrıştırma ve normalize etme. Saf fonksiyonlar.

import { clampBox, isValidBox } from './geometry.js';

/** ```json ... ``` çitlerini ve baştaki/sondaki gürültüyü tolere eden JSON ayrıştırıcı. */
export function parseLooseJson(text) {
  if (typeof text !== 'string') return null;
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(t);
  } catch {
    /* devam */
  }
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(t.slice(s, e + 1));
    } catch {
      /* devam */
    }
  }
  return null;
}

/** Yarıda kesilmiş (maxTokens) JSON dizisinden tamamlanmış nesneleri kurtarır. */
export function salvageObjects(text) {
  const start = text.indexOf('[');
  if (start < 0) return [];
  const out = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          out.push(JSON.parse(text.slice(objStart, i + 1)));
        } catch {
          /* bozuk nesneyi atla */
        }
        objStart = -1;
      }
    }
  }
  return out;
}

/** Ham metinden öğe dizisini çıkarır. Boş metin -> []; çözülemezse null. */
export function extractItems(text) {
  if (!text || !text.trim()) return [];
  const parsed = parseLooseJson(text);
  if (parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.texts)) return parsed.texts;
    const arr = Object.values(parsed).find(Array.isArray);
    if (arr) return arr;
    return [];
  }
  const salvaged = salvageObjects(text);
  return salvaged.length ? salvaged : null;
}

export function cleanHex(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === 'white') return '#ffffff';
  if (s === 'black') return '#000000';
  const m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return '#' + h;
}

const KINDS = new Set(['speech', 'thought', 'narration', 'sfx', 'art', 'other']);

/**
 * Ham model öğesini { box:[x0,y0,x1,y1] (0..1), original, translation, kind, bg, fg } biçimine çevirir.
 * order: 'yxyx' (Gemini box_2d) | 'xyxy' (Qwen bbox_2d);  w/h: koordinat ölçeği (1000 veya piksel)
 */
export function normalizeItem(raw, { order = 'xyxy', w = 1000, h = 1000 } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw.box_2d || raw.bbox_2d || raw.bbox || raw.box;
  if (!Array.isArray(b) || b.length !== 4) return null;
  const n = b.map(Number);
  if (n.some((v) => !Number.isFinite(v))) return null;

  let x0, y0, x1, y1;
  if (order === 'yxyx') [y0, x0, y1, x1] = n;
  else [x0, y0, x1, y1] = n;

  let box = [x0 / w, y0 / h, x1 / w, y1 / h];
  box = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
  box = clampBox(box);
  if (!isValidBox(box)) return null;

  const translation = String(raw.translation ?? raw.translated ?? '').trim();
  if (!translation) return null;

  const kind = KINDS.has(raw.kind) ? raw.kind : 'speech';
  return {
    box,
    original: String(raw.original ?? raw.text ?? '').trim(),
    translation,
    kind,
    bg: cleanHex(raw.bg),
    fg: cleanHex(raw.fg),
  };
}
