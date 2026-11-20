'use strict';

const homeBridge = window.__wttHome;
let requestId = 0;
let timeout;
const element = (id) => document.getElementById(id);

function pageLink(page, resume = false) {
  let url;
  try { url = new URL(page.url); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const link = document.createElement('a');
  link.className = 'page';
  link.href = url.href;
  const title = document.createElement('strong');
  title.textContent = page.title || url.hostname;
  link.appendChild(title);
  const address = document.createElement('small');
  address.textContent = url.hostname + url.pathname + url.search;
  link.appendChild(address);
  const detail = document.createElement(resume ? 'span' : 'small');
  detail.className = resume ? 'resume' : '';
  detail.textContent = resume ? 'Okumaya devam et →' : `${page.imageCount} görselin çevirisi önbellekte`;
  link.appendChild(detail);
  return link;
}

function cacheError() {
  element('cache-status').textContent = 'Önbellek listesi okunamadı. Tekrar deneyebilirsin.';
  element('cache-status').classList.add('error');
  element('retry').hidden = false;
}

window.refreshHome = function () {
  clearTimeout(timeout);
  const id = ++requestId;
  element('cache-status').textContent = 'Önbellek okunuyor…';
  element('cache-status').classList.remove('error');
  element('retry').hidden = true;
  element('cached-pages').replaceChildren();
  if (!homeBridge) {
    element('last-page').textContent = 'Ana sayfa için Android System WebView güncellenmeli.';
    cacheError();
    return;
  }
  timeout = setTimeout(cacheError, 15000);
  try { homeBridge.postMessage(JSON.stringify({ type: 'GET_HOME_DATA', id })); } catch { cacheError(); }
};

if (homeBridge) homeBridge.onmessage = (event) => {
  let data;
  try { data = JSON.parse(event.data); } catch { return; }
  if (data.id !== requestId) return;
  if ('lastPage' in data) {
    const card = data.lastPage && pageLink(data.lastPage, true);
    element('last-page').replaceChildren();
    if (card) element('last-page').appendChild(card);
    else element('last-page').textContent = 'Henüz ziyaret ettiğin bir sayfa yok. Adres çubuğundan bir site açabilirsin.';
  }
  if (Array.isArray(data.sites)) {
    element('sites').replaceChildren();
    for (const host of data.sites) {
      const link = pageLink({ url: 'https://' + host, title: host }, true);
      if (!link) continue;
      // Site kısayolları yalnızca alan adını gösterir.
      link.replaceChildren(document.createTextNode(host));
      link.className = '';
      element('sites').appendChild(link);
    }
    if (!element('sites').childElementCount) element('sites').textContent = 'Çeviri listene eklediğin siteler burada görünür.';
  }
  if (!data.cachePending) {
    clearTimeout(timeout);
    element('cached-pages').replaceChildren();
    if (data.cacheError) { cacheError(); return; }
    for (const page of data.pages || []) {
      const link = pageLink(page);
      if (!link) continue;
      const item = document.createElement('li');
      item.appendChild(link);
      element('cached-pages').appendChild(item);
    }
    const count = element('cached-pages').childElementCount;
    element('cache-status').classList.remove('error');
    element('cache-status').textContent = count ? `${count} sayfa` : 'Sayfalar çevrildikçe burada görünür.';
    element('retry').hidden = true;
  }
};

element('help').addEventListener('toggle', () => {
  element('instructions').hidden = !element('help').open;
});
element('retry').addEventListener('click', window.refreshHome);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.refreshHome();
});
window.refreshHome();
