// shared/geometry.js — uzun webtoon görsellerini parçalara (tile) bölme ve kutu birleştirme. Saf fonksiyonlar.
//
// Kutular her yerde normalize [x0, y0, x1, y1] (0..1) biçimindedir.

/**
 * Görseli, birbiriyle biraz örtüşen parçalara böler.
 * Her parça yalnızca "sahip olduğu" (own0..own1) dikey aralıktaki kutuları tutar;
 * böylece örtüşme bölgesindeki yazılar iki kez çevrilmez, kesilen baloncuklar da kaybolmaz.
 *
 * @returns {{index:number,count:number,y0:number,y1:number,own0:number,own1:number}[]} (piksel cinsinden)
 */
export function planTiles(w, h, { maxTileAspect = 2.0, overlapRatio = 0.1 } = {}) {
  const tileH = Math.max(400, Math.round(w * maxTileAspect));
  if (h <= tileH * 1.2) {
    return [{ index: 0, count: 1, y0: 0, y1: h, own0: 0, own1: h + 1 }];
  }
  const overlap = Math.round(tileH * overlapRatio);
  const n = Math.ceil((h - overlap) / (tileH - overlap));
  const th = Math.ceil((h + (n - 1) * overlap) / n);
  const stride = th - overlap;
  const tiles = [];
  for (let i = 0; i < n; i++) {
    const y0 = i * stride;
    const y1 = Math.min(h, y0 + th);
    tiles.push({
      index: i,
      count: n,
      y0,
      y1,
      own0: i === 0 ? 0 : y0 + overlap / 2,
      own1: i === n - 1 ? h + 1 : y1 - overlap / 2,
    });
  }
  return tiles;
}

/** Parça-içi normalize kutuyu, tüm görsele göre normalize kutuya çevirir. */
export function tileToGlobal(box, tile, imgH) {
  const th = tile.y1 - tile.y0;
  return [box[0], (tile.y0 + box[1] * th) / imgH, box[2], (tile.y0 + box[3] * th) / imgH];
}

/** Kutunun merkezi bu parçanın sahip olduğu aralıkta mı? */
export function ownedByTile(globalBox, tile, imgH) {
  const cy = ((globalBox[1] + globalBox[3]) / 2) * imgH;
  return cy >= tile.own0 && cy < tile.own1;
}

export function clampBox(b) {
  return b.map((v) => Math.min(1, Math.max(0, v)));
}

export function isValidBox(b, minSize = 0.004) {
  return b.every(Number.isFinite) && b[2] - b[0] >= minSize && b[3] - b[1] >= minSize / 4;
}

export function iou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua <= 0 ? 0 : inter / ua;
}

/** Büyük ölçüde çakışan kutulardan ilkini tutar. */
export function dedupe(items, threshold = 0.5) {
  const out = [];
  for (const it of items) {
    if (!out.some((o) => iou(o.box, it.box) > threshold)) out.push(it);
  }
  return out;
}

/** Okuma sırası: yukarıdan aşağı (satır toleranslı), sonra soldan sağa. */
export function sortReadingOrder(items) {
  return [...items].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
}
