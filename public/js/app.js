/* Application publique (SPA légère, sans build) : catalogue, fiche lot, salle live, compte, paiement.
   Tous les textes proviennent de l'API (/api/bootstrap → texts), modifiables depuis l'admin. */
(() => {
  'use strict';

  const S = { boot: null, lang: 'fr', cur: 'DJF', offset: 0, me: null, watched: new Set(), view: null, socket: null };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const e = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now() + S.offset;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } } };

  // ---------- i18n ----------
  function t(key, vars) {
    const texts = S.boot ? S.boot.texts[S.lang] : {};
    let s = texts[key] ?? (S.boot ? S.boot.texts.fr[key] : null) ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
    return s;
  }
  const tr = (o, f) => o ? (o[`${f}_${S.lang}`] || o[`${f}_fr`] || '') : '';
  const setting = (k) => S.boot.settings[k] || '';

  const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${(window.ICONS || {})[name] || ''}</svg>`;

  // ---------- Formatage ----------
  function group(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function money(djf) {
    if (djf == null) return '—';
    if (S.cur === 'USD') return '$ ' + group(djf * Number(setting('rate_USD') || 0));
    if (S.cur === 'EUR') return group(djf * Number(setting('rate_EUR') || 0)) + ' €';
    return group(djf) + ' ' + (S.lang === 'ar' ? 'ف.ج' : 'FDJ');
  }
  const locale = () => S.lang === 'ar' ? 'ar-DJ-u-nu-latn' : 'fr-FR';
  const fmtDate = (ts, opts = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) => new Intl.DateTimeFormat(locale(), opts).format(new Date(ts));
  function ago(ts) {
    const m = Math.max(0, Math.round((now() - ts) / 60000));
    if (m < 1) return t('time.just_now');
    if (m < 60) return t('time.ago_min', { n: m });
    if (m < 1440) return t('time.ago_h', { n: Math.round(m / 60) });
    return t('time.ago_d', { n: Math.round(m / 1440) });
  }
  function dur(ms) {
    ms = Math.max(0, ms);
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
    if (d > 0) return `${d}${t('time.d')} ${h}${t('time.h')}`;
    if (h > 0) return `${h}${t('time.h')} ${String(m).padStart(2, '0')}${t('time.m')}`;
    return `${m}${t('time.m')} ${String(s).padStart(2, '0')}${t('time.s')}`;
  }
  function countdownText(el) {
    const st = el.dataset.status, end = Number(el.dataset.end), start = Number(el.dataset.start);
    if (st === 'sold' || st === 'unsold' || st === 'withdrawn') return { txt: t('lot.closed'), urgent: false };
    if (st === 'upcoming' || (start && start > now())) return { txt: `${t('lot.starts_in')} ${dur(start - now())}`, urgent: false };
    if (st === 'suspended') return { txt: t('status.suspended'), urgent: false };
    const left = end - now();
    if (left <= 0) return { txt: t('lot.closed'), urgent: false };
    return { txt: dur(left), urgent: left < 5 * 60e3 };
  }
  const countdown = (l, cls = 'countdown') => `<span class="${cls}" data-cd data-end="${l.ends_at}" data-start="${l.starts_at}" data-status="${l.status}">${icon('clock', 'sm')}<span>${e(countdownText({ dataset: { end: l.ends_at, start: l.starts_at, status: l.status } }).txt)}</span></span>`;
  function tickCountdowns() {
    for (const el of $$('[data-cd]')) {
      const { txt, urgent } = countdownText(el);
      const span = el.querySelector('span') || el;
      if (span.textContent !== txt) span.textContent = txt;
      el.classList.toggle('urgent', urgent);
    }
    for (const el of $$('[data-bigtimer]')) {
      const left = Number(el.dataset.end) - now();
      const total = Number(el.dataset.total) || 300000;
      el.querySelector('b').textContent = left > 0 ? dur(left) : t('lot.closed');
      el.classList.toggle('urgent', left > 0 && left < 60000);
      const bar = el.parentElement.querySelector('.timer-bar i');
      if (bar) bar.style.width = Math.max(0, Math.min(100, 100 * left / total)) + '%';
    }
  }

  // ---------- API ----------
  const cookie = (n) => (document.cookie.split('; ').find(c => c.startsWith(n + '=')) || '').split('=')[1] || '';
  async function api(path, { method = 'GET', body, form } = {}) {
    const opts = { method, headers: { 'x-csrf-token': decodeURIComponent(cookie('csrf')) }, credentials: 'same-origin' };
    if (form) opts.body = form;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch('/api' + path, opts);
    let data = {};
    try { data = await res.json(); } catch { /* réponse vide */ }
    if (!res.ok) {
      const err = new Error(data.error || t('misc.error'));
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }
  function requireLogin() {
    if (S.me) return true;
    go('/connexion?next=' + encodeURIComponent(location.pathname));
    return false;
  }

  // ---------- Toasts, modales ----------
  function toast(html, { type = 'info', ms = 4500, iconName } = {}) {
    const zone = $('#toast-zone'); if (!zone) return;
    const el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status');
    const ic = iconName || { ok: 'check', err: 'alert', won: 'gavel', review: 'star', info: 'bell' }[type] || 'bell';
    el.innerHTML = `<span class="ti ${type}">${icon(ic)}</span><div>${html}</div><button class="x" aria-label="${e(t('misc.close'))}">${icon('x', 'sm')}</button>`;
    el.querySelector('.x').onclick = () => el.remove();
    zone.appendChild(el);
    while (zone.children.length > 3) zone.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
  }
  function modal(html, onMount) {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => { bd.remove(); document.removeEventListener('keydown', esc); };
    const esc = (ev) => ev.key === 'Escape' && close();
    bd.addEventListener('click', ev => { if (ev.target === bd || ev.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(bd);
    const first = bd.querySelector('input, button, select'); if (first) first.focus();
    if (onMount) onMount(bd.querySelector('.modal'), close);
    return close;
  }
  function confirmBox(msg, label = t('misc.confirm')) {
    return new Promise(res => modal(`<h3>${msg}</h3><div class="modal-actions"><button class="btn btn-outline" data-close>${e(t('misc.cancel'))}</button><button class="btn btn-accent" data-ok>${e(label)}</button></div>`,
      (m, close) => { m.querySelector('[data-ok]').onclick = () => { close(); res(true); }; m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => res(false))); }));
  }

  // ---------- Thème, langue, devise, identité ----------
  function applyIdentity() {
    const r = document.documentElement.style;
    if (setting('color_primary')) r.setProperty('--brand', setting('color_primary'));
    if (setting('color_accent')) r.setProperty('--accent', setting('color_accent'));
    if (setting('color_dark') && document.documentElement.dataset.theme !== 'dark') r.setProperty('--ink-strong', setting('color_dark')); else r.removeProperty('--ink-strong');
    const fav = $('#favicon');
    if (fav) fav.href = setting('favicon') || '/img/icon.svg';
  }
  function setLang(l) {
    S.lang = l === 'ar' ? 'ar' : 'fr';
    store.set('lang', S.lang);
    document.documentElement.lang = S.lang;
    document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
  }
  function toggleTheme() {
    const th = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = th;
    store.set('theme', th);
    applyIdentity();
    renderShell(true);
  }

  // ---------- Coquille : en-tête, menus, pied de page ----------
  function logoHtml() {
    const name = e(setting('site_name'));
    if (setting('logo')) return `<a href="/" class="logo" aria-label="${name}"><img src="${e(setting('logo'))}" alt="${name}"></a>`;
    return `<a href="/" class="logo"><span class="logo-mark">${icon('gavel')}</span><span class="logo-text">${name}</span></a>`;
  }
  function renderShell(keepView) {
    const cats = S.boot.categories;
    const curs = setting('currencies_enabled').split(',').filter(Boolean);
    const unread = S.boot.unread || 0;
    const prevView = keepView ? $('#view') : null;
    $('#app').innerHTML = `
      <div id="offline" class="offline-bar" hidden>${e(t('misc.offline'))}</div>
      <div class="topbar"><div class="container">
        <div class="topbar-msg"><span><b>${group(S.boot.stats_users || 0) || '+'}</b> ${e(t('home.stats_users'))}</span><span>${icon('truck', 'sm')} ${e(t('trust.delivery'))}</span><span>${icon('wallet', 'sm')} ${e(t('trust.mobile_money'))}</span></div>
        <div class="topbar-tools">
          ${curs.length > 1 ? `<label class="sr-only" for="cur-sel">${e(t('misc.currency'))}</label><select id="cur-sel">${curs.map(c => `<option ${c === S.cur ? 'selected' : ''}>${c}</option>`).join('')}</select>` : ''}
          <button id="theme-btn" aria-label="${e(t('nav.theme'))}">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 'sm')}</button>
          <button id="lang-btn" lang="${S.lang === 'ar' ? 'fr' : 'ar'}">${icon('globe', 'sm')} ${e(t('nav.lang_switch'))}</button>
        </div>
      </div></div>
      <header class="header"><div class="container">
        <div class="header-row">
          <button class="icon-btn menu-btn" id="menu-btn" aria-label="${e(t('nav.menu'))}">${icon('menu')}</button>
          ${logoHtml()}
          <button class="btn btn-ghost cat-trigger" id="mega-btn" aria-expanded="false">${icon('grid', 'sm')} ${e(t('nav.categories'))} ${icon('down', 'sm')}</button>
          <form class="search" role="search" data-search><input type="search" name="q" placeholder="${e(t('search.placeholder'))}" aria-label="${e(t('search.button'))}" value="${e(new URLSearchParams(location.search).get('q') || '')}"><button aria-label="${e(t('search.button'))}">${icon('search', 'sm')}</button></form>
          <div class="header-actions">
            <a class="btn btn-ghost" href="/page/how">${e(t('nav.how'))}</a>
            <a class="icon-btn" href="/compte/suivis" aria-label="${e(t('nav.favorites'))}">${icon('heart')}</a>
            ${S.me ? `<a class="icon-btn" href="/compte/notifications" aria-label="${e(t('account.notifications'))}">${icon('bell')}${unread ? `<span class="dot-badge">${unread > 9 ? '9+' : unread}</span>` : ''}</a>
              <a class="btn btn-outline" href="/compte">${icon('user', 'sm')} ${e(S.me.pseudo)}</a>`
              : `<a class="icon-btn" href="/connexion" aria-label="${e(t('nav.login'))}" style="display:inline-grid">${icon('user')}</a><a class="btn btn-primary" href="/inscription">${e(t('nav.register'))}</a>`}
          </div>
        </div>
        <div class="mobile-search"><form class="search" role="search" data-search><input type="search" name="q" placeholder="${e(t('search.placeholder'))}" aria-label="${e(t('search.button'))}"><button aria-label="${e(t('search.button'))}">${icon('search', 'sm')}</button></form></div>
      </div>
      <div class="mega" id="mega"><div class="container"><div class="mega-grid">
        <div class="mega-cats">${cats.map((c, i) => `<button data-mega="${i}" class="${i === 0 ? 'on' : ''}">${icon(c.icon)} ${e(tr(c, 'name'))}</button>`).join('')}</div>
        <div class="mega-subs" id="mega-subs"></div>
      </div></div></div>
      </header>
      <nav class="cat-tabs" aria-label="${e(t('nav.categories'))}"><div class="container"><div class="cat-tabs-scroll">
        <a class="cat-tab live" href="/live">${icon('live')} ${e(t('nav.live'))}</a>
        <a class="cat-tab" href="/" data-tab="/">${icon('home')} ${e(t('nav.home'))}</a>
        <a class="cat-tab" href="/ventes" data-tab="/ventes">${icon('gavel')} ${e(t('nav.sales'))}</a>
        <a class="cat-tab" href="/recherche?sort=ending" data-tab="ending">${icon('clock')} ${e(t('nav.ending'))}</a>
        ${cats.map(c => `<a class="cat-tab" href="/c/${c.slug}" data-tab="/c/${c.slug}">${icon(c.icon)} ${e(tr(c, 'name').split(' (')[0])}</a>`).join('')}
      </div></div></nav>
      <div class="drawer-backdrop" id="drawer-bd"></div>
      <aside class="drawer" id="drawer" aria-label="${e(t('nav.menu'))}">
        <div class="drawer-head">${logoHtml()}<button class="icon-btn" data-drawer-close aria-label="${e(t('misc.close'))}">${icon('x')}</button></div>
        <div class="drawer-body">
          ${S.me ? `<a class="drawer-link" href="/compte">${icon('user')} ${e(t('nav.account'))}</a>` : `<a class="drawer-link" href="/connexion">${icon('user')} ${e(t('nav.login'))}</a><a class="drawer-link" href="/inscription">${icon('plus')} ${e(t('nav.register'))}</a>`}
          <a class="drawer-link" href="/live">${icon('live')} ${e(t('nav.live'))}</a>
          <a class="drawer-link" href="/ventes">${icon('gavel')} ${e(t('nav.sales'))}</a>
          <a class="drawer-link" href="/vendre">${icon('tag')} ${e(t('nav.sell'))}</a>
          <a class="drawer-link" href="/page/how">${icon('info')} ${e(t('nav.how'))}</a>
          ${S.me && ['superadmin', 'admin', 'moderator', 'auctioneer'].includes(S.me.role) ? `<a class="drawer-link" href="/admin" data-external>${icon('settings')} ${e(t('nav.admin'))}</a>` : ''}
          <div class="kicker" style="padding:14px 12px 4px">${e(t('nav.categories'))}</div>
          ${cats.map(c => `<details><summary class="drawer-link">${icon(c.icon)} <span style="flex:1">${e(tr(c, 'name'))}</span>${icon('down', 'sm')}</summary>
            <div class="drawer-sub"><a href="/c/${c.slug}">${e(t('filters.all'))}</a>${c.subs.map(s => `<a href="/c/${c.slug}/${s.slug}">${e(tr(s, 'name'))}</a>`).join('')}</div></details>`).join('')}
          ${S.me ? `<button class="drawer-link btn-ghost" data-logout style="border:0;width:100%">${icon('logout')} ${e(t('nav.logout'))}</button>` : ''}
        </div>
      </aside>
      <main id="view" tabindex="-1"></main>
      ${footerHtml()}
      <a class="wa-float" id="wa-float" href="${waLink(t('misc.whatsapp_hello'))}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('chat')}</a>
      <div class="toast-zone ${setting('toast_position') === 'bottom-right' ? 'right' : ''}" id="toast-zone" aria-live="polite"></div>`;
    if (prevView) $('#view').replaceWith(prevView);
    bindShell();
    renderMega(0);
    markTab();
    updateOffline();
  }
  const waLink = (msg) => `https://wa.me/${(setting('whatsapp_number') || '').replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
  function footerHtml() {
    const cats = S.boot.categories.slice(0, 6);
    return `<footer class="footer"><div class="container">
      <div class="footer-grid">
        <div class="footer-brand">${logoHtml()}<p style="margin:0;max-width:40ch">${e(t('footer.text'))}</p>
          <div><div class="small" style="margin-bottom:8px">${e(t('footer.payments'))}</div><div class="pay-logos">${S.boot.payments.map(p => `<span>${e(p.name)}</span>`).join('')}</div></div>
          <div class="socials">${setting('social_facebook') ? `<a href="${e(setting('social_facebook'))}" target="_blank" rel="noopener" aria-label="Facebook">f</a>` : ''}${setting('social_instagram') ? `<a href="${e(setting('social_instagram'))}" target="_blank" rel="noopener" aria-label="Instagram">ig</a>` : ''}${setting('social_tiktok') ? `<a href="${e(setting('social_tiktok'))}" target="_blank" rel="noopener" aria-label="TikTok">tt</a>` : ''}</div>
        </div>
        <div><h4>${e(t('footer.discover'))}</h4>${cats.map(c => `<a href="/c/${c.slug}">${e(tr(c, 'name').split(' (')[0])}</a>`).join('')}</div>
        <div><h4>${e(t('footer.help'))}</h4><a href="/page/how">${e(t('nav.how'))}</a><a href="/live">${e(t('nav.live'))}</a><a href="/ventes">${e(t('nav.sales'))}</a><a href="/vendre">${e(t('nav.sell'))}</a></div>
        <div><h4>${e(t('footer.contact'))}</h4><a href="tel:${e(setting('support_phone').replace(/\s/g, ''))}" dir="ltr">${e(setting('support_phone'))}</a><a href="mailto:${e(setting('support_email'))}">${e(setting('support_email'))}</a><a href="${waLink(t('misc.whatsapp_hello'))}" target="_blank" rel="noopener">WhatsApp</a><span class="small" style="display:block;padding-top:6px">${e(setting('address'))}</span></div>
      </div>
      <div class="footer-bottom"><span>© ${new Date().getFullYear()} ${e(setting('site_name'))}. ${e(t('footer.rights'))}</span><span><a href="/page/about" style="display:inline">${e(t('footer.about'))}</a> · <a href="/page/terms" style="display:inline">${e(t('footer.terms'))}</a> · <a href="/page/privacy" style="display:inline">${e(t('footer.privacy'))}</a></span></div>
    </div></footer>`;
  }
  function renderMega(i) {
    const c = S.boot.categories[i]; if (!c) return;
    $$('[data-mega]').forEach(b => b.classList.toggle('on', Number(b.dataset.mega) === i));
    $('#mega-subs').innerHTML = `<a href="/c/${c.slug}" class="see-all" style="font-size:1.15rem">${e(tr(c, 'name'))} ${icon('right', 'sm flip')}</a>
      <div class="mega-subs-grid">${c.subs.map(s => `<a href="/c/${c.slug}/${s.slug}">${e(tr(s, 'name'))} <small class="muted">(${s.count})</small></a>`).join('')}</div>`;
  }
  function closeMenus() {
    $('#drawer')?.classList.remove('open'); $('#drawer-bd')?.classList.remove('open');
    $('#mega')?.classList.remove('open'); $('#mega-btn')?.setAttribute('aria-expanded', 'false');
  }
  function bindShell() {
    $('#menu-btn').onclick = () => { $('#drawer').classList.add('open'); $('#drawer-bd').classList.add('open'); };
    $('#drawer-bd').onclick = closeMenus;
    $('[data-drawer-close]').onclick = closeMenus;
    $('#mega-btn').onclick = () => { const o = $('#mega').classList.toggle('open'); $('#mega-btn').setAttribute('aria-expanded', o); };
    $$('[data-mega]').forEach(b => { b.onmouseenter = b.onfocus = () => renderMega(Number(b.dataset.mega)); });
    $('#lang-btn').onclick = () => { setLang(S.lang === 'ar' ? 'fr' : 'ar'); renderShell(); route(); };
    $('#theme-btn').onclick = toggleTheme;
    const cs = $('#cur-sel'); if (cs) cs.onchange = () => { S.cur = cs.value; store.set('cur', S.cur); route(); };
    $$('[data-search]').forEach(f => f.onsubmit = (ev) => { ev.preventDefault(); const q = f.q.value.trim(); go('/recherche' + (q ? '?q=' + encodeURIComponent(q) : '')); });
    $$('[data-logout]').forEach(b => b.onclick = logout);
  }
  function markTab() {
    const p = location.pathname, q = location.search;
    $$('.cat-tab').forEach(a => {
      const tab = a.dataset.tab;
      const on = tab && (tab === 'ending' ? (p === '/recherche' && q.includes('sort=ending')) : tab === '/' ? p === '/' : p.startsWith(tab));
      a.classList.toggle('active', !!on);
      if (on) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }
  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    await loadBoot(); renderShell(); go('/');
  }

  // ---------- Composants ----------
  function lotCard(l) {
    const img = l.images[0] || '/ph/box.svg';
    const label = l.status === 'sold' ? t('lot.final_price') : l.bids_count ? t('lot.current_bid') : t('lot.start_price');
    const w = S.watched.has(l.id);
    const badges = [l.status === 'live' && l.ends_at - now() < 3600e3 ? `<span class="badge badge-live">${e(t('live.badge'))}</span>` : '',
      l.status === 'upcoming' ? `<span class="badge badge-brand">${e(t('status.upcoming'))}</span>` : '',
      l.status === 'sold' ? `<span class="badge badge-dark">${e(t('status.sold'))}</span>` : '', l.status === 'unsold' ? `<span class="badge badge-muted">${e(t('status.unsold'))}</span>` : '',
      l.buy_now_price && l.status === 'live' ? `<span class="badge badge-accent">${icon('zap', 'sm')}${e(t('lot.buy_now'))}</span>` : ''].join('');
    return `<article class="lot-card" data-lot="${l.id}">
      <a class="thumb" href="/lot/${l.id}"><img src="${e(img)}" alt="" loading="lazy" decoding="async" width="400" height="400"><div class="badges">${badges}</div></a>
      <button class="heart ${w ? 'on' : ''}" data-watch="${l.id}" aria-pressed="${w}" aria-label="${e(t(w ? 'lot.watching' : 'lot.watch'))}">${icon('heart')}</button>
      <a class="title" href="/lot/${l.id}">${e(tr(l, 'title'))}</a>
      <div class="price-box"><div class="price-label" data-f="label">${e(label)}</div><div class="price" data-f="price">${money(l.status === 'sold' ? l.final_price : l.current_price)}</div></div>
      <div class="meta">${countdown(l)}<span><span data-f="bids">${l.bids_count}</span> ${e(t('lot.bids'))}</span></div>
    </article>`;
  }
  function updateCards(l) {
    for (const c of $$(`[data-lot="${l.id}"]`)) {
      bump(c.querySelector('[data-f="price"]'), money(l.status === 'sold' ? l.final_price : l.current_price));
      const b = c.querySelector('[data-f="bids"]'); if (b) b.textContent = l.bids_count;
      const lab = c.querySelector('[data-f="label"]'); if (lab) lab.textContent = l.status === 'sold' ? t('lot.final_price') : l.bids_count ? t('lot.current_bid') : t('lot.start_price');
      const cd = c.querySelector('[data-cd]'); if (cd) { cd.dataset.end = l.ends_at; cd.dataset.status = l.status; cd.dataset.start = l.starts_at; }
    }
  }
  function saleCard(s) {
    const th = s.thumbs.length ? s.thumbs : [s.cover || '/ph/box.svg'];
    const live = s.status === 'live';
    return `<a class="sale-card" href="/vente/${s.id}">
      <div class="sale-mosaic">${[th[0], th[1] || th[0], th[2] || th[0]].map(src => `<img src="${e(src)}" alt="" loading="lazy" decoding="async">`).join('')}
        <div class="badges">${live ? `<span class="badge badge-live">${e(t('live.badge'))}</span>` : `<span class="badge">${icon('calendar', 'sm')} ${e(fmtDate(s.starts_at))}</span>`}</div>
        <span class="badge badge-dark count">${icon('users', 'sm')} ${s.bidders} · ${s.lots_count} ${e(t('sale.lots'))}</span></div>
      <div><div class="by">${live ? e(t('sale.ends')) + ' ' + e(fmtDate(s.ends_at)) : e(t('sale.starts')) + ' ' + e(fmtDate(s.starts_at))}</div><h3>${e(tr(s, 'title'))}</h3></div>
    </a>`;
  }
  const stars = (n) => `<span class="stars" aria-label="${n}/5">${[1, 2, 3, 4, 5].map(i => `<span class="${i <= Math.round(n) ? '' : 'off'}">${icon('star')}</span>`).join('')}</span>`;
  const empty = (msg = t('misc.empty'), ic = 'box') => `<div class="empty">${icon(ic)}<p>${e(msg)}</p></div>`;
  const section = (title, body, link, kicker) => `<section class="section"><div class="container">
      <div class="section-head"><div>${kicker ? `<span class="kicker">${e(kicker)}</span>` : ''}<h2>${e(title)}</h2></div>${link ? `<a class="see-all" href="${link}">${e(t('home.see_all'))} ${icon('right', 'sm flip')}</a>` : ''}</div>${body}</div></section>`;
  const loading = () => `<div class="container"><div class="lot-grid" style="padding:24px 0">${'<div class="skeleton" style="aspect-ratio:1/1.35"></div>'.repeat(8)}</div></div>`;

  // ---------- Vues ----------
  const views = {};

  views.home = async (v) => {
    const d = await api('/home');
    const heros = d.banners.filter(b => b.kind === 'hero');
    const promo = d.banners.find(b => b.kind === 'promo');
    const liveLot = d.live[0];
    const cats = S.boot.categories;
    v.innerHTML = `
      <section class="hero"><div class="container">
        ${heros.length ? `<div class="hero-slider" id="hero">${heros.map((b, i) => `<div class="hero-slide ${i === 0 ? 'on' : ''}">
            <div class="hero-copy"><span class="kicker">${e(t('hero.kicker'))}</span><h1 class="display">${e(tr(b, 'title'))}</h1><p>${e(tr(b, 'subtitle'))}</p>
              <div class="hero-cta"><a class="btn btn-primary btn-lg" href="${e(b.link || '/ventes')}">${e(t('hero.cta'))}</a><a class="btn btn-outline btn-lg" href="/live">${icon('live', 'sm')} ${e(t('hero.cta2'))}</a></div></div>
            <div class="hero-media" style="background-image:url('${e(b.image)}')"></div></div>`).join('')}
          ${heros.length > 1 ? `<div class="hero-dots">${heros.map((_, i) => `<button aria-label="${i + 1}" class="${i === 0 ? 'on' : ''}" data-dot="${i}"></button>`).join('')}</div>` : ''}</div>`
          : `<h1 class="display">${e(t('hero.title'))}</h1><p class="muted">${e(t('hero.subtitle'))}</p>`}
        <div class="hero-search"><form class="search" role="search" data-search2><input type="search" name="q" placeholder="${e(t('search.placeholder'))}" aria-label="${e(t('search.button'))}"><button aria-label="${e(t('search.button'))}">${icon('search')}</button></form></div>
        <div class="trust"><div>${icon('shield')} ${e(t('trust.verified'))}</div><div>${icon('wallet')} ${e(t('trust.mobile_money'))}</div><div>${icon('truck')} ${e(t('trust.delivery'))}</div><div>${icon('chat')} ${e(t('trust.support'))}</div></div>
      </div></section>
      ${section(t('home.categories'), `<div class="cat-grid">${cats.map(c => `<a class="cat-tile" href="/c/${c.slug}"><img src="${e(c.image || `/ph/${c.slug}.svg?v=cat`)}" alt="" loading="lazy" decoding="async"><span class="n">${e(tr(c, 'name').split(' (')[0])}</span><small>${c.count} ${e(t('sale.lots'))}</small></a>`).join('')}</div>`)}
      ${liveLot ? `<section class="section"><div class="container"><div class="rule-title">${e(t('home.live_now'))}</div>${livePanel(liveLot, { compact: true })}</div></section>` : ''}
      ${d.favorites.length ? section(t('home.favorites_title'), `<div class="row-scroll">${d.favorites.map(lotCard).join('')}</div>`, '/recherche?favorite=1', t('home.favorites_kicker')) : ''}
      ${section(t('home.ending_soon'), d.ending.length ? `<div class="row-scroll">${d.ending.map(lotCard).join('')}</div>` : empty(), '/recherche?sort=ending')}
      ${d.sales.length ? section(t('home.upcoming_sales'), `<div class="row-scroll">${d.sales.map(saleCard).join('')}</div>`, '/ventes') : ''}
      ${d.featured.length ? section(t('nav.featured'), `<div class="lot-grid">${d.featured.slice(0, 8).map(lotCard).join('')}</div>`, '/recherche?featured=1') : ''}
      ${section(t('home.how_title'), `<ol class="steps">${[1, 2, 3, 4].map(n => `<li class="step"><span class="mono">0${n}</span><h3>${e(t(`home.how${n}_t`))}</h3><p>${e(t(`home.how${n}_d`))}</p></li>`).join('')}</ol>`, '/page/how')}
      ${d.reviews.length ? section(t('home.reviews'), `<div class="review-summary"><span class="score">${d.stats.rating}</span><div>${stars(d.stats.rating)}<div class="small muted">${d.stats.reviews} ${e(t('home.reviews').toLowerCase())}</div></div></div>
        <div class="reviews">${d.reviews.map(r => `<article class="review">${stars(r.rating)}<p>${e(r.comment)}</p><div class="who"><span class="avatar">${e(r.author_name[0] || '?')}</span><div><b>${e(r.author_name)}</b><div class="muted small">${e(ago(r.created_at))}</div></div></div></article>`).join('')}</div>`) : ''}
      ${d.partners.length ? section(t('home.partners'), `<div class="partners"><div class="partners-track">${[...d.partners, ...d.partners].map(p => `<a class="partner" href="${e(p.url || '#')}" target="_blank" rel="noopener" title="${e(p.name)}"><img src="${e(p.logo)}" alt="${e(p.name)}" loading="lazy"></a>`).join('')}</div></div>`) : ''}
      <section class="section"><div class="container"><div class="promo"><div><h2 class="display">${e(promo ? tr(promo, 'title') : t('home.sell_cta_t'))}</h2><p>${e(promo ? tr(promo, 'subtitle') : t('home.sell_cta_d'))}</p></div><a class="btn btn-accent btn-lg" href="${e(promo?.link || '/vendre')}">${icon('tag', 'sm')} ${e(t('nav.sell'))}</a></div></div></section>`;
    $('[data-search2]', v).onsubmit = (ev) => { ev.preventDefault(); go('/recherche?q=' + encodeURIComponent(ev.target.q.value.trim())); };
    // Carrousel héros
    const slides = $$('.hero-slide', v);
    if (slides.length > 1) {
      let i = 0;
      const show = (n) => { i = (n + slides.length) % slides.length; slides.forEach((s, k) => s.classList.toggle('on', k === i)); $$('[data-dot]', v).forEach((d2, k) => d2.classList.toggle('on', k === i)); };
      $$('[data-dot]', v).forEach(b => b.onclick = () => show(Number(b.dataset.dot)));
      const timer = setInterval(() => document.body.contains(slides[0]) ? show(i + 1) : clearInterval(timer), 7000);
    }
    if (liveLot) { bindLivePanel(v, liveLot); S.socket?.emit('lot:join', liveLot.id); S.view = { type: 'home', lot: liveLot }; }
  };

  // Panneau "lot en direct" (accueil + salle live)
  function livePanel(l, { compact } = {}) {
    const steps = [1, 2, 4, 10].map(k => k * l.increment);
    return `<div class="live-panel" data-live-panel="${l.id}">
      <div class="live-top">
        <a class="live-visual" href="/lot/${l.id}"><img src="${e(l.images[0] || '')}" alt="" decoding="async"><div class="badges"><span class="badge badge-live">${e(t('live.badge'))}</span><span class="badge badge-dark">${e(t('lot.lot_no'))} ${l.lot_number || l.id}</span></div></a>
        <div class="live-info">
          <span class="kicker">${e(t('live.current_lot'))}</span>
          <h2>${compact ? `<a href="/lot/${l.id}">${e(tr(l, 'title'))}</a>` : e(tr(l, 'title'))}</h2>
          <div><div class="big-timer" data-bigtimer data-end="${l.ends_at}" data-total="${Math.min(l.ends_at - l.starts_at, 10 * 60e3)}"><b>${dur(l.ends_at - now())}</b><small>${e(t('lot.time_left'))}</small></div><div class="timer-bar"><i style="width:100%"></i></div></div>
          <div class="live-stats">
            <div><div class="k">${e(t('lot.start_price'))}</div><div class="v">${money(l.start_price)}</div></div>
            <div><div class="k">${e(t('lot.current_bid'))}</div><div class="v hot" data-lf="price">${money(l.current_price)}</div></div>
            <div><div class="k">${e(t('lot.bids_count'))}</div><div class="v" data-lf="bids">${l.bids_count}</div></div>
            <div><div class="k">${e(t('lot.last_bidder'))}</div><div class="v" data-lf="leader" style="font-size:1rem">${l.leader_code ? (l.is_leader ? e(t('lot.you')) : e(l.leader_code)) : '—'}</div></div>
          </div>
          <div class="quick-bids" role="group" aria-label="${e(t('lot.your_bid'))}">${steps.map((s, i) => `<button type="button" data-step="${s}" class="${i === 0 ? 'on' : ''}">+${money(s)}</button>`).join('')}</div>
          <button class="btn btn-accent btn-lg btn-block" data-live-bid>${icon('gavel', 'sm')} <span>${e(t('lot.bid_button'))} ${money(l.min_next)}</span></button>
          <div class="small muted" style="text-align:center">${e(t('live.bid_step'))} ${money(l.increment)} · ${e(t('lot.anti_snipe_help'))}</div>
        </div>
      </div></div>`;
  }
  function bindLivePanel(root, l) {
    const panel = $(`[data-live-panel="${l.id}"]`, root); if (!panel) return;
    let step = l.increment;
    const btn = $('[data-live-bid]', panel);
    const amount = () => l.bids_count ? l.current_price + step : Math.max(l.start_price, l.start_price + step - l.increment);
    const refresh = () => { btn.querySelector('span').textContent = `${t('lot.bid_button')} ${money(amount())}`; };
    $$('[data-step]', panel).forEach(b => b.onclick = () => { step = Number(b.dataset.step); $$('[data-step]', panel).forEach(x => x.classList.toggle('on', x === b)); refresh(); });
    btn.onclick = async () => {
      if (!requireLogin()) return;
      btn.disabled = true;
      try { await api(`/lots/${l.id}/bid`, { method: 'POST', body: { amount: amount() } }); toast(e(t('lot.bid_ok')), { type: 'ok' }); }
      catch (err) { toast(e(err.message), { type: 'err' }); }
      finally { btn.disabled = false; }
    };
    panel._update = (u) => {
      Object.assign(l, u, { is_leader: S.me && u.leader_code && u.leader_code === l.my_code });
      bump($('[data-lf="price"]', panel), money(l.current_price));
      bump($('[data-lf="bids"]', panel), String(l.bids_count));
      $('[data-lf="leader"]', panel).textContent = l.leader_code ? (l.is_leader ? t('lot.you') : l.leader_code) : '—';
      const bt = $('[data-bigtimer]', panel); bt.dataset.end = l.ends_at;
      const steps = [1, 2, 4, 10].map(k => k * l.increment);
      $$('[data-step]', panel).forEach((b, i) => { b.dataset.step = steps[i]; b.textContent = '+' + money(steps[i]); if (b.classList.contains('on')) step = steps[i]; });
      refresh();
    };
  }

  // Catalogue : catégorie / recherche / ventes filtrées
  views.catalog = async (v, { cat, sub }) => {
    const c = cat ? S.boot.categories.find(x => x.slug === cat) : null;
    if (cat && !c) return views.notfound(v);
    const params = new URLSearchParams(location.search);
    if (c) params.set('category', c.slug);
    if (sub) params.set('sub', sub);
    const d = await api('/lots?' + params.toString());
    const subObj = c && sub ? c.subs.find(s => s.slug === sub) : null;
    const title = subObj ? tr(subObj, 'name') : c ? tr(c, 'name') : params.get('q') ? `« ${params.get('q')} »` : params.get('favorite') ? t('home.favorites_title') : params.get('sort') === 'ending' ? t('nav.ending') : t('nav.sales');
    document.title = `${title} — ${setting('site_name')}`;
    const qv = (k) => e(params.get(k) || '');
    const filt = (c ? c.filters : []).map(f => f.type === 'range'
      ? `<div class="filter-group"><h4>${e(S.lang === 'ar' ? f.label_ar : f.label_fr)}</h4><div class="filter-row"><input class="input" type="number" inputmode="numeric" name="a_${f.key}_min" placeholder="${e(t('filters.min'))}" value="${qv('a_' + f.key + '_min')}"><input class="input" type="number" inputmode="numeric" name="a_${f.key}_max" placeholder="${e(t('filters.max'))}" value="${qv('a_' + f.key + '_max')}"></div></div>`
      : `<div class="filter-group"><h4>${e(S.lang === 'ar' ? f.label_ar : f.label_fr)}</h4><select class="select" name="a_${f.key}"><option value="">${e(t('filters.all'))}</option>${f.options.map(o => `<option ${params.get('a_' + f.key) === o ? 'selected' : ''}>${e(o)}</option>`).join('')}</select></div>`).join('');
    v.innerHTML = `<div class="container">
      ${c ? `<div class="breadcrumb"><a href="/">${e(t('nav.home'))}</a>${icon('right', 'sm flip')}<a href="/c/${c.slug}">${e(tr(c, 'name'))}</a>${subObj ? `${icon('right', 'sm flip')}<span>${e(tr(subObj, 'name'))}</span>` : ''}</div>` : ''}
      <div class="cat-hero">${c ? `<span class="ico-wrap">${icon(c.icon, 'lg')}</span>` : ''}<div><h1 class="display">${e(title)}</h1><div class="muted">${d.total} ${e(t('filters.results'))}</div></div></div>
      ${c ? `<div class="chips"><a class="chip ${!sub ? 'on' : ''}" href="/c/${c.slug}">${e(t('filters.all'))} <small>${c.count}</small></a>${c.subs.map(s => `<a class="chip ${s.slug === sub ? 'on' : ''}" href="/c/${c.slug}/${s.slug}">${e(tr(s, 'name'))} <small>${s.count}</small></a>`).join('')}</div>` : ''}
      <div class="catalog">
        <form class="filters" id="filters">
          <div class="filters-close" style="display:flex;justify-content:space-between;align-items:center"><h3>${e(t('filters.title'))}</h3><button type="button" class="icon-btn" data-fclose aria-label="${e(t('misc.close'))}">${icon('x')}</button></div>
          ${params.get('q') ? `<input type="hidden" name="q" value="${qv('q')}">` : ''}
          <div class="filter-group"><h4>${e(t('filters.price'))}</h4><div class="filter-row"><input class="input" type="number" inputmode="numeric" name="min" placeholder="${e(t('filters.min'))}" value="${qv('min')}"><input class="input" type="number" inputmode="numeric" name="max" placeholder="${e(t('filters.max'))}" value="${qv('max')}"></div></div>
          <div class="filter-group"><h4>${e(t('filters.status'))}</h4><select class="select" name="status"><option value="">${e(t('status.live'))} + ${e(t('status.upcoming'))}</option>${['live', 'upcoming', 'sold'].map(s => `<option value="${s}" ${params.get('status') === s ? 'selected' : ''}>${e(t('status.' + s))}</option>`).join('')}</select></div>
          ${filt}
          <div class="filter-group"><h4>${e(t('filters.condition'))}</h4><select class="select" name="condition"><option value="">${e(t('filters.all'))}</option>${['new', 'like_new', 'good', 'fair', 'for_parts'].map(k => `<option value="${k}" ${params.get('condition') === k ? 'selected' : ''}>${e(t('cond.' + k))}</option>`).join('')}</select></div>
          <div class="filter-group"><h4>${e(t('filters.location'))}</h4><select class="select" name="location"><option value="">${e(t('filters.all'))}</option>${d.locations.map(k => `<option ${params.get('location') === k ? 'selected' : ''}>${e(k)}</option>`).join('')}</select></div>
          <div class="filter-group" style="display:grid;gap:10px"><label class="check"><input type="checkbox" name="buy_now" value="1" ${params.get('buy_now') ? 'checked' : ''}> ${e(t('filters.buy_now_only'))}</label><label class="check"><input type="checkbox" name="no_reserve" value="1" ${params.get('no_reserve') ? 'checked' : ''}> ${e(t('filters.no_reserve_only'))}</label></div>
          <div style="display:flex;gap:8px;padding:14px 0"><button class="btn btn-primary" style="flex:1">${e(t('filters.apply'))}</button><a class="btn btn-outline" href="${location.pathname}">${e(t('filters.reset'))}</a></div>
        </form>
        <div>
          <div class="toolbar"><button class="btn btn-outline btn-sm filter-open-btn" data-fopen>${icon('filter', 'sm')} ${e(t('filters.title'))}</button>
            <label class="small muted">${e(t('filters.sort'))} <select class="select" id="sort">${['ending', 'newest', 'price_asc', 'price_desc', 'popular'].map(s => `<option value="${s}" ${(params.get('sort') || 'ending') === s ? 'selected' : ''}>${e(t('sort.' + s))}</option>`).join('')}</select></label></div>
          ${d.lots.length ? `<div class="lot-grid">${d.lots.map(lotCard).join('')}</div>` : empty(t('misc.empty'), 'search')}
          ${d.pages > 1 ? `<nav class="pagination">${Array.from({ length: d.pages }, (_, i) => `<button data-page="${i + 1}" class="${d.page === i + 1 ? 'on' : ''}">${i + 1}</button>`).join('')}</nav>` : ''}
        </div>
      </div></div>`;
    const apply = (extra = {}) => {
      const fd = new FormData($('#filters'));
      const p = new URLSearchParams();
      for (const [k, val] of fd) if (val !== '') p.set(k, val);
      const sort = $('#sort').value; if (sort !== 'ending') p.set('sort', sort);
      for (const k of ['favorite', 'featured', 'sale']) if (params.get(k)) p.set(k, params.get(k));
      for (const [k, val] of Object.entries(extra)) p.set(k, val);
      go(location.pathname + (p.toString() ? '?' + p : ''));
    };
    $('#filters').onsubmit = (ev) => { ev.preventDefault(); apply(); };
    $('#sort').onchange = () => apply();
    $$('[data-page]', v).forEach(b => b.onclick = () => { apply({ page: b.dataset.page }); scrollTo(0, 0); });
    $('[data-fopen]', v).onclick = () => $('#filters').classList.add('open');
    $('[data-fclose]', v).onclick = () => $('#filters').classList.remove('open');
  };

  // Fiche lot
  views.lot = async (v, { id }) => {
    const d = await api('/lots/' + id);
    const l = d.lot;
    S.view = { type: 'lot', id: l.id, data: d };
    S.socket?.emit('lot:join', l.id);
    document.title = `${tr(l, 'title')} — ${setting('site_name')}`;
    const cat = d.category, specs = Object.entries(l.attrs);
    const labelFor = (k) => { const f = (cat?.filters || []).find(x => x.key === k); return f ? (S.lang === 'ar' ? f.label_ar : f.label_fr) : k; };
    v.innerHTML = `<div class="container">
      <div class="breadcrumb"><a href="/">${e(t('nav.home'))}</a>${cat ? `${icon('right', 'sm flip')}<a href="/c/${cat.slug}">${e(tr(cat, 'name'))}</a>` : ''}${d.subcategory ? `${icon('right', 'sm flip')}<a href="/c/${cat.slug}/${d.subcategory.slug}">${e(tr(d.subcategory, 'name'))}</a>` : ''}</div>
      <div class="lot-layout">
        <div style="display:grid;gap:22px;min-width:0">
          <div><div class="gallery-main" id="gal"><img src="${e(l.images[0] || '')}" alt="${e(tr(l, 'title'))}" id="gal-img">
            ${l.images.length > 1 ? `<button class="gallery-nav prev" data-g="-1" aria-label="${e(t('misc.prev'))}">${icon('left', 'flip')}</button><button class="gallery-nav next" data-g="1" aria-label="${e(t('misc.next'))}">${icon('right', 'flip')}</button><span class="badge badge-dark gallery-count" id="gal-n">1/${l.images.length}</span>` : ''}</div>
            ${l.images.length > 1 ? `<div class="thumbs">${l.images.map((src, i) => `<button data-thumb="${i}" class="${i === 0 ? 'on' : ''}" aria-label="${i + 1}"><img src="${e(src)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}</div>
          ${cat?.requires_expiry && l.expiry_date ? `<div class="alert alert-warn">${icon('alert')}<div><b>${e(t('lot.expiry'))} : ${e(fmtDate(Date.parse(l.expiry_date), { day: 'numeric', month: 'long', year: 'numeric' }))}</b><br>${e(t('lot.expiry_notice'))}</div></div>` : ''}
          <section class="panel"><h3>${icon('file')} ${e(t('lot.description'))}</h3><div class="rich">${tr(l, 'description')}</div></section>
          <section class="panel"><h3>${icon('info')} ${e(t('lot.details'))}</h3><dl class="specs">
            <dt>${e(t('lot.lot_no'))}</dt><dd>${l.lot_number || l.id}</dd>
            ${l.condition ? `<dt>${e(t('lot.condition'))}</dt><dd>${e(t('cond.' + l.condition))}</dd>` : ''}
            ${l.location ? `<dt>${e(t('lot.location'))}</dt><dd>${e(l.location)}</dd>` : ''}
            ${specs.map(([k, val]) => `<dt>${e(labelFor(k))}</dt><dd>${e(typeof val === 'number' && val > 9999 ? group(val) : val)}</dd>`).join('')}
            <dt>${e(t('lot.ends_at'))}</dt><dd>${e(fmtDate(l.ends_at))}</dd>
          </dl></section>
          <section class="panel"><h3>${icon('clock')} ${e(t('lot.history'))} <span class="muted small">(<span id="h-count">${d.history.length}</span>)</span></h3><ul class="history" id="history">${historyHtml(d.history, l)}</ul></section>
        </div>
        <aside class="lot-aside" style="display:grid;gap:16px;align-content:start">
          <div class="bid-box" id="bid-box"></div>
          ${d.seller ? `<section class="panel"><h3>${icon('user')} ${e(t('lot.seller'))}</h3><div class="seller-card"><span class="avatar">${e(d.seller.name[0])}</span><div><b>${e(d.seller.name)}</b>${d.seller.verified ? `<div class="verified">${icon('shield', 'sm')} ${e(t('lot.verified_seller'))}</div>` : ''}<div class="small muted">${d.seller.rating ? stars(d.seller.rating) + ` ${d.seller.rating} (${d.seller.reviews})` : ''} · ${d.seller.sold} ${e(t('status.sold').toLowerCase())}</div></div></div></section>` : ''}
          <section class="panel"><h3>${icon('truck')} ${e(t('lot.delivery'))}</h3><div class="zone-list">${S.boot.zones.map(z => `<div><span>${e(tr(z, 'name'))}</span><b>${z.fee ? money(z.fee) : e(t('pay.free'))}</b></div>`).join('')}</div><p class="small muted">${e(t('lot.delivery_help'))}</p></section>
          <a class="wa-inline" href="${waLink(`${t('misc.whatsapp_hello')} — ${t('lot.lot_no')} ${l.lot_number || l.id} : ${tr(l, 'title')} ${location.href}`)}" target="_blank" rel="noopener">${icon('chat')} ${e(t('lot.whatsapp_ask'))}</a>
        </aside>
      </div>
      ${d.similar.length ? `<section class="section" style="padding-bottom:0"><div class="section-head"><h2>${e(t('lot.similar'))}</h2></div><div class="row-scroll">${d.similar.map(lotCard).join('')}</div></section>` : ''}
    </div>
    <div class="mobile-bidbar" id="mbar"></div>`;
    document.body.classList.add('has-bidbar');
    // Galerie (clic, flèches, swipe)
    let gi = 0;
    const show = (n) => { gi = (n + l.images.length) % l.images.length; $('#gal-img').src = l.images[gi]; $$('[data-thumb]').forEach((b, k) => b.classList.toggle('on', k === gi)); const n2 = $('#gal-n'); if (n2) n2.textContent = `${gi + 1}/${l.images.length}`; };
    $$('[data-g]', v).forEach(b => b.onclick = () => show(gi + Number(b.dataset.g) * (S.lang === 'ar' ? -1 : 1)));
    $$('[data-thumb]', v).forEach(b => b.onclick = () => show(Number(b.dataset.thumb)));
    let sx = null; const g = $('#gal');
    g.addEventListener('touchstart', ev => { sx = ev.touches[0].clientX; }, { passive: true });
    g.addEventListener('touchend', ev => { if (sx == null) return; const dx = ev.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) show(gi + (dx < 0 ? 1 : -1)); sx = null; });
    renderBidBox();
  };
  function historyHtml(h, l) {
    if (!h.length) return `<li><span class="muted">${e(t('lot.no_bids'))}</span></li>`;
    return h.map((b, i) => historyRow(b, l, i === 0)).join('');
  }
  const historyRow = (b, l, top, isNew) => `<li class="${top ? 'top' : ''} ${isNew ? 'new' : ''}"><span>${b.bidder === l.my_code ? `<b>${e(t('lot.you'))}</b>` : e(b.bidder)}${b.is_auto ? ` <span class="badge badge-muted">${e(t('lot.auto'))}</span>` : ''}</span><span class="amt">${money(b.amount)}</span><span class="when">${e(fmtDate(b.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</span></li>`;

  function renderBidBox() {
    const d = S.view.data, l = d.lot, box = $('#bid-box'); if (!box) return;
    const typed = $('#bid-amount')?.value;
    const prevPrice = $('[data-f="bigprice"]', box)?.textContent;
    const open = l.status === 'live' && l.ends_at > now();
    const w = S.watched.has(l.id);
    const reserve = !l.has_reserve ? `<span class="reserve met">${icon('check', 'sm')} ${e(t('lot.no_reserve'))}</span>` : l.reserve_met ? `<span class="reserve met">${icon('check', 'sm')} ${e(t('lot.reserve_met'))}</span>` : `<span class="reserve not">${icon('info', 'sm')} ${e(t('lot.reserve_not_met'))}</span>`;
    const leader = S.me && l.bids_count && open ? (l.is_leader ? `<div class="leader-box yes">${icon('check', 'sm')} ${e(t('lot.leader_you'))}${d.my_max > l.current_price ? ` · ${e(t('lot.auto'))} ≤ ${money(d.my_max)}` : ''}</div>` : (d.history.some(h => h.bidder === l.my_code) ? `<div class="leader-box no">${icon('alert', 'sm')} ${e(t('lot.outbid'))}</div>` : '')) : '';
    box.innerHTML = `
      <div class="lot-sub"><span class="badge badge-dark">${e(t('lot.lot_no'))} ${l.lot_number || l.id}</span><span class="badge ${l.status === 'live' ? 'badge-live' : 'badge-muted'}">${e(t('status.' + l.status))}</span><span>${icon('eye', 'sm')} ${l.views}</span><span>${icon('heart', 'sm')} ${d.watchers}</span></div>
      <h1 class="lot-title display">${e(tr(l, 'title'))}</h1>
      ${open || l.status === 'upcoming' ? `<div><div class="price-label">${e(l.status === 'upcoming' ? t('lot.starts_in') : t('lot.time_left'))}</div><div class="big-timer">${countdown(l, 'countdown')}</div><div class="small muted">${e(t('lot.ends_at'))} ${e(fmtDate(l.ends_at))}</div></div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap">
        <div><div class="price-label">${e(l.status === 'sold' ? t('lot.final_price') : l.bids_count ? t('lot.current_bid') : t('lot.start_price'))}</div><div class="price" data-f="bigprice" style="font-size:1.9rem">${money(l.status === 'sold' ? l.final_price : l.current_price)}</div></div>
        <div style="text-align:end"><div class="small muted">${l.bids_count} ${e(t('lot.bids'))}</div>${reserve}</div>
      </div>
      ${leader}
      ${l.is_winner ? `<div class="alert alert-ok">${icon('gavel')}<div><b>${e(t('lot.won_by_you'))}</b>${d.invoice ? `<br><a class="see-all" href="/facture/${d.invoice.id}">${e(t('lot.go_pay'))}</a>` : ''}</div></div>` : ''}
      ${open ? `<form class="bid-form" id="bid-form">
          <div class="quick-bids">${[0, 1, 3].map(k => l.min_next + k * l.increment).map(a => `<button type="button" data-q="${a}">${money(a)}</button>`).join('')}</div>
          <label class="sr-only" for="bid-amount">${e(t('lot.your_bid'))}</label>
          <div class="bid-input"><input class="input" id="bid-amount" type="number" inputmode="numeric" min="${l.min_next}" step="1" value="${e(typed && Number(typed) >= l.min_next ? typed : l.min_next)}" required>
          <button class="btn btn-accent btn-lg">${icon('gavel', 'sm')} ${e(t('lot.bid_button'))}</button></div>
          <div class="small muted">${e(t('lot.min_bid'))} : <b>${money(l.min_next)}</b> · ${e(t('lot.increment'))} ${money(l.increment)}</div>
          <details class="auto-bid"><summary>${icon('zap', 'sm')} ${e(t('lot.max_bid'))}</summary><p class="small muted">${e(t('lot.auto_bid_help'))}</p>
            <div class="bid-input"><input class="input" id="max-amount" type="number" inputmode="numeric" min="${l.min_next}" placeholder="${l.min_next * 2}"><button type="button" class="btn btn-primary" id="max-btn">${e(t('lot.set_max'))}</button></div></details>
          ${l.buy_now_price && (l.current_price < l.buy_now_price) ? `<button type="button" class="btn btn-dark btn-block" id="buy-now">${icon('zap', 'sm')} ${e(t('lot.buy_now'))} · ${money(l.buy_now_price)}</button>` : ''}
          ${!S.me ? `<div class="small muted">${icon('lock', 'sm')} ${e(t('lot.login_to_bid'))}</div>` : !S.me.verified ? `<div class="alert alert-info small">${icon('info', 'sm')} ${e(t('account.verify_help'))}</div>` : ''}
        </form>` : ''}
      <div style="display:flex;gap:8px"><button class="btn btn-outline" style="flex:1" id="watch-btn" aria-pressed="${w}">${icon('heart', 'sm')} ${e(t(w ? 'lot.watching' : 'lot.watch'))}</button><button class="btn btn-outline" id="share-btn" aria-label="${e(t('lot.share'))}">${icon('share', 'sm')}</button></div>
      <p class="small muted" style="margin:0">${icon('info', 'sm')} ${e(t('lot.anti_snipe_help'))}</p>`;
    const bigPrice = $('[data-f="bigprice"]', box);
    if (MOTION && prevPrice && bigPrice && prevPrice !== bigPrice.textContent) bigPrice.classList.add('bump');
    const mbar = $('#mbar');
    if (mbar) mbar.innerHTML = open ? `<div><div class="price-label">${e(t('lot.current_bid'))}</div><div class="price">${money(l.current_price)}</div></div><button class="btn btn-accent" data-scroll-bid>${icon('gavel', 'sm')} ${e(t('lot.bid_button'))} ${money(l.min_next)}</button>` : `<div class="price">${money(l.status === 'sold' ? l.final_price : l.current_price)}</div><span class="badge badge-muted">${e(t('status.' + l.status))}</span>`;
    $('[data-scroll-bid]')?.addEventListener('click', () => { $('#bid-box').scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => $('#bid-amount')?.focus(), 400); });
    $$('[data-q]', box).forEach(b => b.onclick = () => { $('#bid-amount').value = b.dataset.q; });
    const send = async (body, btn) => {
      if (!requireLogin()) return;
      if (btn) btn.disabled = true;
      try {
        const r = await api(`/lots/${l.id}/bid`, { method: 'POST', body });
        toast(e(r.leader ? t('lot.bid_ok') : t('lot.outbid')), { type: r.leader ? 'ok' : 'err' });
        if (body.max) d.my_max = Math.max(d.my_max, body.max);
        $('#bid-amount') && ($('#bid-amount').value = '');
      } catch (err) { toast(e(err.message), { type: 'err' }); }
      finally { if (btn) btn.disabled = false; }
    };
    $('#bid-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const a = Number($('#bid-amount').value);
      if (!(await confirmBox(`${e(t('lot.your_bid'))} : ${money(a)}`, t('lot.bid_button')))) return;
      send({ amount: a }, ev.submitter);
    });
    $('#max-btn')?.addEventListener('click', (ev) => { const m = Number($('#max-amount').value); if (m >= l.min_next) send({ amount: l.min_next, max: m }, ev.currentTarget); else toast(e(`${t('lot.min_bid')} : ${money(l.min_next)}`), { type: 'err' }); });
    $('#buy-now')?.addEventListener('click', async () => {
      if (!requireLogin()) return;
      if (!(await confirmBox(`${e(t('lot.buy_now_confirm'))} ${money(l.buy_now_price)} ?`, t('lot.buy_now')))) return;
      try { await api(`/lots/${l.id}/buy-now`, { method: 'POST' }); route(); } catch (err) { toast(e(err.message), { type: 'err' }); }
    });
    $('#watch-btn').onclick = () => toggleWatch(l.id).then(renderBidBox);
    $('#share-btn').onclick = async () => {
      const data = { title: tr(l, 'title'), url: location.href };
      if (navigator.share) navigator.share(data).catch(() => {});
      else { await navigator.clipboard?.writeText(location.href); toast('✓ ' + e(location.href), { type: 'ok' }); }
    };
  }

  async function toggleWatch(id) {
    if (!requireLogin()) return;
    try {
      const r = await api(`/lots/${id}/watch`, { method: 'POST' });
      r.watched ? S.watched.add(id) : S.watched.delete(id);
      $$(`[data-watch="${id}"]`).forEach(b => { b.classList.toggle('on', r.watched); b.setAttribute('aria-pressed', r.watched); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); });
      toast(e(t(r.watched ? 'lot.watching' : 'lot.watch')), { type: 'ok', iconName: 'heart', ms: 2000 });
    } catch (err) { toast(e(err.message), { type: 'err' }); }
  }

  // Salle de vente en direct
  views.live = async (v) => {
    const d = await api('/live');
    document.body.classList.add('live-mode');
    const wrap = document.createElement('div');
    v.innerHTML = '';
    v.appendChild(wrap);
    wrap.className = 'live-room';
    if (!d.sale || !d.current) {
      wrap.innerHTML = `<div class="container"><div class="live-head"><h1 class="display">${e(t('live.title'))}</h1></div>${empty(t('live.no_live'), 'live')}
        ${d.upcoming.length ? `<div class="rule-title">${e(t('home.upcoming_sales'))}</div><div class="row-scroll">${d.upcoming.map(saleCard).join('')}</div>` : ''}</div>`;
      return;
    }
    const l = d.current;
    S.view = { type: 'live', lot: l, data: d };
    S.socket?.emit('live:join'); S.socket?.emit('lot:join', l.id);
    wrap.innerHTML = `<div class="container">
      <div class="live-head"><div><span class="badge badge-live">${e(t('live.badge'))}</span><h1 class="display" style="margin:8px 0 0;font-size:clamp(1.3rem,4vw,2rem)">${e(tr(d.sale, 'title'))}</h1></div>
        <span class="viewers">${icon('users', 'sm')} <span id="viewers">${d.viewers || 1}</span> ${e(t('live.viewers'))}</span></div>
      ${livePanel(l)}
      <div style="display:grid;gap:18px;margin-top:20px" class="live-cols">
        <section><div class="rule-title" style="color:#fff">${e(t('live.feed'))}</div><ul class="live-feed" id="live-feed">${d.history.length ? d.history.map(b => feedRow(b, l)).join('') : `<li class="muted">${e(t('lot.no_bids'))}</li>`}</ul></section>
        <section><div class="rule-title" style="color:#fff">${e(t('live.next_lots'))}</div><div class="next-strip">${d.next.map(n => `<a class="next-item" href="/lot/${n.id}"><img src="${e(n.images[0])}" alt="" loading="lazy"><div style="min-width:0"><div class="lotno">${e(t('lot.lot_no'))} ${n.lot_number || n.id}</div><div class="t">${e(tr(n, 'title'))}</div><div class="small muted">${e(t('lot.start_price'))} : <b style="color:#fff">${money(n.current_price)}</b></div></div></a>`).join('') || `<span class="muted">—</span>`}</div></section>
        ${d.past.length ? `<section><div class="rule-title" style="color:#fff">${e(t('live.past_lots'))}</div><div class="next-strip">${d.past.map(n => `<a class="next-item" href="/lot/${n.id}"><img src="${e(n.images[0])}" alt="" loading="lazy"><div style="min-width:0"><div class="t">${e(tr(n, 'title'))}</div><div class="small">${n.status === 'sold' ? `<span class="badge badge-ok">${e(t('status.sold'))}</span> ${money(n.final_price)}` : `<span class="badge badge-muted">${e(t('status.unsold'))}</span>`}</div></div></a>`).join('')}</div></section>` : ''}
        <a class="btn btn-outline" style="color:#fff;border-color:#2a3363;justify-self:center" href="/vente/${d.sale.id}">${e(t('live.all_lots'))} ${icon('right', 'sm flip')}</a>
      </div></div>`;
    bindLivePanel(wrap, l);
  };
  const feedRow = (b, l, isNew) => `<li class="${isNew ? 'new' : ''} ${b.bidder === l.my_code ? 'me' : ''}"><span>${b.bidder === l.my_code ? e(t('lot.you')) : e(b.bidder)}${b.is_auto ? ` · ${e(t('lot.auto'))}` : ''} <span class="muted small">${e(fmtDate(b.at, { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</span></span><b>${money(b.amount)}</b></li>`;

  views.sales = async (v) => {
    const d = await api('/sales');
    document.title = `${t('nav.sales')} — ${setting('site_name')}`;
    v.innerHTML = `<div class="container"><div class="cat-hero"><span class="ico-wrap">${icon('gavel', 'lg')}</span><h1 class="display">${e(t('nav.sales'))}</h1></div>
      ${d.sales.length ? `<div class="lot-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${d.sales.map(saleCard).join('')}</div>` : empty()}
      ${d.past.length ? `<section class="section"><div class="rule-title">${e(t('status.sold'))}</div><div class="lot-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${d.past.map(saleCard).join('')}</div></section>` : ''}</div>`;
  };
  views.sale = async (v, { id }) => {
    const d = await api('/sales/' + id);
    const s = d.sale;
    document.title = `${tr(s, 'title')} — ${setting('site_name')}`;
    v.innerHTML = `<div class="container"><div class="breadcrumb"><a href="/">${e(t('nav.home'))}</a>${icon('right', 'sm flip')}<a href="/ventes">${e(t('nav.sales'))}</a></div>
      <div class="cat-hero"><div><span class="badge ${s.status === 'live' ? 'badge-live' : 'badge-brand'}">${e(s.status === 'live' ? t('live.badge') : t('status.upcoming'))}</span>
        <h1 class="display" style="margin-top:8px">${e(tr(s, 'title'))}</h1><p class="muted" style="margin:0">${e(tr(s, 'description'))}</p>
        <div class="small muted">${e(t('sale.starts'))} ${e(fmtDate(s.starts_at))} · ${e(t('sale.ends'))} ${e(fmtDate(s.ends_at))} · ${s.lots_count} ${e(t('sale.lots'))}</div>
        ${s.is_live && s.status === 'live' ? `<a class="btn btn-accent" style="margin-top:12px" href="/live">${icon('live', 'sm')} ${e(t('hero.cta2'))}</a>` : ''}</div></div>
      <div class="lot-grid wide" style="margin-top:16px">${d.lots.map(lotCard).join('')}</div></div>`;
  };

  // ---------- Authentification ----------
  function phoneField() { return `<div class="field"><label for="phone">${e(t('auth.phone'))}</label><div class="phone-input"><span>+253</span><input class="input" id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="77 12 34 56" pattern="[0-9 ]{8,11}" required></div><span class="hint">${e(t('auth.phone_help'))}</span></div>`; }
  const nextUrl = () => new URLSearchParams(location.search).get('next') || '/';
  views.login = async (v) => {
    document.title = `${t('nav.login')} — ${setting('site_name')}`;
    v.innerHTML = `<div class="container"><div class="auth-wrap"><div class="card">
      <h1 class="display" style="font-size:1.7rem">${e(t('auth.login_title'))}</h1>
      <form id="login-form" novalidate>
        <div id="err"></div>
        <div class="field"><label for="idf">${e(t('auth.identifier'))}</label><input class="input" id="idf" name="identifier" autocomplete="username" required dir="ltr"></div>
        <div class="field"><label for="pw">${e(t('auth.password'))}</label><input class="input" id="pw" name="password" type="password" autocomplete="current-password" required></div>
        <div class="field" id="code-field" hidden><label for="code">${e(t('auth.code_2fa'))}</label><input class="input" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr"></div>
        <button class="btn btn-primary btn-lg btn-block">${e(t('auth.submit_login'))}</button>
      </form>
      <p class="muted" style="text-align:center;margin:18px 0 0">${e(t('auth.no_account'))} <a class="see-all" href="/inscription${location.search}">${e(t('nav.register'))}</a></p>
    </div></div></div>`;
    let need2fa = false;
    $('#login-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target, btn = f.querySelector('button');
      btn.disabled = true; $('#err').innerHTML = '';
      try {
        let r;
        if (need2fa) r = await api('/auth/2fa', { method: 'POST', body: { code: f.code.value } });
        else r = await api('/auth/login', { method: 'POST', body: { identifier: f.identifier.value, password: f.password.value } });
        if (r.need2fa) { need2fa = true; $('#code-field').hidden = false; $('#code').focus(); return; }
        await loadBoot(); renderShell(); go(nextUrl());
      } catch (err) { $('#err').innerHTML = `<div class="alert alert-error" style="margin-bottom:14px">${icon('alert', 'sm')} ${e(err.message)}</div>`; }
      finally { btn.disabled = false; }
    };
  };
  views.register = async (v) => {
    document.title = `${t('nav.register')} — ${setting('site_name')}`;
    v.innerHTML = `<div class="container"><div class="auth-wrap"><div class="card">
      <h1 class="display" style="font-size:1.7rem">${e(t('auth.register_title'))}</h1>
      <form id="reg-form">
        <div id="err"></div>
        <div class="field"><label for="name">${e(t('auth.name'))}</label><input class="input" id="name" name="name" autocomplete="name" required minlength="2"></div>
        ${phoneField()}
        <div class="field"><label for="email">${e(t('auth.email'))}</label><input class="input" id="email" name="email" type="email" autocomplete="email" dir="ltr"></div>
        <div class="field"><label for="city">${e(t('auth.city'))}</label><select class="select" id="city" name="city">${S.boot.zones.filter(z => !z.is_pickup).map(z => `<option>${e(z.name_fr)}</option>`).join('')}</select></div>
        <div class="field"><label for="pw">${e(t('auth.password'))}</label><input class="input" id="pw" name="password" type="password" autocomplete="new-password" minlength="8" required><span class="hint">${e(t('auth.password_help'))}</span></div>
        <div class="field"><label class="check"><input type="checkbox" name="seller" value="1"> ${e(t('auth.want_sell'))}</label><label class="check"><input type="checkbox" name="terms" required> <span>${e(t('auth.accept_terms'))} — <a class="see-all" href="/page/terms" target="_blank">${e(t('footer.terms'))}</a></span></label></div>
        <button class="btn btn-primary btn-lg btn-block">${e(t('auth.submit_register'))}</button>
      </form>
      <p class="muted" style="text-align:center;margin:18px 0 0">${e(t('auth.have_account'))} <a class="see-all" href="/connexion${location.search}">${e(t('nav.login'))}</a></p>
    </div></div></div>`;
    const ph = $('#phone');
    ph.oninput = () => { const dgt = ph.value.replace(/\D/g, '').slice(0, 8); ph.value = dgt.replace(/(\d{2})(?=\d)/g, '$1 '); ph.setCustomValidity(/^(77|21|27)\d{6}$/.test(dgt) || !dgt ? '' : t('auth.phone_help')); };
    $('#reg-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target, btn = f.querySelector('button[class*="btn-primary"]');
      if (!f.reportValidity()) return;
      btn.disabled = true; $('#err').innerHTML = '';
      try {
        await api('/auth/register', { method: 'POST', body: { name: f.name.value, phone: '+253' + f.phone.value.replace(/\D/g, ''), email: f.email.value, city: f.city.value, password: f.password.value, seller: f.seller.checked } });
        await loadBoot(); renderShell(); go(nextUrl());
      } catch (err) { $('#err').innerHTML = `<div class="alert alert-error" style="margin-bottom:14px">${icon('alert', 'sm')} ${e(err.message)}</div>`; }
      finally { btn.disabled = false; }
    };
  };

  // ---------- Espace client ----------
  views.account = async (v, { tab = 'encheres' }) => {
    if (!requireLogin()) return;
    const d = await api('/me/dashboard');
    const tabs = [['encheres', 'account.my_bids'], ['suivis', 'account.watchlist'], ['factures', 'account.invoices'], ['notifications', 'account.notifications'], ['lots', 'account.my_lots'], ['profil', 'account.profile']];
    document.title = `${t('account.title')} — ${setting('site_name')}`;
    const invStatus = (i) => `<span class="badge ${i.status === 'paid' ? 'badge-ok' : i.status === 'pending' ? 'badge-brand' : i.status === 'cancelled' ? 'badge-muted' : 'badge-accent'}">${e(t('inv.' + i.status))}</span>`;
    let body = '';
    if (tab === 'encheres') body = d.bids.length ? `<div class="list">${d.bids.map(l => `<a class="list-item" href="/lot/${l.id}"><img src="${e(l.images[0])}" alt="" loading="lazy"><div class="grow"><div class="t">${e(tr(l, 'title'))}</div><div class="small muted">${e(t('lot.your_bid'))} : ${money(l.my_best)} · ${countdown(l)}</div></div>
        <div style="text-align:end"><div class="price">${money(l.status === 'sold' ? l.final_price : l.current_price)}</div>${l.status === 'live' ? `<span class="badge ${l.is_leader ? 'badge-ok' : 'badge-accent'}">${e(t(l.is_leader ? 'account.leading' : 'account.outbid'))}</span>` : l.is_winner ? `<span class="badge badge-ok">${e(t('account.won'))}</span>` : `<span class="badge badge-muted">${e(t('status.' + l.status))}</span>`}</div></a>`).join('')}</div>` : empty();
    if (tab === 'suivis') body = d.watchlist.length ? `<div class="lot-grid">${d.watchlist.map(lotCard).join('')}</div>` : empty(t('misc.empty'), 'heart');
    if (tab === 'factures') body = d.invoices.length ? `<div class="list">${d.invoices.map(i => `<a class="list-item" href="/facture/${i.id}"><img src="${e(i.image)}" alt="" loading="lazy"><div class="grow"><div class="t">${e(tr(i, 'title'))}</div><div class="small muted">${e(t('inv.number'))} ${e(i.number)} · ${e(fmtDate(i.created_at))} · ${e(t('inv.delivery_' + i.delivery_status))}</div></div><div style="text-align:end"><div class="price">${money(i.total)}</div>${invStatus(i)}</div></a>`).join('')}</div>` : empty(t('misc.empty'), 'file');
    if (tab === 'notifications') body = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap"><button class="btn btn-outline btn-sm" id="push-btn">${icon('bell', 'sm')} ${e(t('account.enable_push'))}</button></div>` + (d.notifications.length ? `<div class="list">${d.notifications.map(n => `<a class="notif ${n.read ? '' : 'unread'}" href="${e(n.link || '#')}">${icon({ won: 'gavel', outbid: 'alert', paid: 'check', ending: 'clock' }[n.type] || 'bell')}<div><div>${e(n.message)}</div><div class="small muted">${e(ago(n.created_at))}</div></div></a>`).join('')}</div>` : empty(t('misc.empty'), 'bell'));
    if (tab === 'lots') body = `<a class="btn btn-accent" href="/vendre" style="margin-bottom:14px">${icon('plus', 'sm')} ${e(t('sell.title'))}</a>` + (d.my_lots.length ? `<div class="list">${d.my_lots.map(l => `<a class="list-item" href="/lot/${l.id}"><img src="${e(l.images[0])}" alt="" loading="lazy"><div class="grow"><div class="t">${e(tr(l, 'title'))}</div><div class="small muted">${l.bids_count} ${e(t('lot.bids'))}</div></div><div style="text-align:end"><div class="price">${money(l.current_price)}</div><span class="badge badge-muted">${e(t('status.' + l.status))}</span></div></a>`).join('')}</div>` : empty());
    if (tab === 'profil') body = `<div style="display:grid;gap:18px;max-width:560px">
        <div class="alert ${S.me.verified ? 'alert-ok' : 'alert-info'}">${icon(S.me.verified ? 'shield' : 'info', 'sm')} ${e(S.me.verified ? t('account.verified') : t('account.verify_help'))}</div>
        <form class="card" id="prof-form"><div id="perr"></div>
          <div class="field"><label>${e(t('auth.name'))}</label><input class="input" name="name" value="${e(S.me.name)}"></div>
          <div class="field"><label>${e(t('auth.phone'))}</label><input class="input" value="${e(S.me.phone)}" disabled dir="ltr"></div>
          <div class="field"><label>${e(t('auth.email'))}</label><input class="input" name="email" type="email" value="${e(S.me.email || '')}" dir="ltr"></div>
          <div class="field"><label>${e(t('auth.city'))}</label><input class="input" name="city" value="${e(S.me.city || '')}"></div>
          <div class="field"><label>${e(t('auth.password'))} (${e(t('auth.password_help'))})</label><input class="input" name="password" type="password" autocomplete="new-password"><input class="input" name="current_password" type="password" autocomplete="current-password" placeholder="••• actuel / الحالية" style="margin-top:6px"></div>
          <button class="btn btn-primary">${e(t('misc.save'))}</button></form>
        <form class="card" id="rev-form"><h3>${e(t('account.review_t'))}</h3><div class="rating-input" id="rating">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-r="${i}" aria-label="${i}/5" class="${i <= 5 ? 'on' : ''}">${icon('star')}</button>`).join('')}</div>
          <div class="field" style="margin-top:10px"><label for="rc">${e(t('misc.comment'))}</label><textarea class="textarea" id="rc" name="comment" maxlength="1000"></textarea></div><button class="btn btn-outline">${e(t('misc.send'))}</button></form>
        <button class="btn btn-outline" data-logout2>${icon('logout', 'sm')} ${e(t('nav.logout'))}</button></div>`;
    v.innerHTML = `<div class="container" style="padding-top:22px"><div style="display:flex;align-items:center;gap:14px;margin-bottom:12px"><span class="avatar">${e(S.me.name[0])}</span><div><h1 class="display" style="font-size:1.5rem;margin:0">${e(S.me.name)}</h1><div class="small muted" dir="ltr" style="text-align:start">${e(S.me.phone)}</div></div></div>
      <nav class="tabs">${tabs.map(([k, l]) => `<a href="/compte/${k}" class="${k === tab ? 'on' : ''}">${e(t(l))}</a>`).join('')}</nav>${body}</div>`;
    if (tab === 'notifications' && d.notifications.some(n => !n.read)) api('/me/notifications/read', { method: 'POST' }).then(() => { S.boot.unread = 0; $('.dot-badge')?.remove(); }).catch(() => {});
    $('#push-btn')?.addEventListener('click', async () => { if (!('Notification' in window)) return; const p = await Notification.requestPermission(); toast(e(p === 'granted' ? '✓' : p), { type: p === 'granted' ? 'ok' : 'err' }); });
    $('[data-logout2]')?.addEventListener('click', logout);
    $('#prof-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try { const r = await api('/me/profile', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); S.me = r.me; toast('✓ ' + e(t('misc.save')), { type: 'ok' }); }
      catch (err) { $('#perr').innerHTML = `<div class="alert alert-error" style="margin-bottom:12px">${e(err.message)}</div>`; }
    });
    let rating = 5;
    $$('[data-r]').forEach(b => b.onclick = () => { rating = Number(b.dataset.r); $$('[data-r]').forEach(x => x.classList.toggle('on', Number(x.dataset.r) <= rating)); });
    $('#rev-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { await api('/reviews', { method: 'POST', body: { rating, comment: ev.target.comment.value } }); ev.target.reset(); toast(e(t('account.review_ok')), { type: 'ok' }); }
      catch (err) { toast(e(err.message), { type: 'err' }); }
    });
  };

  // Facture : zone de livraison + paiement local + impression (bordereau / PDF)
  views.invoice = async (v, { id }) => {
    if (!requireLogin()) return;
    const d = await api(`/invoices/${id}?lang=${S.lang}`);
    const i = d.invoice, payable = ['unpaid', 'pending'].includes(i.status);
    document.title = `${t('inv.number')} ${i.number} — ${setting('site_name')}`;
    v.innerHTML = `<div class="container" style="max-width:860px;padding-top:22px">
      <div class="breadcrumb no-print"><a href="/compte/factures">${e(t('account.invoices'))}</a>${icon('right', 'sm flip')}<span>${e(i.number)}</span></div>
      <div class="print-only"><h2>${e(setting('site_name'))}</h2><p>${e(setting('address'))} · ${e(setting('support_phone'))}</p><h3>${e(t('inv.slip'))}</h3><p>${e(d.buyer.name)} — ${e(d.buyer.phone)}</p></div>
      <div class="card" style="display:grid;gap:18px">
        <div style="display:flex;gap:14px;align-items:center"><img src="${e(i.image)}" alt="" style="width:84px;height:84px;border-radius:12px;object-fit:cover"><div style="flex:1"><div class="kicker">${e(t('inv.number'))} ${e(i.number)} · ${e(t('lot.lot_no'))} ${i.lot_number || i.lot_id}</div><h1 style="font-size:1.25rem;margin:0">${e(tr(i, 'title'))}</h1><span class="badge ${i.status === 'paid' ? 'badge-ok' : 'badge-accent'}">${e(t('inv.' + i.status))}</span> <span class="small muted">${e(t('inv.delivery_' + i.delivery_status))}${i.tracking ? ' · ' + e(i.tracking) : ''}</span></div>
          <button class="btn btn-outline btn-sm no-print" onclick="print()">${icon('download', 'sm')} ${e(t('inv.print'))}</button></div>
        ${payable ? `<form id="pay-form" class="no-print" style="display:grid;gap:16px">
          <div id="perr"></div>
          <div class="field"><label for="zone">${e(t('pay.zone'))}</label><select class="select" id="zone" name="zone_id">${S.boot.zones.map(z => `<option value="${z.id}" data-fee="${z.fee}" data-pickup="${z.is_pickup}" ${i.zone_id === z.id ? 'selected' : ''}>${e(tr(z, 'name'))} — ${z.fee ? money(z.fee) : e(t('pay.free'))}</option>`).join('')}</select></div>
          <div class="field" id="addr-f"><label for="addr">${e(t('pay.address'))}</label><textarea class="textarea" id="addr" name="address" style="min-height:70px">${e(i.address || '')}</textarea></div>
          <div><div class="field"><label>${e(t('pay.method'))}</label></div><div class="pay-methods">${d.methods.map((m, k) => `<label class="pay-method"><input type="radio" name="method" value="${m.code}" data-ref="${m.requires_reference ? 1 : 0}" ${(i.payment_method ? i.payment_method === m.code : k === 0) ? 'checked' : ''}><div><b>${e(m.name)}</b><div class="small muted">${e(m.instructions)}</div></div></label>`).join('')}</div></div>
          <div class="field" id="ref-f"><label for="ref">${e(t('pay.reference'))}</label><input class="input" id="ref" name="reference" value="${e(i.payment_ref && i.payment_ref !== 'COD' ? i.payment_ref : '')}" dir="ltr"><span class="hint">${e(t('pay.reference_help'))}</span></div>
        </form>` : ''}
        <div class="totals"><div><span>${e(t('pay.subtotal'))}</span><span>${money(i.amount)}</span></div><div><span>${e(t('pay.buyer_fee'))}</span><span>${money(i.buyer_fee)}</span></div><div><span>${e(t('pay.delivery_fee'))}</span><span id="dfee">${money(i.delivery_fee)}</span></div><div class="grand"><span>${e(t('pay.total'))}</span><span id="gtotal">${money(i.total)}</span></div></div>
        ${payable ? `<button class="btn btn-accent btn-lg no-print" form="pay-form">${icon('wallet', 'sm')} ${e(t('pay.confirm'))}</button>` : ''}
        ${i.status === 'pending' ? `<div class="alert alert-info">${icon('clock', 'sm')} ${e(t('pay.done'))}</div>` : ''}
      </div></div>`;
    if (!payable) return;
    const f = $('#pay-form');
    const sync = () => {
      const o = f.zone_id.selectedOptions[0];
      const fee = Number(o.dataset.fee);
      $('#addr-f').hidden = o.dataset.pickup === '1';
      $('#dfee').textContent = money(fee); $('#gtotal').textContent = money(i.amount + i.buyer_fee + fee);
      const m = f.querySelector('input[name=method]:checked');
      $('#ref-f').hidden = !m || m.dataset.ref !== '1';
    };
    f.onchange = sync; sync();
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api(`/invoices/${i.id}/pay`, { method: 'POST', body: Object.fromEntries(new FormData(f)) }); toast(e(t('pay.done')), { type: 'ok' }); route(); }
      catch (err) { $('#perr').innerHTML = `<div class="alert alert-error">${e(err.message)}</div>`; }
    };
  };

  // Dépôt d'un lot par un vendeur (photos compressées dans le navigateur)
  async function compress(file, max = 1600, q = 0.8) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return file;
    const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', q));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file;
  }
  views.sell = async (v) => {
    document.title = `${t('sell.title')} — ${setting('site_name')}`;
    if (!S.me) { v.innerHTML = `<div class="container"><div class="auth-wrap"><div class="card" style="text-align:center"><h1 class="display">${e(t('sell.title'))}</h1><p class="muted">${e(t('sell.intro'))}</p><p>${e(t('sell.need_seller'))}</p><a class="btn btn-primary" href="/connexion?next=/vendre">${e(t('nav.login'))}</a></div></div></div>`; return; }
    const cats = S.boot.categories;
    v.innerHTML = `<div class="container" style="max-width:760px;padding-top:22px"><h1 class="display">${e(t('sell.title'))}</h1><p class="muted">${e(t('sell.intro'))}</p>
      <form class="card" id="sell-form"><div id="serr"></div>
        <div class="field"><label for="st">${e(t('sell.title_label'))}</label><input class="input" id="st" name="title" required minlength="5" maxlength="140"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div class="field"><label for="sc">${e(t('sell.category'))}</label><select class="select" id="sc" name="category_id" required>${cats.map(c => `<option value="${c.id}">${e(tr(c, 'name'))}</option>`).join('')}</select></div>
          <div class="field"><label for="ss">${e(t('filters.subcategory'))}</label><select class="select" id="ss" name="subcategory_id"></select></div></div>
        <div id="attrs"></div>
        <div class="field" id="exp-f" hidden><label for="se">${e(t('lot.expiry'))}</label><input class="input" id="se" name="expiry_date" type="date"></div>
        <div class="field"><label for="sd">${e(t('sell.desc_label'))}</label><textarea class="textarea" id="sd" name="description"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div class="field"><label>${e(t('lot.condition'))}</label><select class="select" name="condition">${['new', 'like_new', 'good', 'fair', 'for_parts'].map(k => `<option value="${k}">${e(t('cond.' + k))}</option>`).join('')}</select></div>
          <div class="field"><label>${e(t('lot.location'))}</label><select class="select" name="location">${S.boot.zones.filter(z => !z.is_pickup).map(z => `<option>${e(z.name_fr)}</option>`).join('')}</select></div></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">
          <div class="field"><label>${e(t('sell.start_price'))}</label><input class="input" name="start_price" type="number" inputmode="numeric" min="1" required></div>
          <div class="field"><label>${e(t('sell.reserve'))}</label><input class="input" name="reserve_price" type="number" inputmode="numeric" min="0"></div>
          <div class="field"><label>${e(t('sell.buy_now'))}</label><input class="input" name="buy_now_price" type="number" inputmode="numeric" min="0"></div>
          <div class="field"><label>${e(t('sell.duration'))}</label><input class="input" name="duration" type="number" min="1" max="30" value="7"></div></div>
        <div class="field"><label>${e(t('sell.photos'))}</label><label class="photo-drop">${icon('upload', 'lg')}<span>${e(t('sell.photos'))}</span><input type="file" id="photos" accept="image/*" multiple hidden></label><div class="photo-previews" id="prev"></div></div>
        <button class="btn btn-accent btn-lg btn-block">${e(t('sell.submit'))}</button>
      </form></div>`;
    const f = $('#sell-form');
    let files = [];
    const syncCat = () => {
      const c = cats.find(x => String(x.id) === f.category_id.value);
      f.subcategory_id.innerHTML = c.subs.map(s => `<option value="${s.id}">${e(tr(s, 'name'))}</option>`).join('');
      $('#exp-f').hidden = !c.requires_expiry; f.expiry_date.required = c.requires_expiry;
      $('#attrs').innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">${c.filters.map(fl => `<div class="field"><label>${e(S.lang === 'ar' ? fl.label_ar : fl.label_fr)}</label>${fl.type === 'select' ? `<select class="select" data-attr="${fl.key}"><option value=""></option>${fl.options.map(o => `<option>${e(o)}</option>`).join('')}</select>` : `<input class="input" type="number" data-attr="${fl.key}" data-num="1">`}</div>`).join('')}</div>`;
    };
    f.category_id.onchange = syncCat; syncCat();
    $('#photos').onchange = async (ev) => {
      for (const file of Array.from(ev.target.files).slice(0, 8 - files.length)) files.push(await compress(file));
      $('#prev').innerHTML = files.map(fl => `<img src="${URL.createObjectURL(fl)}" alt="">`).join('');
    };
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = f.querySelector('.btn-accent'); btn.disabled = true;
      const fd = new FormData(f);
      const attrs = {}; $$('[data-attr]', f).forEach(x => { if (x.value) attrs[x.dataset.attr] = x.dataset.num ? Number(x.value) : x.value; });
      fd.set('attrs', JSON.stringify(attrs));
      files.forEach(fl => fd.append('photos', fl));
      try { await api('/sell', { method: 'POST', form: fd }); toast(e(t('sell.success')), { type: 'ok', ms: 7000 }); go('/compte/lots'); }
      catch (err) { $('#serr').innerHTML = `<div class="alert alert-error" style="margin-bottom:12px">${e(err.message)}</div>`; scrollTo(0, 0); }
      finally { btn.disabled = false; }
    };
  };

  views.page = async (v, { key }) => {
    if (!S.boot.texts.fr[`page.${key}.body`]) return views.notfound(v);
    document.title = `${t(`page.${key}.title`)} — ${setting('site_name')}`;
    v.innerHTML = `<div class="container" style="max-width:800px;padding:28px 16px"><h1 class="display">${e(t(`page.${key}.title`))}</h1><div class="rich">${t(`page.${key}.body`)}</div></div>`;
  };
  views.notfound = async (v) => { v.innerHTML = `<div class="container">${empty(t('misc.not_found'), 'search')}<p style="text-align:center"><a class="btn btn-primary" href="/">${e(t('misc.back_home'))}</a></p></div>`; };

  // ---------- Mouvement ----------
  const MOTION = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const REVEAL_GROUPS = '.cat-grid, .row-scroll, .lot-grid, .steps, .reviews, .next-strip, .list, .trust, .chips';
  const REVEAL_ITEMS = '.section-head, .rule-title, .live-panel, .promo, .partners, .review-summary, .cat-hero, .panel, .bid-box, .gallery-main, .card, .empty';
  let revealIO = null;
  // Apparition au défilement : une seule fois, par groupe (les enfants arrivent en cascade, 8 max)
  function reveal(root) {
    if (!MOTION || !('IntersectionObserver' in window)) return;
    revealIO = revealIO || new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); revealIO.unobserve(en.target); }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    for (const g of $$(REVEAL_GROUPS, root)) {
      if (g.classList.contains('rv-group')) continue;
      Array.from(g.children).forEach((c, i) => c.style.setProperty('--i', Math.min(i, 8)));
      g.classList.add('rv-group'); revealIO.observe(g);
    }
    for (const el of $$(REVEAL_ITEMS, root)) {
      if (el.classList.contains('rv') || el.closest('.rv-group')) continue;
      el.classList.add('rv'); revealIO.observe(el);
    }
    // Le défilement continu des partenaires ne tourne que lorsqu'il est visible
    const marquee = $('.partners', root);
    if (marquee) new IntersectionObserver(([en]) => marquee.classList.toggle('playing', en.isIntersecting)).observe(marquee);
  }
  // Retour visuel quand une valeur affichée change (prix, enchères)
  function bump(el, text) {
    if (!el || el.textContent === String(text)) return;
    el.textContent = text;
    if (!MOTION) return;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  // ---------- Routeur ----------
  const ROUTES = [
    [/^\/$/, 'home'], [/^\/c\/([\w-]+)(?:\/([\w-]+))?$/, 'catalog', ['cat', 'sub']], [/^\/recherche$/, 'catalog'], [/^\/lot\/(\d+)$/, 'lot', ['id']],
    [/^\/live$/, 'live'], [/^\/ventes$/, 'sales'], [/^\/vente\/(\d+)$/, 'sale', ['id']], [/^\/connexion$/, 'login'], [/^\/inscription$/, 'register'],
    [/^\/compte(?:\/(\w+))?$/, 'account', ['tab']], [/^\/facture\/(\d+)$/, 'invoice', ['id']], [/^\/vendre$/, 'sell'], [/^\/page\/(\w+)$/, 'page', ['key']],
  ];
  function go(url, replace) {
    if (url === location.pathname + location.search) return route();
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
    route();
  }
  let routeSeq = 0;
  async function route() {
    const seq = ++routeSeq;
    closeMenus();
    if (S.view?.type === 'live') S.socket?.emit('live:leave');
    S.view = null;
    document.body.classList.remove('has-bidbar', 'live-mode');
    const v = $('#view');
    const p = location.pathname.replace(/\/+$/, '') || '/';
    let name = 'notfound', params = {};
    for (const [re, n, keys] of ROUTES) {
      const m = re.exec(p);
      if (m) { name = n; (keys || []).forEach((k, i) => { if (m[i + 1]) params[k] = m[i + 1]; }); break; }
    }
    v.innerHTML = name === 'lot' || name === 'catalog' || name === 'home' ? loading() : `<div class="page-loading">${e(t('misc.loading'))}</div>`;
    markTab();
    try {
      if (name === 'home') document.title = `${setting('site_name')} — ${tr({ slogan_fr: setting('slogan_fr'), slogan_ar: setting('slogan_ar') }, 'slogan')}`;
      await views[name](v, params);
      if (seq === routeSeq) {
        v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
        reveal(v);
      }
    } catch (err) {
      if (seq !== routeSeq) return;
      if (err.status === 404) return views.notfound(v);
      v.innerHTML = `<div class="container">${empty(err.message || t('misc.error'), 'alert')}<p style="text-align:center"><button class="btn btn-outline" onclick="location.reload()">↻</button></p></div>`;
    }
    if (seq === routeSeq && !location.hash) { scrollTo({ top: 0, behavior: 'instant' }); }
  }

  document.addEventListener('click', (ev) => {
    const w = ev.target.closest('[data-watch]');
    if (w) { ev.preventDefault(); toggleWatch(Number(w.dataset.watch)); return; }
    const a = ev.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('data-external') || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button) return;
    const href = a.getAttribute('href');
    if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/admin') || href.startsWith('/uploads')) return;
    ev.preventDefault();
    go(href);
  });
  addEventListener('popstate', route);

  // ---------- Temps réel ----------
  function connectSocket() {
    if (!window.io) return;
    const s = S.socket = window.io({ transports: ['websocket', 'polling'] });
    s.on('connect', () => {
      const t0 = Date.now();
      s.emit('time', (srv) => { S.offset = srv - (t0 + Date.now()) / 2; });
      if (S.view?.type === 'lot') s.emit('lot:join', S.view.id);
      if (S.view?.type === 'live') { s.emit('live:join'); s.emit('lot:join', S.view.lot.id); }
      if (S.view?.type === 'home' && S.view.lot) s.emit('lot:join', S.view.lot.id);
    });
    s.on('lot:update', (l) => {
      updateCards(l);
      const v = S.view;
      if (v?.type === 'lot' && v.id === l.id) {
        Object.assign(v.data.lot, l, { is_leader: !!S.me && l.leader_code === v.data.lot.my_code });
        if (l.extended) toast(e(t('lot.extended')), { type: 'info', iconName: 'clock' });
        if (l.history_changed) return route();
        renderBidBox();
      }
      if ((v?.type === 'live' || v?.type === 'home') && v.lot?.id === l.id) {
        const panel = $(`[data-live-panel="${l.id}"]`);
        if (panel?._update) panel._update(l);
        if (l.extended) toast(e(t('lot.extended')), { type: 'info', iconName: 'clock' });
        if (['sold', 'unsold'].includes(l.status) && v.type === 'live') {
          toast(`<b>${e(t('status.' + l.status))}</b> — ${e(tr(l, 'title'))}${l.status === 'sold' ? ' · ' + money(l.final_price) : ''}`, { type: 'won' });
          $('[data-live-panel] .live-visual')?.classList.add('gavel-anim');
          setTimeout(() => S.view?.type === 'live' && route(), 2500);
        }
      }
    });
    s.on('lot:bid', (b) => {
      const v = S.view;
      if (v?.type === 'lot' && v.id === b.lot_id) {
        v.data.history.unshift({ bidder: b.bidder, amount: b.amount, is_auto: b.is_auto, at: b.at });
        const h = $('#history');
        if (h) { $$('li', h).forEach(li => li.classList.remove('top')); if (v.data.history.length === 1) h.innerHTML = ''; h.insertAdjacentHTML('afterbegin', historyRow(b, v.data.lot, true, true)); $('#h-count').textContent = v.data.history.length; }
      }
      if (v?.type === 'live' && v.lot.id === b.lot_id) {
        const f = $('#live-feed'); if (f) { if (f.querySelector('.muted')) f.innerHTML = ''; f.insertAdjacentHTML('afterbegin', feedRow(b, v.lot, true)); }
      }
    });
    s.on('live:viewers', (n) => { const el = $('#viewers'); if (el) el.textContent = n; });
    s.on('lot:sold', (x) => floating.push({ type: 'won', name: x.name, title_fr: x.title_fr, title_ar: x.title_ar, at: x.at }, true));
    s.on('notify', (n) => {
      S.boot.unread = (S.boot.unread || 0) + 1;
      toast(`${e(n.message)}${n.link ? `<small><a href="${e(n.link)}" class="see-all">→</a></small>` : ''}`, { type: n.type === 'won' ? 'won' : n.type === 'outbid' ? 'err' : 'info', ms: 7000 });
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') navigator.serviceWorker?.ready.then(r => r.showNotification(setting('site_name'), { body: n.message, icon: '/img/icon.svg', data: { url: n.link } })).catch(() => {});
    });
    s.on('settings:update', async () => { await loadBoot(); applyIdentity(); renderShell(true); });
  }

  // ---------- Avis flottants (paramétrables depuis l'admin) ----------
  const floating = {
    items: [], i: 0, timer: null,
    async start() {
      if (setting('toasts_enabled') !== '1') return;
      try { this.items = (await api('/toasts')).items; } catch { return; }
      this.items.sort(() => Math.random() - 0.5);
      const interval = Math.max(4, Number(setting('toast_interval')) || 14) * 1000;
      setTimeout(() => this.next(), 5000);
      this.timer = setInterval(() => this.next(), interval);
    },
    push(item, now2) { this.items.splice(this.i, 0, item); if (now2) this.next(); },
    next() {
      if (!this.items.length || document.hidden || S.view?.type === 'live') return;
      const it = this.items[this.i++ % this.items.length];
      const ms = Math.max(2, Number(setting('toast_duration')) || 6) * 1000;
      let html;
      if (it.type === 'won') html = e(t('toast.won', { name: it.name, lot: tr(it, 'title'), time: ago(it.at) }));
      else if (it.type === 'review') html = e(t('toast.review', { name: it.name, stars: '★'.repeat(it.rating) }));
      else html = e(tr(it, 'text'));
      toast(html, { type: it.type === 'custom' ? 'info' : it.type, ms, iconName: it.type === 'custom' ? 'zap' : undefined });
    },
  };

  // ---------- PWA, hors ligne ----------
  function updateOffline() { const b = $('#offline'); if (b) b.hidden = navigator.onLine; }
  addEventListener('online', updateOffline); addEventListener('offline', updateOffline);

  async function loadBoot() {
    try {
      S.boot = await api('/bootstrap');
      store.set('boot', JSON.stringify(S.boot));
    } catch (err) {
      const cached = store.get('boot');
      if (!cached) throw err;
      S.boot = JSON.parse(cached);
    }
    S.me = S.boot.me;
    S.watched = new Set(S.boot.watched || []);
    S.offset = S.boot.now - Date.now();
  }

  async function init() {
    try { await loadBoot(); }
    catch { $('#app').innerHTML = '<div class="page-loading">Connexion impossible / تعذر الاتصال — <button class="btn btn-outline" onclick="location.reload()">↻</button></div>'; return; }
    if (MOTION) document.documentElement.classList.add('motion');
    setLang(store.get('lang') || setting('default_lang') || 'fr');
    const curs = setting('currencies_enabled').split(',');
    S.cur = curs.includes(store.get('cur')) ? store.get('cur') : setting('currency') || 'DJF';
    applyIdentity();
    renderShell();
    await route();
    setInterval(tickCountdowns, 1000);
    connectSocket();
    floating.start();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  init();
})();
