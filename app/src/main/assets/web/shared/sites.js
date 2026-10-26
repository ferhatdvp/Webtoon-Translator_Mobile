// shared/sites.js — izin verilen siteler listesi için saf (chrome'a bağımlı olmayan) yardımcılar.

/** "https://www.Webtoons.com/en/..." veya "webtoons.com" -> "webtoons.com" (geçersizse null) */
export function normalizeHost(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = 'https://' + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const h = u.hostname.replace(/^www\./, '');
  if (!h) return null;
  if (!h.includes('.') && h !== 'localhost') return null;
  return h;
}

/** hostname, siteHost'un kendisi ya da alt alan adı mı? */
export function hostMatches(hostname, siteHost) {
  const h = String(hostname).toLowerCase().replace(/^www\./, '');
  return h === siteHost || h.endsWith('.' + siteHost);
}

export function findSite(sites, url) {
  try {
    const h = new URL(url).hostname;
    return sites.find((s) => hostMatches(h, s.host)) || null;
  } catch {
    return null;
  }
}

export function isUrlAllowed(url, settings) {
  if (!settings.enabled) return false;
  if (!/^https?:/i.test(url || '')) return false;
  const s = findSite(settings.sites, url);
  return Boolean(s && s.enabled);
}

const isIpOrLocalhost = (h) => h === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(h);

/**
 * Chrome match pattern'leri. "*.example.com" hem example.com'u hem alt alanları kapsar.
 * IP adresi ve localhost için joker alt alan geçersizdir; olduğu gibi yazılır.
 */
export function buildMatchPatterns(sites) {
  return [
    ...new Set(
      sites.filter((s) => s.enabled).map((s) => (isIpOrLocalhost(s.host) ? `*://${s.host}/*` : `*://*.${s.host}/*`)),
    ),
  ].sort();
}
