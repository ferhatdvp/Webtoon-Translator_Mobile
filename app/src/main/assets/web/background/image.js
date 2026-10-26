// background/image.js — görseli çöz, parçalara ayır, JPEG'e kodla (service worker içinde, OffscreenCanvas ile).

export async function decode(buf, mime) {
  return createImageBitmap(new Blob([buf], { type: mime }));
}

export function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Bir parçayı (tile) maxWidth'e küçültüp JPEG olarak kodlar.
 * @returns {{base64:string, mime:string, width:number, height:number}}
 */
export async function renderTile(bitmap, tile, maxWidth = 1000, quality = 0.88) {
  const srcH = tile.y1 - tile.y0;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // saydam PNG'ler için
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, tile.y0, bitmap.width, srcH, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { base64: toBase64(await blob.arrayBuffer()), mime: 'image/jpeg', width, height };
}
