// background/prompts.js — modele gönderilen talimat. Saf fonksiyon (test edilebilir).

/**
 * @param {object} o
 * @param {'gemini'|'ollama'} o.provider
 * @param {string} [o.glossary]   satır başına "English = Türkçe"
 * @param {'relative1000'|'absolute'} [o.coordMode]  yalnızca ollama
 * @param {number} [o.width] @param {number} [o.height]  gönderilen görselin piksel boyutu
 */
export function buildPrompt({ provider, glossary = '', coordMode = 'relative1000', width = 0, height = 0 }) {
  let boxRule;
  if (provider === 'gemini') {
    boxRule =
      '"box_2d": [ymin, xmin, ymax, xmax] as integers normalised to 0-1000 (relative to the image width/height).';
  } else if (coordMode === 'absolute') {
    boxRule = `"box_2d": [x1, y1, x2, y2] in absolute pixels of this ${width}x${height} image (top-left origin).`;
  } else {
    boxRule =
      '"box_2d": [x1, y1, x2, y2] as integers normalised to 0-1000 (relative to the image width/height, top-left origin).';
  }

  const g = glossary
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('='))
    .slice(0, 80);
  const glossaryBlock = g.length
    ? `\nGLOSSARY (always use these exact translations for these terms/names):\n${g.join('\n')}\n`
    : '';

  return `You are an expert manhwa/webtoon localizer who translates English into natural, fluent, native-sounding Turkish.
The image is a vertical slice of a webtoon chapter. Bubbles or text may be cut off at the top/bottom edge.

TASK: find every English text block that belongs to the story and translate it to Turkish.
Include: speech bubbles, thought bubbles, narration/caption boxes, on-screen text with readable dialogue.
One entry per bubble/box: merge its lines into one string, in reading order.
Exclude: watermarks, site logos, URLs, scanlation/translator credits, text that is not English, decorative background texture.
Sound effects (onomatopoeia) are allowed but must have "kind": "sfx".
Text that is part of the ARTWORK itself — handwriting on notebooks/papers/walls, signs, shop fronts, screens, labels, stylised drawn lettering, crossed-out lists — must have "kind": "art" (these are usually NOT dialogue). Only use speech/thought/narration for real dialogue bubbles, thought bubbles and caption boxes.
If a bubble is cut by the image edge, still include the readable part.

FIELDS for each entry:
- ${boxRule} The box must tightly surround the TEXT of that bubble (not the whole bubble outline, not the artwork).
- "original": the English text exactly as written, lines joined with a single space.
- "translation": natural, conversational Turkish that fits the character's tone. Keep it about as short as the original so it fits the bubble. Keep punctuation, ellipses and emphasis. Do NOT explain, add notes or leave English words (except names). Keep proper names unchanged unless the glossary says otherwise.
- "kind": one of speech | thought | narration | sfx | art | other.
- "bg": hex colour of the background directly behind the text (e.g. "#FFFFFF" for a white bubble).
- "fg": hex colour of the text (e.g. "#000000").
${glossaryBlock}
OUTPUT: JSON only, exactly {"texts":[ ... ]}. If there is no English text, return {"texts":[]}.`;
}
