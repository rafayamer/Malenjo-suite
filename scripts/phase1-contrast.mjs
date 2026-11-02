/* Shared helper for Phase 1 browser checks: text contrast measured against
 * the real rendered pixels (handles gradients and images), WCAG 2.x ratio. */
export async function measureTextContrast(page, scope = 'body') {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ data, scope }) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const scale = image.naturalWidth / innerWidth;
    const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const parse = (value) => { const m = value.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), alpha: p.length > 3 ? p[3] : 1 }; };
    const results = [];
    const seen = new Set();
    // With a menu or dialog open, only its own text is active; content
    // behind it is obscured context and is checked on its own screen.
    for (const element of document.querySelectorAll(`${scope} *`)) {
      const ownText = [...element.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (!ownText || ownText.length < 2) continue;
      if (element.closest('[inert],[aria-hidden="true"],canvas,svg,.textLayer,.pdf-text-layer,input,textarea,select,option')) continue;
      if (element.closest(':disabled,[aria-disabled="true"]')) continue;
      const style = getComputedStyle(element);
      if (style.visibility !== 'visible' || Number(style.opacity) < 0.5) continue;
      const color = parse(style.color);
      if (!color || color.alpha < 0.5) continue;
      // Visible part of the text: clipped by every scrolling ancestor and the
      // viewport. Text scrolled out of view (or fully clipped) is skipped.
      const box = element.getBoundingClientRect();
      let left = Math.max(box.left, 0), top = Math.max(box.top, 0);
      let right = Math.min(box.right, innerWidth), bottom = Math.min(box.bottom, innerHeight);
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const ps = getComputedStyle(parent);
        if (ps.overflowX === 'visible' && ps.overflowY === 'visible') continue;
        const clip = parent.getBoundingClientRect();
        left = Math.max(left, clip.left); top = Math.max(top, clip.top);
        right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
      }
      if (right - left < 4 || bottom - top < 4) continue;
      if ((bottom - top) < Math.min(box.height, 12) * 0.6) continue;
      const x0 = Math.floor(left * scale), y0 = Math.floor(top * scale);
      const w = Math.min(canvas.width - x0, Math.ceil(Math.min(right - left, 400) * scale));
      const h = Math.min(canvas.height - y0, Math.ceil((bottom - top) * scale));
      if (w < 2 || h < 2) continue;
      const pixels = context.getImageData(x0, y0, w, h).data;
      const counts = new Map();
      for (let i = 0; i < pixels.length; i += 4 * 3) {
        const key = (pixels[i] >> 3) << 10 | (pixels[i + 1] >> 3) << 5 | (pixels[i + 2] >> 3);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      let best = 0, bestCount = -1;
      for (const [key, count] of counts) if (count > bestCount) { best = key; bestCount = count; }
      const background = [((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4];
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const value = ratio(color.rgb, background);
      const label = ownText.slice(0, 50);
      const key = label + '|' + Math.round(box.top);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ text: label, ratio: Math.round(value * 100) / 100, required: large ? 3 : 4.5, size, color: color.rgb, background });
    }
    return results;
  }, { data: png, scope });
}
