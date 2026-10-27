/* Back-office : contrôle total du site sans toucher au code. Chaque écran est relié à /api/admin. */
(() => {
  'use strict';

  const A = { me: null, perms: [], cats: [], sales: [], route: 'dashboard', socket: null };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const e = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n, c = '') => `<svg class="ico ${c}" viewBox="0 0 24 24" aria-hidden="true">${(window.ICONS || {})[n] || ''}</svg>`;
  const money = (n) => n == null ? '—' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' FDJ';
  const dt = (t) => t ? new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const toLocal = (t) => { if (!t) return ''; const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const fromLocal = (s) => s ? new Date(s).getTime() : '';
  const can = (p) => A.perms.includes('*') || A.perms.includes(p);
  const STATUS_FR = { upcoming: 'À venir', live: 'En cours', sold: 'Vendu', unsold: 'Invendu', withdrawn: 'Retiré', suspended: 'Suspendu', pending: 'En validation', rejected: 'Refusé', unpaid: 'À payer', paid: 'Payée', cancelled: 'Annulée', approved: 'Approuvé', hidden: 'Masqué', closed: 'Terminée', waiting: 'En attente', preparing: 'En préparation', shipped: 'Expédié', delivered: 'Livré', pickup: 'Retiré sur place' };
  const st = (s) => `<span class="st ${e(s)}">${e(STATUS_FR[s] || s)}</span>`;

  async function api(path, { method = 'GET', body, form } = {}) {
    const csrf = decodeURIComponent((document.cookie.split('; ').find(c => c.startsWith('csrf=')) || '').split('=')[1] || '');
    const opts = { method, headers: { 'x-csrf-token': csrf }, credentials: 'same-origin' };
    if (form) opts.body = form; else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path.startsWith('/api') ? path : '/api/admin' + path, opts);
    let data = {}; try { data = await res.json(); } catch { /* vide */ }
    if (!res.ok) { const err = new Error(data.error || 'Erreur'); err.status = res.status; err.data = data; throw err; }
    return data;
  }
  function toast(msg, type = 'ok') {
    let z = $('#toast-zone'); if (!z) { z = document.createElement('div'); z.id = 'toast-zone'; z.className = 'toast-zone right'; document.body.appendChild(z); }
    const el = document.createElement('div'); el.className = 'toast';
    el.innerHTML = `<span class="ti ${type}">${icon(type === 'err' ? 'alert' : 'check')}</span><div>${e(msg)}</div>`;
    z.appendChild(el); setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3500);
  }
  const run = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (err) { toast(err.message, 'err'); throw err; } };
  function modal(html, onMount) {
    const bd = document.createElement('div'); bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => bd.remove();
    bd.addEventListener('click', ev => { if (ev.target === bd || ev.target.closest('[data-close]')) close(); });
    document.body.appendChild(bd);
    onMount && onMount(bd.querySelector('.modal'), close);
    return close;
  }
  const ask = (msg) => new Promise(res => modal(`<h3>${e(msg)}</h3><div class="modal-actions"><button class="btn btn-outline" data-close>Annuler</button><button class="btn btn-accent" data-ok>Confirmer</button></div>`, (m, close) => { m.querySelector('[data-ok]').onclick = () => { close(); res(true); }; m.querySelector('[data-close]').addEventListener('click', () => res(false)); }));
  const prompt2 = (title, fields) => new Promise(res => modal(`<h3>${e(title)}</h3><form>${fields.map(f => field(f)).join('')}<div class="modal-actions"><button type="button" class="btn btn-outline" data-close>Annuler</button><button class="btn btn-primary">Valider</button></div></form>`,
    (m, close) => { m.querySelector('[data-close]').addEventListener('click', () => res(null)); m.querySelector('form').onsubmit = (ev) => { ev.preventDefault(); res(readForm(ev.target, fields)); close(); }; }));

  // Compression des images côté navigateur avant upload (réseaux lents)
  async function compress(file, max = 1800) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const bmp = await createImageBitmap(file).catch(() => null); if (!bmp) return file;
    const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise(res => c.toBlob(res, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.82));
    return b && b.size < file.size ? new File([b], file.name, { type: b.type }) : file;
  }

  // ---------- Générateur de formulaires ----------
  // f = { name, label, type, options:[[v,l]], help, full, value }
  function field(f) {
    const v = f.value ?? '';
    const id = 'f_' + f.name;
    const cls = f.full || ['textarea', 'html', 'json', 'images'].includes(f.type) ? 'field full' : 'field';
    let input;
    switch (f.type) {
      case 'textarea': case 'html': case 'json': input = `<textarea class="textarea" id="${id}" name="${f.name}" ${f.dir ? `dir="${f.dir}"` : ''} style="${f.type === 'json' ? 'font-family:monospace;font-size:12px' : ''}">${e(v)}</textarea>`; break;
      case 'select': input = `<select class="select" id="${id}" name="${f.name}">${f.options.map(([ov, ol]) => `<option value="${e(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${e(ol)}</option>`).join('')}</select>`; break;
      case 'checkbox': return `<div class="${cls}"><label class="check"><input type="checkbox" name="${f.name}" ${v && v !== '0' ? 'checked' : ''}> ${e(f.label)}</label>${f.help ? `<span class="hint">${e(f.help)}</span>` : ''}</div>`;
      case 'datetime': input = `<input class="input" type="datetime-local" id="${id}" name="${f.name}" value="${e(toLocal(v))}" ${f.required ? 'required' : ''}>`; break;
      case 'color': input = `<div class="color-row"><input type="color" name="${f.name}" value="${e(v || '#000000')}"><input class="input" value="${e(v)}" data-mirror="${f.name}" pattern="#[0-9a-fA-F]{6}"></div>`; break;
      case 'images': input = `<div class="img-list" data-imgs="${f.name}">${(v || []).map(src => `<div><img src="${e(src)}" alt=""><button type="button" data-rm="${e(src)}" aria-label="Retirer">×</button></div>`).join('')}</div><input type="file" accept="image/*" multiple name="__files" style="margin-top:8px">`; break;
      case 'file': input = `${v ? `<div class="preview-logo"><img src="${e(v)}" alt=""></div>` : ''}<input type="file" accept="image/*" name="__files">`; break;
      default: input = `<input class="input" id="${id}" type="${f.type || 'text'}" name="${f.name}" value="${e(v)}" ${f.required ? 'required' : ''} ${f.dir ? `dir="${f.dir}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''}>`;
    }
    return `<div class="${cls}"><label for="${id}">${e(f.label)}</label>${input}${f.help ? `<span class="hint">${e(f.help)}</span>` : ''}</div>`;
  }
  function readForm(form, fields) {
    const out = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      if (f.type === 'checkbox') out[f.name] = el.checked ? '1' : '0';
      else if (f.type === 'datetime') out[f.name] = fromLocal(el.value);
      else if (f.type === 'images') out[f.name] = $$(`[data-imgs="${f.name}"] img`, form).map(i => i.getAttribute('src'));
      else if (f.type === 'file') continue;
      else if (el) out[f.name] = el.value;
    }
    return out;
  }
  function bindForm(form) {
    $$('[data-rm]', form).forEach(b => b.onclick = () => b.parentElement.remove());
    $$('input[type=color]', form).forEach(c => { const m = form.querySelector(`[data-mirror="${c.name}"]`); c.oninput = () => { m.value = c.value; }; m.oninput = () => { if (/^#[0-9a-f]{6}$/i.test(m.value)) c.value = m.value; }; });
  }
  async function toFormData(form, data) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(data)) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v);
    const fi = form.querySelector('input[name="__files"]');
    if (fi) for (const f of fi.files) fd.append('files', await compress(f));
    return fd;
  }
  // Modale d'édition générique : retourne une promesse résolue après enregistrement
  function editModal(title, fields, onSave) {
    return new Promise(res => modal(`<h3>${e(title)}</h3><form class="form-grid" novalidate>${fields.map(field).join('')}<div class="full" id="ferr"></div><div class="modal-actions full"><button type="button" class="btn btn-outline" data-close>Annuler</button><button class="btn btn-primary">Enregistrer</button></div></form>`, (m, close) => {
      const form = m.querySelector('form'); bindForm(form);
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const btn = form.querySelector('.btn-primary'); btn.disabled = true;
        try { await onSave(readForm(form, fields), form); close(); toast('Enregistré'); res(true); }
        catch (err) { $('#ferr', m).innerHTML = `<div class="alert alert-error">${e(err.message)}</div>`; }
        finally { btn.disabled = false; }
      };
    }));
  }
  const table = (cols, rows, empty = 'Aucun élément') => rows.length
    ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${e(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : e(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : `<div class="box empty">${e(empty)}</div>`;
  const sw = (name, on, extra = '') => `<label class="switch"><input type="checkbox" ${on ? 'checked' : ''} ${extra} data-sw="${name}"><span></span></label>`;

  // ---------- Navigation ----------
  const MENU = [
    ['Pilotage', [['dashboard', 'chart', 'Tableau de bord', 'dashboard'], ['lots', 'gavel', 'Lots', 'lots'], ['moderation', 'check', 'Modération', 'moderation', 'pending_lots'], ['sales', 'calendar', 'Ventes & live', 'sales'], ['bids', 'zap', 'Enchères', 'bids'], ['invoices', 'file', 'Factures & livraisons', 'invoices', 'pending_payments']]],
    ['Membres', [['users', 'users', 'Utilisateurs', 'users'], ['reviews', 'star', 'Avis clients', 'reviews', 'pending_reviews'], ['fraud', 'shield', 'Anti-fraude', 'fraud']]],
    ['Site', [['identity', 'image', 'Identité du site', 'identity'], ['texts', 'edit', 'Textes FR / AR', 'content'], ['banners', 'home', 'Bannières & carrousel', 'content'], ['partners', 'users', 'Partenaires', 'content'], ['toasts', 'bell', 'Avis flottants', 'reviews'], ['categories', 'grid', 'Catégories', 'catalog']]],
    ['Paramètres', [['payments', 'wallet', 'Moyens de paiement', 'payments'], ['zones', 'truck', 'Zones de livraison', 'delivery'], ['settings', 'settings', 'Enchères, frais & devises', 'settings'], ['security', 'lock', 'Sécurité / 2FA', null], ['exports', 'download', 'Exports & rapports', 'exports'], ['logs', 'clock', 'Journal d\'activité', 'logs'], ['outbox', 'chat', 'Notifications envoyées', 'settings']]],
  ];
  let counters = {};
  function shell() {
    $('#admin').innerHTML = `<div class="adm">
      <nav class="adm-side" id="side"><a href="/" class="logo" target="_blank"><span class="logo-mark">${icon('gavel')}</span><span>Back-office</span></a>
        ${MENU.map(([g, items]) => { const vis = items.filter(i => !i[3] || can(i[3])); return vis.length ? `<div class="grp">${e(g)}</div>${vis.map(([k, ic, l, , cnt]) => `<a href="#${k}" data-nav="${k}">${icon(ic, 'sm')} ${e(l)}${cnt && counters[cnt] ? `<span class="cnt">${counters[cnt]}</span>` : ''}</a>`).join('')}` : ''; }).join('')}
      </nav><div class="side-backdrop" id="side-bd"></div>
      <div class="adm-main"><header class="adm-top"><button class="icon-btn menu" id="menu" aria-label="Menu">${icon('menu')}</button><h1 id="title"></h1>
        <a class="btn btn-outline btn-sm" href="/" target="_blank">${icon('eye', 'sm')} Voir le site</a>
        <button class="icon-btn" id="theme" aria-label="Thème">${icon('moon')}</button>
        <span class="small muted" style="display:none" id="whoami"></span><button class="btn btn-ghost btn-sm" id="logout">${icon('logout', 'sm')}</button></header>
        <div class="adm-body" id="body"></div></div></div>`;
    $('#menu').onclick = () => { $('#side').classList.add('open'); $('#side-bd').classList.add('open'); };
    $('#side-bd').onclick = () => { $('#side').classList.remove('open'); $('#side-bd').classList.remove('open'); };
    $('#theme').onclick = () => { const th = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = th; try { localStorage.setItem('theme', th); } catch { /* */ } };
    $('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); };
    markNav();
  }
  function markNav() { $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === A.route)); }
  async function go() {
    A.route = (location.hash.slice(1) || 'dashboard').split(/[?/]/)[0];
    $('#side')?.classList.remove('open'); $('#side-bd')?.classList.remove('open');
    markNav();
    const v = V[A.route] || V.dashboard;
    const item = MENU.flatMap(m => m[1]).find(i => i[0] === A.route);
    $('#title').textContent = item ? item[2] : 'Tableau de bord';
    const body = $('#body'); body.innerHTML = '<div class="page-loading">Chargement…</div>';
    try { await v(body); } catch (err) { body.innerHTML = `<div class="alert alert-error">${e(err.message)}</div>`; }
  }
  addEventListener('hashchange', go);

  const catOptions = (parent = null, withEmpty) => [...(withEmpty ? [['', '—']] : []), ...A.cats.filter(c => (parent === null ? !c.parent_id : c.parent_id === Number(parent))).map(c => [c.id, c.name_fr])];
  async function loadRefs() {
    [A.cats, A.sales] = await Promise.all([api('/categories').then(r => r.categories).catch(() => []), api('/sales').then(r => r.sales).catch(() => [])]);
  }

  const V = {};

  // ---------- Tableau de bord ----------
  V.dashboard = async (b) => {
    const days = Number(new URLSearchParams(location.hash.split('?')[1]).get('days')) || 30;
    const d = await api('/stats?days=' + days);
    const k = d.kpi;
    counters = { pending_lots: k.pending_lots, pending_payments: k.pending_payments, pending_reviews: k.pending_reviews };
    const maxCa = Math.max(1, ...d.series.map(s => s.ca)), maxB = Math.max(1, ...d.series.map(s => s.bids));
    const w = 100 / d.series.length;
    b.innerHTML = `<div class="filters-bar">${[7, 30, 90, 365].map(n => `<a class="chip ${n === days ? 'on' : ''}" href="#dashboard?days=${n}">${n} jours</a>`).join('')}</div>
      <div class="kpis">
        <div class="kpi"><div class="k">Chiffre d'affaires</div><div class="v">${money(k.ca)}</div><div class="s">${k.sold} lots vendus</div></div>
        <div class="kpi"><div class="k">Revenus plateforme</div><div class="v">${money(k.commission + k.buyer_fees)}</div><div class="s">Commission ${money(k.commission)} · frais acheteurs ${money(k.buyer_fees)}</div></div>
        <div class="kpi"><div class="k">Enchères</div><div class="v">${k.bids}</div><div class="s">${k.active_users} enchérisseurs actifs</div></div>
        <div class="kpi"><div class="k">Taux de conversion</div><div class="v">${k.conversion} %</div><div class="s">${k.unsold} lots invendus</div></div>
        <div class="kpi"><div class="k">Lots en cours</div><div class="v">${k.live_lots}</div><div class="s"><a class="see-all" href="#lots?status=live">Gérer</a></div></div>
        <div class="kpi"><div class="k">À modérer</div><div class="v">${k.pending_lots}</div><div class="s"><a class="see-all" href="#moderation">Valider les lots</a> · ${k.pending_reviews} avis</div></div>
        <div class="kpi"><div class="k">Factures ouvertes</div><div class="v">${k.unpaid}</div><div class="s">${k.pending_payments} paiements à vérifier</div></div>
        <div class="kpi"><div class="k">Utilisateurs</div><div class="v">${k.users}</div><div class="s">+${k.new_users} sur la période</div></div>
      </div>
      <div class="grid2">
        <div class="box"><h2>${icon('chart', 'sm')} Ventes (FDJ) et enchères par jour</h2>
          <svg class="chart" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="Graphique des ventes">${d.series.map((s, i) => `<rect x="${i * w + w * .1}" y="${50 - 48 * s.ca / maxCa}" width="${w * .4}" height="${48 * s.ca / maxCa}"><title>${s.day} : ${money(s.ca)}</title></rect><rect class="b2" x="${i * w + w * .5}" y="${50 - 48 * s.bids / maxB}" width="${w * .4}" height="${48 * s.bids / maxB}"><title>${s.day} : ${s.bids} enchères</title></rect>`).join('')}</svg>
          <div class="small muted"><span style="color:var(--brand)">■</span> CA &nbsp; <span style="color:var(--accent)">■</span> enchères · ${e(d.series[0]?.day)} → ${e(d.series.at(-1)?.day)}</div></div>
        <div class="box"><h2>${icon('grid', 'sm')} Top catégories</h2>${table([{ label: 'Catégorie', key: 'name' }, { label: 'Vendus', key: 'sold', num: 1 }, { label: 'Enchères', key: 'bids', num: 1 }, { label: 'CA', num: 1, html: r => money(r.ca) }], d.top_categories.slice(0, 8))}</div>
      </div>
      <div class="grid2">
        <div class="box"><h2>${icon('zap', 'sm')} Dernières enchères (temps réel)</h2><div id="recent">${table([{ label: 'Quand', html: r => dt(r.created_at) }, { label: 'Lot', html: r => `<a class="see-all" href="#lot/${r.lot_id}">${e(r.title_fr)}</a>` }, { label: 'Enchérisseur', key: 'name' }, { label: 'Montant', num: 1, html: r => money(r.amount) + (r.is_auto ? ' <span class="st">auto</span>' : '') }], d.recent_bids)}</div></div>
        <div class="box"><h2>${icon('clock', 'sm')} Se terminent bientôt</h2>${table([{ label: 'Lot', html: r => `<a class="see-all" href="#lot/${r.id}">${e(r.title_fr)}</a>` }, { label: 'Prix', num: 1, html: r => money(r.current_price) }, { label: 'Fin', html: r => dt(r.ends_at) }], d.ending)}</div>
      </div>`;
    shell(); markNav(); $('#title').textContent = 'Tableau de bord'; $('#body').replaceWith(b); b.id = 'body';
  };

  // ---------- Lots ----------
  const lotFields = (l = {}) => [
    { name: 'title_fr', label: 'Titre (FR)', required: true, value: l.title_fr, full: true }, { name: 'title_ar', label: 'Titre (AR)', value: l.title_ar, dir: 'rtl', full: true },
    { name: 'category_id', label: 'Catégorie', type: 'select', options: catOptions(), value: l.category_id }, { name: 'subcategory_id', label: 'Sous-catégorie', type: 'select', options: catOptions(l.category_id || catOptions()[0]?.[0], true), value: l.subcategory_id },
    { name: 'sale_id', label: 'Vente', type: 'select', options: [['', '— Aucune —'], ...A.sales.map(s => [s.id, s.title_fr])], value: l.sale_id }, { name: 'lot_number', label: 'N° de lot', type: 'number', value: l.lot_number },
    { name: 'start_price', label: 'Prix de départ (FDJ)', type: 'number', value: l.start_price, required: true, min: 1 }, { name: 'reserve_price', label: 'Prix de réserve (masqué)', type: 'number', value: l.reserve_price || 0, min: 0 },
    { name: 'increment', label: 'Palier d\'enchère (0 = barème auto)', type: 'number', value: l.increment || 0, min: 0 }, { name: 'buy_now_price', label: 'Achat immédiat (0 = désactivé)', type: 'number', value: l.buy_now_price || 0, min: 0 },
    { name: 'starts_at', label: 'Début', type: 'datetime', value: l.starts_at || Date.now(), required: true }, { name: 'ends_at', label: 'Fin', type: 'datetime', value: l.ends_at || Date.now() + 7 * 864e5, required: true },
    { name: 'status', label: 'Statut', type: 'select', options: ['upcoming', 'live', 'suspended', 'pending', 'withdrawn', 'sold', 'unsold'].map(s => [s, STATUS_FR[s]]), value: l.status || 'upcoming' },
    { name: 'condition', label: 'État', type: 'select', options: [['', '—'], ['new', 'Neuf'], ['like_new', 'Comme neuf'], ['good', 'Bon état'], ['fair', 'Correct'], ['for_parts', 'Pour pièces']], value: l.condition },
    { name: 'location', label: 'Localisation', value: l.location }, { name: 'expiry_date', label: 'DLC (obligatoire pour Nourriture)', type: 'date', value: l.expiry_date },
    { name: 'featured', label: 'Mis en avant (« À la une »)', type: 'checkbox', value: l.featured }, { name: 'favorite', label: 'Coup de cœur', type: 'checkbox', value: l.favorite },
    { name: 'images', label: 'Photos (la 1re est la couverture)', type: 'images', value: l.images || [] },
    { name: 'description_fr', label: 'Description (FR, HTML autorisé)', type: 'html', value: l.description_fr }, { name: 'description_ar', label: 'Description (AR)', type: 'html', value: l.description_ar, dir: 'rtl' },
    { name: 'attrs', label: 'Caractéristiques (JSON, ex. {"brand":"Toyota","year":2018})', type: 'json', value: JSON.stringify(l.attrs || {}) },
  ];
  async function editLot(l) {
    await loadRefs();
    const fields = lotFields(l || {});
    const p = editModal(l ? `Modifier le lot #${l.id}` : 'Nouveau lot', fields, async (data, form) => {
      if (l && ['sold', 'unsold'].includes(l.status) && data.ends_at > Date.now()) data.reopen = '1';
      const fd = await toFormData(form, data);
      await api(l ? `/lots/${l.id}` : '/lots', { method: l ? 'PUT' : 'POST', form: fd });
    });
    // Sous-catégories dépendantes
    const f = $('.modal form');
    f.category_id.onchange = () => { f.subcategory_id.innerHTML = catOptions(f.category_id.value, true).map(([v, t]) => `<option value="${v}">${e(t)}</option>`).join(''); };
    return p;
  }
  async function lotAction(id, action, extra = {}) {
    await run(() => api(`/lots/${id}/action`, { method: 'POST', body: { action, ...extra } }), 'Action effectuée');
  }
  const lotActs = (l) => `<div class="acts">
      <button class="btn btn-sm btn-outline" data-edit="${l.id}" title="Modifier">${icon('edit', 'sm')}</button>
      ${l.status === 'live' ? `<button class="btn btn-sm btn-outline" data-act="extend" data-id="${l.id}" title="Prolonger">+min</button><button class="btn btn-sm btn-outline" data-act="suspend" data-id="${l.id}" title="Suspendre">${icon('pause', 'sm')}</button><button class="btn btn-sm btn-outline" data-act="close" data-id="${l.id}" title="Clôturer">${icon('gavel', 'sm')}</button>` : ''}
      ${l.status === 'suspended' ? `<button class="btn btn-sm btn-outline" data-act="resume" data-id="${l.id}" title="Reprendre">${icon('play', 'sm')}</button>` : ''}
      ${['sold', 'unsold', 'withdrawn'].includes(l.status) ? `<button class="btn btn-sm btn-outline" data-act="relaunch" data-id="${l.id}" title="Relancer">↻</button>` : ''}
      ${l.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-act="approve" data-id="${l.id}">Valider</button><button class="btn btn-sm btn-outline" data-act="reject" data-id="${l.id}">Refuser</button>` : ''}
      <a class="btn btn-sm btn-ghost" href="#lot/${l.id}" title="Détail & enchères">${icon('eye', 'sm')}</a></div>`;
  function bindLotActs(root, reload, list) {
    $$('[data-edit]', root).forEach(b => b.onclick = async () => { const d = await api('/lots/' + b.dataset.edit); if (await editLot(d.lot)) reload(); });
    $$('[data-act]', root).forEach(b => b.onclick = async () => {
      const a = b.dataset.act, id = b.dataset.id; let extra = {};
      if (a === 'extend') { const r = await prompt2('Prolonger l\'enchère', [{ name: 'minutes', label: 'Minutes à ajouter', type: 'number', value: 10 }]); if (!r) return; extra = r; }
      else if (a === 'relaunch') { const r = await prompt2('Relancer le lot (les enchères précédentes sont annulées)', [{ name: 'hours', label: 'Durée (heures)', type: 'number', value: 48 }]); if (!r) return; extra = r; }
      else if (a === 'approve') { const r = await prompt2('Valider et mettre en vente', [{ name: 'sale_id', label: 'Rattacher à une vente', type: 'select', options: [['', '— Aucune —'], ...A.sales.filter(s => s.status !== 'closed').map(s => [s.id, s.title_fr])] }, { name: 'starts_at', label: 'Début', type: 'datetime', value: Date.now() }]); if (!r) return; extra = r; }
      else if (a === 'reject') { const r = await prompt2('Refuser le lot', [{ name: 'reason', label: 'Motif (envoyé au vendeur)', type: 'textarea' }]); if (!r) return; extra = r; }
      else if (a === 'close' && !(await ask('Clôturer ce lot maintenant ? (adjugé au meilleur enchérisseur si la réserve est atteinte)'))) return;
      await lotAction(id, a, extra); reload();
    });
    void list;
  }
  V.lots = async (b) => {
    await loadRefs();
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    const d = await api('/lots?' + qs.toString());
    const reload = () => V.lots(b);
    b.innerHTML = `<div class="filters-bar">
        <input class="input" id="lq" placeholder="Titre ou n° de lot" value="${e(qs.get('q') || '')}">
        <select class="select" id="ls"><option value="">Tous statuts</option>${['live', 'upcoming', 'pending', 'suspended', 'sold', 'unsold', 'withdrawn', 'rejected'].map(s => `<option value="${s}" ${qs.get('status') === s ? 'selected' : ''}>${STATUS_FR[s]}</option>`).join('')}</select>
        <select class="select" id="lc"><option value="">Toutes catégories</option>${catOptions().map(([v, t]) => `<option value="${v}" ${qs.get('category') === String(v) ? 'selected' : ''}>${e(t)}</option>`).join('')}</select>
        <select class="select" id="lsale"><option value="">Toutes ventes</option>${A.sales.map(s => `<option value="${s.id}" ${qs.get('sale') === String(s.id) ? 'selected' : ''}>${e(s.title_fr)}</option>`).join('')}</select>
        <button class="btn btn-primary" id="new">${icon('plus', 'sm')} Nouveau lot</button><span class="muted small">${d.total} lots</span></div>
      ${table([{ label: '', html: l => `<img class="th" src="${e(l.images[0] || '')}" alt="">` }, { label: 'Lot', html: l => `<b>${e(l.title_fr)}</b><div class="small muted">#${l.id} · n°${l.lot_number || '—'} · ${e(l.cat || '')}${l.sale ? ' · ' + e(l.sale) : ''}</div>` },
        { label: 'Statut', html: l => st(l.status) + (l.featured ? ' <span class="st">À la une</span>' : '') + (l.favorite ? ' <span class="st">♥</span>' : '') }, { label: 'Prix', num: 1, html: l => `${money(l.current_price)}<div class="small muted">${l.bids_count} ench. · rés. ${money(l.reserve_price)}</div>` },
        { label: 'Fin', html: l => dt(l.ends_at) }, { label: '', html: lotActs }], d.lots)}
      ${d.pages > 1 ? `<div class="pagination">${Array.from({ length: d.pages }, (_, i) => `<button data-p="${i + 1}" class="${Number(qs.get('page') || 1) === i + 1 ? 'on' : ''}">${i + 1}</button>`).join('')}</div>` : ''}`;
    const apply = (page) => { const p = new URLSearchParams(); const q = $('#lq').value, s = $('#ls').value, c = $('#lc').value, sa = $('#lsale').value; if (q) p.set('q', q); if (s) p.set('status', s); if (c) p.set('category', c); if (sa) p.set('sale', sa); if (page) p.set('page', page); location.hash = 'lots' + (p.toString() ? '?' + p : ''); };
    $('#lq').onkeydown = (ev) => ev.key === 'Enter' && apply(); ['#ls', '#lc', '#lsale'].forEach(s => $(s).onchange = () => apply());
    $$('[data-p]', b).forEach(x => x.onclick = () => apply(x.dataset.p));
    $('#new').onclick = async () => { if (await editLot(null)) reload(); };
    bindLotActs(b, reload);
  };
  V.moderation = async (b) => {
    await loadRefs();
    const d = await api('/lots?status=pending');
    b.innerHTML = `<p class="muted">Lots soumis par les vendeurs : validez-les (mise en vente) ou refusez-les. Vous pouvez d'abord les modifier.</p>
      ${table([{ label: '', html: l => `<img class="th" src="${e(l.images[0] || '')}" alt="">` }, { label: 'Lot', html: l => `<b>${e(l.title_fr)}</b><div class="small muted">${e(l.cat || '')} · vendeur : ${e(l.seller || '—')}</div>` }, { label: 'Mise à prix', num: 1, html: l => money(l.start_price) }, { label: 'Réserve', num: 1, html: l => money(l.reserve_price) }, { label: 'Soumis', html: l => dt(l.created_at) }, { label: '', html: lotActs }], d.lots, 'Aucun lot en attente 🎉')}`;
    bindLotActs(b, () => V.moderation(b));
  };
  // Détail d'un lot : enchères, plafonds automatiques, annulation frauduleuse
  V.lot = async (b) => {
    const id = location.hash.split('/')[1];
    const d = await api('/lots/' + id);
    const l = d.lot;
    $('#title').textContent = `Lot #${l.id}`;
    b.innerHTML = `<div class="box"><div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center"><img src="${e(l.images[0] || '')}" alt="" style="width:110px;height:110px;object-fit:cover;border-radius:12px">
      <div style="flex:1;min-width:240px"><h2 style="margin:0 0 6px">${e(l.title_fr)}</h2>${st(l.status)} <span class="muted small">Début ${dt(l.starts_at)} · Fin ${dt(l.ends_at)}</span>
      <div style="margin-top:8px">Prix actuel <b>${money(l.current_price)}</b> · départ ${money(l.start_price)} · réserve ${money(l.reserve_price)} · palier ${l.increment ? money(l.increment) : 'auto'} · ${l.bids_count} enchères</div></div>
      ${lotActs(l)}<a class="btn btn-sm btn-outline" href="/lot/${l.id}" target="_blank">Voir sur le site</a></div></div>
      <div class="grid2"><div class="box"><h2>Historique des enchères (identités complètes)</h2>${table([{ label: 'Date', html: x => dt(x.created_at) }, { label: 'Enchérisseur', html: x => `${e(x.name)} <span class="small muted">${e(x.phone)}</span>${x.verified ? '' : ' <span class="st suspended">non vérifié</span>'}` }, { label: 'Montant', num: 1, html: x => money(x.amount) + (x.is_auto ? ' <span class="st">auto</span>' : '') }, { label: 'IP', key: 'ip' }, { label: '', html: x => x.cancelled ? '<span class="st cancelled">Annulée</span>' : (l.status === 'live' ? `<button class="btn btn-sm btn-outline" data-cancel="${x.id}">Annuler</button>` : '') }], d.bids, 'Aucune enchère')}</div>
      <div class="box"><h2>Enchères automatiques (plafonds)</h2>${table([{ label: 'Utilisateur', key: 'name' }, { label: 'Plafond', num: 1, html: x => money(x.max_amount) }, { label: 'Depuis', html: x => dt(x.created_at) }], d.proxies, 'Aucun plafond')}</div></div>`;
    bindLotActs(b, () => V.lot(b));
    $$('[data-cancel]', b).forEach(x => x.onclick = async () => {
      const r = await prompt2('Annuler cette enchère (toutes les enchères de cet utilisateur sur ce lot seront annulées)', [{ name: 'reason', label: 'Motif', type: 'textarea' }]); if (!r) return;
      await run(() => api(`/bids/${x.dataset.cancel}/cancel`, { method: 'POST', body: r }), 'Enchère annulée'); V.lot(b);
    });
  };

  // ---------- Ventes ----------
  const saleFields = (s = {}) => [{ name: 'title_fr', label: 'Titre (FR)', value: s.title_fr, required: true, full: true }, { name: 'title_ar', label: 'Titre (AR)', value: s.title_ar, dir: 'rtl', full: true },
    { name: 'starts_at', label: 'Début', type: 'datetime', value: s.starts_at || Date.now() }, { name: 'ends_at', label: 'Fin', type: 'datetime', value: s.ends_at || Date.now() + 3 * 864e5 },
    { name: 'is_live', label: 'Vente live (salle de vente en direct)', type: 'checkbox', value: s.is_live }, { name: 'cover', label: 'Image de couverture (URL)', value: s.cover },
    { name: 'description_fr', label: 'Description (FR)', type: 'textarea', value: s.description_fr }, { name: 'description_ar', label: 'Description (AR)', type: 'textarea', value: s.description_ar, dir: 'rtl' }];
  V.sales = async (b) => {
    const d = await api('/sales');
    b.innerHTML = `<div class="filters-bar"><button class="btn btn-primary" id="new">${icon('plus', 'sm')} Nouvelle vente</button><span class="muted small">« Programmer en live » cadence les lots : un lot se clôture toutes les N minutes dans la salle live.</span></div>
      ${table([{ label: 'Vente', html: s => `<b>${e(s.title_fr)}</b>${s.is_live ? ' <span class="st live">LIVE</span>' : ''}` }, { label: 'Statut', html: s => st(s.status) }, { label: 'Début', html: s => dt(s.starts_at) }, { label: 'Fin', html: s => dt(s.ends_at) }, { label: 'Lots', key: 'lots', num: 1 },
        { label: '', html: s => `<div class="acts"><a class="btn btn-sm btn-outline" href="#lots?sale=${s.id}">Lots</a><button class="btn btn-sm btn-outline" data-sched="${s.id}">Programmer en live</button><button class="btn btn-sm btn-outline" data-e="${s.id}">${icon('edit', 'sm')}</button><button class="btn btn-sm btn-outline" data-d="${s.id}">${icon('trash', 'sm')}</button></div>` }], d.sales)}`;
    const save = (s) => async (data) => { data.status = ''; delete data.status; await api(s ? `/sales/${s.id}` : '/sales', { method: s ? 'PUT' : 'POST', body: data }); };
    $('#new').onclick = async () => { if (await editModal('Nouvelle vente', saleFields(), save(null))) V.sales(b); };
    $$('[data-e]', b).forEach(x => x.onclick = async () => { const s = d.sales.find(y => y.id === Number(x.dataset.e)); if (await editModal('Modifier la vente', saleFields(s), save(s))) V.sales(b); });
    $$('[data-d]', b).forEach(x => x.onclick = async () => { if (await ask('Supprimer cette vente ? (les lots sont conservés, détachés)')) { await run(() => api('/sales/' + x.dataset.d, { method: 'DELETE' }), 'Supprimée'); V.sales(b); } });
    $$('[data-sched]', b).forEach(x => x.onclick = async () => {
      const r = await prompt2('Programmer les lots en séquence', [{ name: 'first_end', label: 'Clôture du premier lot', type: 'datetime', value: Date.now() + 5 * 60e3 }, { name: 'interval', label: 'Intervalle entre deux lots (minutes)', type: 'number', value: 3 }]);
      if (!r) return; const out = await run(() => api(`/sales/${x.dataset.sched}/schedule`, { method: 'POST', body: r })); toast(`${out.count} lots programmés`); V.sales(b);
    });
  };

  // ---------- Enchères ----------
  V.bids = async (b) => {
    const d = await api('/bids');
    b.innerHTML = table([{ label: 'Date', html: x => dt(x.created_at) }, { label: 'Lot', html: x => `<a class="see-all" href="#lot/${x.lot_id}">${e(x.title_fr)}</a> ${st(x.lot_status)}` }, { label: 'Enchérisseur', html: x => `${e(x.name)} <span class="small muted">${e(x.phone)}</span>` }, { label: 'Montant', num: 1, html: x => money(x.amount) + (x.is_auto ? ' <span class="st">auto</span>' : '') }, { label: 'IP', key: 'ip' },
      { label: '', html: x => x.cancelled ? '<span class="st cancelled">Annulée</span>' : x.lot_status === 'live' ? `<button class="btn btn-sm btn-outline" data-cancel="${x.id}">Annuler</button>` : '' }], d.bids);
    $$('[data-cancel]', b).forEach(x => x.onclick = async () => { if (await ask('Annuler cette enchère frauduleuse ?')) { await run(() => api(`/bids/${x.dataset.cancel}/cancel`, { method: 'POST', body: {} }), 'Annulée'); V.bids(b); } });
  };

  // ---------- Factures ----------
  V.invoices = async (b) => {
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    const d = await api('/invoices' + (qs.get('status') ? '?status=' + qs.get('status') : ''));
    b.innerHTML = `<div class="filters-bar">${['', 'unpaid', 'pending', 'paid', 'cancelled'].map(s => `<a class="chip ${(qs.get('status') || '') === s ? 'on' : ''}" href="#invoices${s ? '?status=' + s : ''}">${s ? STATUS_FR[s] : 'Toutes'}</a>`).join('')}</div>
      ${table([{ label: 'N°', html: i => `<b>${e(i.number)}</b><div class="small muted">${dt(i.created_at)}</div>` }, { label: 'Client', html: i => `${e(i.name)}<div class="small muted">${e(i.phone)}</div>` }, { label: 'Lot', key: 'title_fr' }, { label: 'Total', num: 1, html: i => money(i.total) },
        { label: 'Paiement', html: i => `${st(i.status)}<div class="small muted">${e(i.payment_method || '')} ${e(i.payment_ref || '')}</div>` }, { label: 'Livraison', html: i => `${st(i.delivery_status)}<div class="small muted">${e(i.zone || '')}</div>` },
        { label: '', html: i => `<div class="acts">${i.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-paid="${i.id}">Confirmer paiement</button>` : ''}<button class="btn btn-sm btn-outline" data-e="${i.id}">${icon('edit', 'sm')}</button><button class="btn btn-sm btn-outline" data-print="${i.id}" title="Imprimer / PDF">${icon('download', 'sm')}</button></div>` }], d.invoices)}`;
    $$('[data-paid]', b).forEach(x => x.onclick = async () => { await run(() => api('/invoices/' + x.dataset.paid, { method: 'PUT', body: { status: 'paid', delivery_status: 'preparing' } }), 'Paiement confirmé'); V.invoices(b); });
    $$('[data-e]', b).forEach(x => x.onclick = async () => {
      const i = d.invoices.find(y => y.id === Number(x.dataset.e));
      if (await editModal(`Facture ${i.number}`, [{ name: 'status', label: 'Statut paiement', type: 'select', options: ['unpaid', 'pending', 'paid', 'cancelled'].map(s => [s, STATUS_FR[s]]), value: i.status },
        { name: 'delivery_status', label: 'Statut livraison', type: 'select', options: ['waiting', 'preparing', 'shipped', 'delivered', 'pickup'].map(s => [s, STATUS_FR[s]]), value: i.delivery_status }, { name: 'tracking', label: 'Suivi / remarque livraison', value: i.tracking, full: true }],
      (data) => api('/invoices/' + i.id, { method: 'PUT', body: data }))) V.invoices(b);
    });
    $$('[data-print]', b).forEach(x => x.onclick = async () => {
      const { invoice: i } = await api('/print/invoice/' + x.dataset.print);
      const w = window.open('', '_blank');
      w.document.write(`<!doctype html><meta charset="utf-8"><title>${e(i.number)}</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;color:#111}table{width:100%;border-collapse:collapse}td{padding:8px;border-bottom:1px solid #ddd}td:last-child{text-align:right}h1{margin:0}.t{font-weight:800;font-size:1.2em}</style>
        <h1>Facture / bordereau d'adjudication ${e(i.number)}</h1><p>Date : ${dt(i.created_at)}</p><p><b>Acheteur :</b> ${e(i.name)} — ${e(i.phone)} ${e(i.email || '')}</p><p><b>Lot :</b> n°${e(i.lot_number || i.lot_id)} — ${e(i.title_fr)}</p>
        <table><tr><td>Prix d'adjudication</td><td>${money(i.amount)}</td></tr><tr><td>Frais acheteur</td><td>${money(i.buyer_fee)}</td></tr><tr><td>Livraison (${e(i.zone || '—')})</td><td>${money(i.delivery_fee)}</td></tr><tr class="t"><td>Total</td><td>${money(i.total)}</td></tr></table>
        <p>Statut : ${e(STATUS_FR[i.status])} ${i.payment_method ? '· ' + e(i.payment_method) + ' ' + e(i.payment_ref || '') : ''}</p><p>Adresse : ${e(i.address || '—')}</p><script>print()<\/script>`);
      w.document.close();
    });
  };

  // ---------- Utilisateurs ----------
  V.users = async (b) => {
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    const d = await api('/users?' + qs.toString());
    const isSuper = A.me.role === 'superadmin';
    b.innerHTML = `<div class="filters-bar"><input class="input" id="uq" placeholder="Nom, téléphone, e-mail" value="${e(qs.get('q') || '')}">
        ${['', 'unverified', 'sellers', 'banned'].map(f => `<a class="chip ${(qs.get('filter') || '') === f ? 'on' : ''}" href="#users${f ? '?filter=' + f : ''}">${{ '': 'Tous', unverified: 'Non vérifiés', sellers: 'Vendeurs', banned: 'Bannis' }[f]}</a>`).join('')}
        <button class="btn btn-primary" id="new">${icon('plus', 'sm')} Ajouter</button></div>
      ${table([{ label: 'Utilisateur', html: u => `<b>${e(u.name)}</b> <span class="muted small">(${e(u.pseudo)})</span><div class="small muted">${e(u.phone)} · ${e(u.email || '')}</div>` }, { label: 'Rôle', html: u => isSuper ? `<select class="select" style="min-height:34px;padding:4px 8px;width:auto" data-role="${u.id}">${['user', 'auctioneer', 'moderator', 'admin', 'superadmin'].map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>` : e(u.role) },
        { label: 'Vérifié', html: u => sw('verified', u.verified, `data-u="${u.id}"`) }, { label: 'Vendeur vérifié', html: u => sw('seller_verified', u.seller_verified, `data-u="${u.id}"`) }, { label: 'Banni', html: u => sw('banned', u.banned, `data-u="${u.id}"`) },
        { label: 'Activité', html: u => `${u.bids} ench. · ${u.won} gagnés<div class="small muted">IP ${e(u.last_ip || '—')}</div>` }, { label: '', html: u => `<div class="acts"><button class="btn btn-sm btn-outline" data-detail="${u.id}">${icon('eye', 'sm')}</button></div>` }], d.users)}`;
    $('#uq').onkeydown = (ev) => { if (ev.key === 'Enter') location.hash = 'users?q=' + encodeURIComponent(ev.target.value); };
    $$('[data-sw]', b).forEach(x => x.onchange = () => run(() => api('/users/' + x.dataset.u, { method: 'PUT', body: { [x.dataset.sw]: x.checked } }), 'Mis à jour').catch(() => { x.checked = !x.checked; }));
    $$('[data-role]', b).forEach(x => x.onchange = () => run(() => api('/users/' + x.dataset.role, { method: 'PUT', body: { role: x.value } }), 'Rôle modifié'));
    $('#new').onclick = async () => { if (await editModal('Nouvel utilisateur', [{ name: 'name', label: 'Nom', required: true }, { name: 'phone', label: 'Téléphone (+253…)', required: true }, { name: 'email', label: 'E-mail', type: 'email' }, { name: 'password', label: 'Mot de passe (8+)', type: 'password' }, { name: 'role', label: 'Rôle', type: 'select', options: (isSuper ? ['user', 'auctioneer', 'moderator', 'admin', 'superadmin'] : ['user']).map(r => [r, r]) }], (data) => api('/users', { method: 'POST', body: data }))) V.users(b); };
    $$('[data-detail]', b).forEach(x => x.onclick = async () => {
      const r = await api('/users/' + x.dataset.detail);
      modal(`<h3>${e(r.user.name)}</h3><p class="small muted">${e(r.user.phone)} · inscrit ${dt(r.user.created_at)} · dépôt ${money(r.user.deposit)}</p>
        <h4>Adresses IP</h4>${table([{ label: 'IP', key: 'ip' }, { label: 'Connexions', key: 'n', num: 1 }, { label: 'Dernière', html: y => dt(y.last) }], r.ips)}
        <h4 style="margin-top:14px">Comptes partageant une IP</h4>${table([{ label: 'Compte', html: y => `${e(y.name)} <span class="muted small">${e(y.phone)}</span>` }, { label: 'IP', key: 'ip' }], r.shared, 'Aucun')}
        <h4 style="margin-top:14px">Dernières enchères</h4>${table([{ label: 'Lot', key: 'title_fr' }, { label: 'Montant', num: 1, html: y => money(y.amount) }, { label: 'Date', html: y => dt(y.created_at) }], r.bids)}
        <form id="dep" style="display:flex;gap:8px;margin-top:14px"><input class="input" name="deposit" type="number" value="${r.user.deposit}"><button class="btn btn-outline">Mettre à jour le dépôt de garantie</button></form>
        <div class="modal-actions"><button class="btn btn-outline" data-close>Fermer</button></div>`, (m) => { m.querySelector('#dep').onsubmit = (ev) => { ev.preventDefault(); run(() => api('/users/' + r.user.id, { method: 'PUT', body: { deposit: ev.target.deposit.value } }), 'Dépôt mis à jour'); }; });
    });
  };

  // ---------- Avis & avis flottants ----------
  V.reviews = async (b) => {
    const d = await api('/reviews');
    b.innerHTML = `<div class="filters-bar"><button class="btn btn-primary" id="new">${icon('plus', 'sm')} Ajouter un avis</button></div>
      ${table([{ label: 'Auteur', html: r => `<b>${e(r.author_name)}</b><div class="small muted">${dt(r.created_at)}${r.seller ? ' · vendeur : ' + e(r.seller) : ' · plateforme'}</div>` }, { label: 'Note', html: r => '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) }, { label: 'Commentaire', html: r => `<div style="max-width:420px">${e(r.comment)}</div>` },
        { label: 'Statut', html: r => st(r.status) }, { label: 'En avant', html: r => sw('featured', r.featured, `data-r="${r.id}"`) },
        { label: '', html: r => `<div class="acts">${r.status !== 'approved' ? `<button class="btn btn-sm btn-primary" data-s="approved" data-id="${r.id}">Approuver</button>` : `<button class="btn btn-sm btn-outline" data-s="hidden" data-id="${r.id}">Masquer</button>`}<button class="btn btn-sm btn-outline" data-del="${r.id}">${icon('trash', 'sm')}</button></div>` }], d.reviews)}`;
    $$('[data-s]', b).forEach(x => x.onclick = async () => { await run(() => api('/reviews/' + x.dataset.id, { method: 'PUT', body: { status: x.dataset.s } }), 'Mis à jour'); V.reviews(b); });
    $$('[data-sw]', b).forEach(x => x.onchange = () => run(() => api('/reviews/' + x.dataset.r, { method: 'PUT', body: { featured: x.checked } }), 'Mis à jour'));
    $$('[data-del]', b).forEach(x => x.onclick = async () => { if (await ask('Supprimer cet avis ?')) { await run(() => api('/reviews/' + x.dataset.del, { method: 'DELETE' }), 'Supprimé'); V.reviews(b); } });
    $('#new').onclick = async () => { if (await editModal('Nouvel avis', [{ name: 'author_name', label: 'Nom affiché', required: true }, { name: 'rating', label: 'Note', type: 'select', options: [5, 4, 3, 2, 1].map(n => [n, '★'.repeat(n)]) }, { name: 'comment', label: 'Commentaire', type: 'textarea' }, { name: 'featured', label: 'Mettre en avant', type: 'checkbox' }], (data) => api('/reviews', { method: 'POST', body: { ...data, featured: data.featured === '1' } }))) V.reviews(b); };
  };
  V.toasts = async (b) => {
    const [s, m] = await Promise.all([api('/settings'), api('/toasts')]);
    const S = s.settings;
    const fields = [{ name: 'toasts_enabled', label: 'Activer les avis flottants sur le site', type: 'checkbox', value: S.toasts_enabled === '1' },
      { name: 'toast_duration', label: 'Durée d\'affichage (secondes)', type: 'number', value: S.toast_duration, min: 2 }, { name: 'toast_interval', label: 'Intervalle entre deux avis (secondes)', type: 'number', value: S.toast_interval, min: 4 },
      { name: 'toast_position', label: 'Position', type: 'select', options: [['bottom-left', 'Bas gauche'], ['bottom-right', 'Bas droite']], value: S.toast_position },
      { name: 'toast_source', label: 'Source', type: 'select', options: [['both', 'Avis réels + gains récents + messages personnalisés'], ['reviews', 'Avis réels approuvés et gains récents uniquement'], ['custom', 'Messages personnalisés uniquement']], value: S.toast_source }];
    b.innerHTML = `<div class="grid2"><form class="box form-grid" id="tf"><h2 class="full">Réglages</h2>${fields.map(field).join('')}<div class="full"><button class="btn btn-primary">Enregistrer</button> <span class="small muted">Exemple : « Hassan a remporté « Toyota Hilux » il y a 3 min »</span></div></form>
      <div class="box"><h2>Messages personnalisés <button class="btn btn-sm btn-primary" id="new" style="margin-inline-start:auto">${icon('plus', 'sm')}</button></h2>${table([{ label: 'Message', html: x => `${e(x.text_fr)}<div class="small muted" dir="rtl">${e(x.text_ar || '')}</div>` }, { label: 'Actif', html: x => sw('active', x.active, `data-t="${x.id}"`) }, { label: '', html: x => `<div class="acts"><button class="btn btn-sm btn-outline" data-e="${x.id}">${icon('edit', 'sm')}</button><button class="btn btn-sm btn-outline" data-del="${x.id}">${icon('trash', 'sm')}</button></div>` }], m.items)}</div></div>`;
    $('#tf').onsubmit = (ev) => { ev.preventDefault(); const data = readForm(ev.target, fields); run(() => api('/settings', { method: 'PUT', body: data }), 'Réglages enregistrés'); };
    const tFields = (x = {}) => [{ name: 'text_fr', label: 'Message (FR)', value: x.text_fr, full: true }, { name: 'text_ar', label: 'Message (AR)', value: x.text_ar, dir: 'rtl', full: true }, { name: 'active', label: 'Actif', type: 'checkbox', value: x.active ?? 1 }];
    $('#new').onclick = async () => { if (await editModal('Nouveau message', tFields(), (data) => api('/toasts', { method: 'POST', body: data }))) V.toasts(b); };
    $$('[data-e]', b).forEach(x => x.onclick = async () => { const it = m.items.find(y => y.id === Number(x.dataset.e)); if (await editModal('Modifier', tFields(it), (data) => api('/toasts/' + it.id, { method: 'PUT', body: data }))) V.toasts(b); });
    $$('[data-t]', b).forEach(x => x.onchange = () => run(() => api('/toasts/' + x.dataset.t, { method: 'PUT', body: { active: x.checked ? '1' : '0' } }), 'Mis à jour'));
    $$('[data-del]', b).forEach(x => x.onclick = async () => { if (await ask('Supprimer ?')) { await api('/toasts/' + x.dataset.del, { method: 'DELETE' }); V.toasts(b); } });
  };

  // ---------- Identité (white-label) ----------
  V.identity = async (b) => {
    const S = (await api('/settings')).settings;
    const fields = [{ name: 'site_name', label: 'Nom du site', value: S.site_name, full: true }, { name: 'slogan_fr', label: 'Slogan (FR)', value: S.slogan_fr }, { name: 'slogan_ar', label: 'Slogan (AR)', value: S.slogan_ar, dir: 'rtl' },
      { name: 'color_primary', label: 'Couleur principale', type: 'color', value: S.color_primary }, { name: 'color_accent', label: 'Couleur d\'action (bouton enchérir)', type: 'color', value: S.color_accent }, { name: 'color_dark', label: 'Couleur sombre (textes, bandeaux)', type: 'color', value: S.color_dark },
      { name: 'default_lang', label: 'Langue par défaut', type: 'select', options: [['fr', 'Français'], ['ar', 'العربية']], value: S.default_lang },
      { name: 'whatsapp_number', label: 'Numéro WhatsApp (bouton flottant)', value: S.whatsapp_number, help: 'Format international sans + : 25377XXXXXX' }, { name: 'support_phone', label: 'Téléphone support', value: S.support_phone },
      { name: 'support_email', label: 'E-mail support', value: S.support_email }, { name: 'address', label: 'Adresse', value: S.address },
      { name: 'social_facebook', label: 'Facebook (URL)', value: S.social_facebook }, { name: 'social_instagram', label: 'Instagram (URL)', value: S.social_instagram }, { name: 'social_tiktok', label: 'TikTok (URL)', value: S.social_tiktok }];
    b.innerHTML = `<div class="grid2"><form class="box form-grid" id="idf"><h2 class="full">Nom, slogan, couleurs & contacts</h2>${fields.map(field).join('')}<div class="full"><button class="btn btn-primary">Enregistrer</button></div></form>
      <div><div class="box"><h2>Logo</h2><div class="preview-logo">${S.logo ? `<img src="${e(S.logo)}" alt="Logo">` : '<span class="muted small">Logo par défaut (icône + nom)</span>'}</div><form data-up="logo" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><input type="file" accept="image/*" name="f" required><button class="btn btn-outline btn-sm">Téléverser</button>${S.logo ? '<button type="button" class="btn btn-ghost btn-sm" data-clear="logo">Retirer</button>' : ''}</form></div>
        <div class="box"><h2>Favicon</h2><div class="preview-logo"><img src="${e(S.favicon || '/img/icon.svg')}" alt="" style="height:32px"></div><form data-up="favicon" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><input type="file" accept="image/png,image/svg+xml,image/x-icon" name="f" required><button class="btn btn-outline btn-sm">Téléverser</button>${S.favicon ? '<button type="button" class="btn btn-ghost btn-sm" data-clear="favicon">Retirer</button>' : ''}</form></div>
        <div class="alert alert-info">${icon('info', 'sm')} Les changements s'appliquent immédiatement sur le site pour tous les visiteurs connectés.</div></div></div>`;
    bindForm($('#idf'));
    $('#idf').onsubmit = (ev) => { ev.preventDefault(); run(() => api('/settings', { method: 'PUT', body: readForm(ev.target, fields) }), 'Identité mise à jour'); };
    $$('[data-up]', b).forEach(f => f.onsubmit = async (ev) => { ev.preventDefault(); const fd = new FormData(); fd.append('files', await compress(f.f.files[0], 600)); await run(() => api('/settings/upload/' + f.dataset.up, { method: 'POST', form: fd }), 'Image mise à jour'); V.identity(b); });
    $$('[data-clear]', b).forEach(x => x.onclick = async () => { await run(() => api('/settings', { method: 'PUT', body: { [x.dataset.clear]: '' } }), 'Retiré'); V.identity(b); });
  };

  // ---------- Textes ----------
  V.texts = async (b) => {
    const d = await api('/texts');
    b.innerHTML = `<div class="filters-bar"><input class="input" id="tq" placeholder="Rechercher une clé ou un texte…" style="min-width:280px"><select class="select" id="tg"><option value="">Toutes les sections</option>${[...new Set(d.texts.map(x => x.key.split('.')[0]))].map(g => `<option>${g}</option>`).join('')}</select><span class="small muted">Chaque texte est enregistré dès que vous quittez le champ. Les pages (page.*.body) acceptent le HTML.</span></div>
      <div class="box" id="tl">${d.texts.map(x => `<div class="text-row" data-k="${e(x.key)}"><code>${e(x.key)}</code><textarea class="textarea" data-l="fr" rows="${x.long ? 6 : 1}">${e(x.fr)}</textarea><textarea class="textarea" data-l="ar" dir="rtl" rows="${x.long ? 6 : 1}">${e(x.ar)}</textarea></div>`).join('')}</div>`;
    const filter = () => { const q = $('#tq').value.toLowerCase(), g = $('#tg').value; $$('.text-row', b).forEach(r => { const k = r.dataset.k; r.style.display = (!g || k.startsWith(g + '.')) && (!q || (k + ' ' + $$('textarea', r).map(t => t.value).join(' ')).toLowerCase().includes(q)) ? '' : 'none'; }); };
    $('#tq').oninput = filter; $('#tg').onchange = filter;
    $$('.text-row textarea', b).forEach(ta => { ta.dataset.orig = ta.value; ta.onchange = () => { const r = ta.closest('.text-row'); run(() => api('/texts/' + encodeURIComponent(r.dataset.k), { method: 'PUT', body: { [ta.dataset.l]: ta.value } }), `« ${r.dataset.k} » enregistré`); }; });
  };

  // ---------- CRUD simples : bannières, partenaires, zones ----------
  function crudView(path, cols, fields, opts = {}) {
    return async (b) => {
      const d = await api('/' + path);
      b.innerHTML = `${opts.intro ? `<p class="muted">${opts.intro}</p>` : ''}<div class="filters-bar"><button class="btn btn-primary" id="new">${icon('plus', 'sm')} Ajouter</button></div>
        ${table([...cols, { label: 'Actif', html: x => sw('active', x.active, `data-a="${x.id}"`) }, { label: '', html: x => `<div class="acts"><button class="btn btn-sm btn-outline" data-e="${x.id}">${icon('edit', 'sm')}</button><button class="btn btn-sm btn-outline" data-del="${x.id}">${icon('trash', 'sm')}</button></div>` }], d.items)}`;
      const save = (it) => async (data, form) => api(`/${path}${it ? '/' + it.id : ''}`, { method: it ? 'PUT' : 'POST', form: opts.file ? await toFormData(form, data) : undefined, body: opts.file ? undefined : data });
      $('#new').onclick = async () => { if (await editModal('Ajouter', fields({}), save(null))) V[A.route](b); };
      $$('[data-e]', b).forEach(x => x.onclick = async () => { const it = d.items.find(y => y.id === Number(x.dataset.e)); if (await editModal('Modifier', fields(it), save(it))) V[A.route](b); });
      $$('[data-a]', b).forEach(x => x.onchange = () => run(() => api(`/${path}/${x.dataset.a}`, { method: 'PUT', body: { active: x.checked ? '1' : '0' } }), 'Mis à jour'));
      $$('[data-del]', b).forEach(x => x.onclick = async () => { if (await ask('Supprimer cet élément ?')) { await run(() => api(`/${path}/${x.dataset.del}`, { method: 'DELETE' }), 'Supprimé'); V[A.route](b); } });
    };
  }
  V.banners = crudView('banners', [{ label: '', html: x => x.image ? `<img class="th" src="${e(x.image)}" alt="">` : '' }, { label: 'Type', html: x => x.kind === 'hero' ? 'Carrousel d\'accueil' : 'Bannière promo' }, { label: 'Titre', html: x => `<b>${e(x.title_fr)}</b><div class="small muted">${e(x.subtitle_fr || '')}</div>` }, { label: 'Lien', key: 'link' }, { label: 'Ordre', key: 'sort', num: 1 }],
    (x) => [{ name: 'kind', label: 'Type', type: 'select', options: [['hero', 'Carrousel d\'accueil'], ['promo', 'Bannière promo']], value: x.kind }, { name: 'sort', label: 'Ordre', type: 'number', value: x.sort ?? 0 },
      { name: 'title_fr', label: 'Titre (FR)', value: x.title_fr }, { name: 'title_ar', label: 'Titre (AR)', value: x.title_ar, dir: 'rtl' }, { name: 'subtitle_fr', label: 'Sous-titre (FR)', value: x.subtitle_fr }, { name: 'subtitle_ar', label: 'Sous-titre (AR)', value: x.subtitle_ar, dir: 'rtl' },
      { name: 'link', label: 'Lien (ex. /live, /c/voiture)', value: x.link }, { name: 'image', label: 'Image', type: 'file', value: x.image }, { name: 'active', label: 'Active', type: 'checkbox', value: x.active ?? 1 }], { file: true, intro: 'Le carrousel d\'accueil et les bannières promotionnelles. Lots mis en avant : utilisez « À la une » et « Coup de cœur » sur chaque lot.' });
  V.partners = crudView('partners', [{ label: 'Logo', html: x => `<img class="th" style="object-fit:contain" src="${e(x.logo)}" alt="">` }, { label: 'Nom', key: 'name' }, { label: 'Lien', key: 'url' }, { label: 'Ordre', key: 'sort', num: 1 }],
    (x) => [{ name: 'name', label: 'Nom', value: x.name, required: true }, { name: 'url', label: 'Lien', value: x.url }, { name: 'sort', label: 'Ordre d\'affichage', type: 'number', value: x.sort ?? 0 }, { name: 'logo', label: 'Logo', type: 'file', value: x.logo }, { name: 'active', label: 'Actif', type: 'checkbox', value: x.active ?? 1 }], { file: true, intro: 'Logos affichés dans le carrousel partenaires de la page d\'accueil.' });
  V.zones = crudView('zones', [{ label: 'Zone', html: x => `<b>${e(x.name_fr)}</b> <span class="muted" dir="rtl">${e(x.name_ar)}</span>` }, { label: 'Frais', num: 1, html: x => money(x.fee) }, { label: 'Délai', key: 'delay_fr' }, { label: 'Retrait', html: x => x.is_pickup ? 'Oui' : '' }, { label: 'Ordre', key: 'sort', num: 1 }],
    (x) => [{ name: 'name_fr', label: 'Nom (FR)', value: x.name_fr, required: true }, { name: 'name_ar', label: 'Nom (AR)', value: x.name_ar, dir: 'rtl' }, { name: 'fee', label: 'Frais (FDJ)', type: 'number', value: x.fee ?? 0, min: 0 }, { name: 'delay_fr', label: 'Délai', value: x.delay_fr },
      { name: 'sort', label: 'Ordre', type: 'number', value: x.sort ?? 0 }, { name: 'is_pickup', label: 'Retrait sur place', type: 'checkbox', value: x.is_pickup }, { name: 'active', label: 'Active', type: 'checkbox', value: x.active ?? 1 }]);

  // ---------- Catégories ----------
  V.categories = async (b) => {
    const d = await api('/categories');
    A.cats = d.categories;
    const ICONS = Object.keys(window.ICONS || {});
    const cf = (c = {}, parent) => [{ name: 'name_fr', label: 'Nom (FR)', value: c.name_fr, required: true }, { name: 'name_ar', label: 'Nom (AR)', value: c.name_ar, dir: 'rtl' },
      { name: 'icon', label: 'Icône', type: 'select', options: ICONS.map(i => [i, i]), value: c.icon || 'box' }, { name: 'sort', label: 'Ordre', type: 'number', value: c.sort ?? 99 },
      { name: 'requires_expiry', label: 'DLC obligatoire (alimentaire)', type: 'checkbox', value: c.requires_expiry }, { name: 'active', label: 'Active', type: 'checkbox', value: c.active ?? 1 },
      ...(parent || c.parent_id ? [] : [{ name: 'image', label: 'Image d\'illustration (grille « Parcourir les catégories »)', type: 'file', value: c.image, full: true }]),
      ...(parent || c.parent_id ? [] : [{ name: 'filters', label: 'Filtres spécifiques (JSON)', type: 'json', value: c.filters || '[]', help: '[{"key":"brand","label_fr":"Marque","label_ar":"العلامة","type":"select","options":["Toyota"]},{"key":"year","label_fr":"Année","label_ar":"السنة","type":"range"}]' }])];
    const tops = d.categories.filter(c => !c.parent_id);
    b.innerHTML = `<div class="filters-bar"><button class="btn btn-primary" id="new">${icon('plus', 'sm')} Nouvelle catégorie</button></div>
      ${tops.map(c => `<div class="box"><h2>${c.image ? `<img src="${e(c.image)}" alt="" style="width:44px;height:33px;object-fit:cover">` : icon(c.icon, 'sm')} ${e(c.name_fr)} <span class="muted small" dir="rtl">${e(c.name_ar)}</span> ${c.active ? '' : '<span class="st hidden">inactive</span>'} <span class="muted small">${c.lots} lots</span>
        <span style="margin-inline-start:auto;display:flex;gap:4px"><button class="btn btn-sm btn-outline" data-sub="${c.id}">${icon('plus', 'sm')} Sous-catégorie</button><button class="btn btn-sm btn-outline" data-e="${c.id}">${icon('edit', 'sm')}</button><button class="btn btn-sm btn-outline" data-del="${c.id}">${icon('trash', 'sm')}</button></span></h2>
        <div class="chips" style="flex-wrap:wrap">${d.categories.filter(s => s.parent_id === c.id).map(s => `<span class="chip ${s.active ? '' : 'muted'}">${e(s.name_fr)} <small>${s.lots}</small> <button class="btn-ghost" style="border:0;padding:0 2px" data-e="${s.id}" aria-label="Modifier">${icon('edit', 'sm')}</button><button class="btn-ghost" style="border:0;padding:0 2px" data-del="${s.id}" aria-label="Supprimer">${icon('x', 'sm')}</button></span>`).join('')}</div></div>`).join('')}`;
    const find = (id) => d.categories.find(c => c.id === Number(id));
    // Image de catégorie : envoyée d'abord via /upload, puis son URL est enregistrée
    const withImage = async (data, form) => {
      const fi = form.querySelector('input[name="__files"]');
      if (fi && fi.files[0]) { const fd = new FormData(); fd.append('files', await compress(fi.files[0], 1000)); data.image = (await api('/upload', { method: 'POST', form: fd })).urls[0]; }
      return data;
    };
    $('#new').onclick = async () => { if (await editModal('Nouvelle catégorie', cf(), async (data, form) => api('/categories', { method: 'POST', body: await withImage(data, form) }))) V.categories(b); };
    $$('[data-sub]', b).forEach(x => x.onclick = async () => { if (await editModal('Nouvelle sous-catégorie', cf({ icon: find(x.dataset.sub).icon }, true), (data) => api('/categories', { method: 'POST', body: { ...data, parent_id: x.dataset.sub } }))) V.categories(b); });
    $$('[data-e]', b).forEach(x => x.onclick = async () => { const c = find(x.dataset.e); if (await editModal('Modifier « ' + c.name_fr + ' »', cf(c), async (data, form) => api('/categories/' + c.id, { method: 'PUT', body: { ...(await withImage(data, form)), active: data.active === '1', requires_expiry: data.requires_expiry === '1' } }))) V.categories(b); });
    $$('[data-del]', b).forEach(x => x.onclick = async () => { if (await ask('Supprimer cette catégorie ?')) { await run(() => api('/categories/' + x.dataset.del, { method: 'DELETE' }), 'Supprimée'); V.categories(b); } });
  };

  // ---------- Paiements ----------
  V.payments = async (b) => {
    const d = await api('/payments');
    b.innerHTML = `<p class="muted">Activez ou désactivez chaque passerelle. Les instructions acceptent des variables issues de la configuration JSON (ex. {merchant}). Pour une confirmation automatique, ajoutez <code>"webhook_secret"</code> et faites appeler <code>POST /api/payments/webhook/&lt;code&gt;</code> par le prestataire.</p>
      ${table([{ label: 'Passerelle', html: m => `<b>${e(m.name)}</b><div class="small muted">${e(m.code)} · ${e(m.kind)}</div>` }, { label: 'Instructions (FR)', html: m => `<div class="small" style="max-width:420px">${e(m.instructions_fr)}</div>` }, { label: 'Active', html: m => sw('enabled', m.enabled, `data-m="${m.code}"`) }, { label: '', html: m => `<button class="btn btn-sm btn-outline" data-e="${m.code}">${icon('edit', 'sm')}</button>` }], d.methods)}`;
    $$('[data-sw]', b).forEach(x => x.onchange = () => run(() => api('/payments/' + x.dataset.m, { method: 'PUT', body: { enabled: x.checked } }), x.checked ? 'Passerelle activée' : 'Passerelle désactivée'));
    $$('[data-e]', b).forEach(x => x.onclick = async () => {
      const m = d.methods.find(y => y.code === x.dataset.e);
      if (await editModal(m.name, [{ name: 'name', label: 'Nom affiché', value: m.name }, { name: 'sort', label: 'Ordre', type: 'number', value: m.sort }, { name: 'instructions_fr', label: 'Instructions (FR)', type: 'textarea', value: m.instructions_fr }, { name: 'instructions_ar', label: 'Instructions (AR)', type: 'textarea', value: m.instructions_ar, dir: 'rtl' }, { name: 'config', label: 'Configuration (JSON)', type: 'json', value: JSON.stringify(JSON.parse(m.config || '{}'), null, 2) }],
        (data) => api('/payments/' + m.code, { method: 'PUT', body: data }))) V.payments(b);
    });
  };

  // ---------- Paramètres ----------
  V.settings = async (b) => {
    const S = (await api('/settings')).settings;
    const groups = [
      ['Enchères', [{ name: 'anti_snipe_window', label: 'Anti-sniping : fenêtre finale (secondes)', type: 'number', value: S.anti_snipe_window, help: 'Une enchère dans cette fenêtre prolonge la vente. 0 = désactivé.' }, { name: 'anti_snipe_extend', label: 'Prolongation (secondes)', type: 'number', value: S.anti_snipe_extend },
        { name: 'default_increment', label: 'Palier par défaut (FDJ, 0 = barème progressif)', type: 'number', value: S.default_increment }, { name: 'bid_rate_limit', label: 'Max enchères par compte / 10 s', type: 'number', value: S.bid_rate_limit }]],
      ['Frais & commissions', [{ name: 'buyer_fee_pct', label: 'Frais acheteur (%)', type: 'number', value: S.buyer_fee_pct }, { name: 'seller_commission_pct', label: 'Commission vendeur (%)', type: 'number', value: S.seller_commission_pct }, { name: 'payment_deadline_hours', label: 'Délai de paiement (heures)', type: 'number', value: S.payment_deadline_hours }]],
      ['Confiance & anti-fraude', [{ name: 'unverified_bid_limit', label: 'Limite d\'enchère compte non vérifié (FDJ, 0 = aucune)', type: 'number', value: S.unverified_bid_limit }, { name: 'max_accounts_per_ip', label: 'Alerte au-delà de N comptes par IP', type: 'number', value: S.max_accounts_per_ip },
        { name: 'deposit_enabled', label: 'Dépôt de garantie obligatoire pour enchérir', type: 'checkbox', value: S.deposit_enabled === '1' }, { name: 'deposit_amount', label: 'Montant du dépôt (FDJ)', type: 'number', value: S.deposit_amount },
        { name: 'admin_2fa_required', label: 'Exiger la 2FA pour tout le back-office', type: 'checkbox', value: S.admin_2fa_required === '1' }]],
      ['Devises & langue', [{ name: 'currency', label: 'Devise par défaut', type: 'select', options: [['DJF', 'Franc Djiboutien (FDJ)'], ['USD', 'Dollar US'], ['EUR', 'Euro']], value: S.currency }, { name: 'currencies_enabled', label: 'Devises proposées (séparées par des virgules)', value: S.currencies_enabled },
        { name: 'rate_USD', label: 'Taux : 1 FDJ = x USD', value: S.rate_USD }, { name: 'rate_EUR', label: 'Taux : 1 FDJ = x EUR', value: S.rate_EUR }, { name: 'default_lang', label: 'Langue par défaut', type: 'select', options: [['fr', 'Français'], ['ar', 'العربية']], value: S.default_lang }]],
      ['Notifications WhatsApp (API Cloud Meta)', [{ name: 'whatsapp_phone_id', label: 'Phone number ID', value: S.whatsapp_phone_id }, { name: 'whatsapp_api_token', label: 'Jeton d\'accès', type: 'password', value: S.whatsapp_api_token, help: 'Laisser vide : les messages restent en file (Notifications envoyées).' }]],
    ];
    const all = groups.flatMap(g => g[1]);
    b.innerHTML = `<form id="sf">${groups.map(([g, f]) => `<div class="box"><h2>${e(g)}</h2><div class="form-grid">${f.map(field).join('')}</div></div>`).join('')}<button class="btn btn-primary btn-lg">Enregistrer les paramètres</button></form>`;
    $('#sf').onsubmit = (ev) => { ev.preventDefault(); run(() => api('/settings', { method: 'PUT', body: readForm(ev.target, all) }), 'Paramètres enregistrés'); };
  };

  // ---------- Sécurité 2FA ----------
  V.security = async (b) => {
    const r = await api('/me'); A.me = r.me;
    b.innerHTML = `<div class="box" style="max-width:620px"><h2>${icon('lock', 'sm')} Double authentification (TOTP)</h2>
      ${A.me.totp_enabled ? `<div class="alert alert-ok">${icon('check', 'sm')} La 2FA est active sur votre compte.</div><form id="dis" style="display:flex;gap:8px;margin-top:12px"><input class="input" name="code" placeholder="Code à 6 chiffres" inputmode="numeric" maxlength="6"><button class="btn btn-outline">Désactiver</button></form>`
        : `<p class="muted">Utilisez Google Authenticator, Microsoft Authenticator ou toute application TOTP.</p><button class="btn btn-primary" id="setup">Configurer la 2FA</button><div id="setup-zone"></div>`}</div>`;
    $('#setup')?.addEventListener('click', async () => {
      const s = await api('/2fa/setup', { method: 'POST' });
      $('#setup-zone').innerHTML = `<div class="alert alert-info" style="margin-top:12px;display:block">1. Dans votre application, ajoutez un compte avec cette clé :<br><code style="font-size:1.1rem;letter-spacing:.1em;word-break:break-all">${e(s.secret)}</code><br><a class="small see-all" href="${e(s.uri)}">ou ouvrez ce lien sur votre téléphone</a></div>
        <form id="en" style="display:flex;gap:8px;margin-top:12px"><input class="input" name="code" placeholder="2. Code affiché" inputmode="numeric" maxlength="6" required><button class="btn btn-primary">Activer</button></form>`;
      $('#en').onsubmit = async (ev) => { ev.preventDefault(); await run(() => api('/2fa/enable', { method: 'POST', body: { code: ev.target.code.value } }), '2FA activée'); V.security(b); };
    });
    $('#dis')?.addEventListener('submit', async (ev) => { ev.preventDefault(); await run(() => api('/2fa/disable', { method: 'POST', body: { code: ev.target.code.value } }), '2FA désactivée'); V.security(b); });
  };

  // ---------- Exports ----------
  V.exports = async (b) => {
    const types = [['ventes', 'Ventes (lots adjugés / invendus)'], ['factures', 'Factures'], ['encheres', 'Enchères'], ['lots', 'Tous les lots'], ['utilisateurs', 'Utilisateurs'], ['journal', 'Journal d\'activité']];
    b.innerHTML = `<div class="box" style="max-width:720px"><h2>${icon('download', 'sm')} Exports CSV (compatibles Excel)</h2>
      <div class="form-grid"><div class="field"><label>Du</label><input class="input" type="date" id="from"></div><div class="field"><label>Au</label><input class="input" type="date" id="to"></div></div>
      <div style="display:grid;gap:8px">${types.map(([k, l]) => `<button class="btn btn-outline" data-x="${k}" style="justify-content:space-between">${e(l)} ${icon('download', 'sm')}</button>`).join('')}</div></div>
      <div class="box" style="max-width:720px"><h2>${icon('file', 'sm')} Rapport PDF</h2><p class="muted">Ouvre le tableau de bord en version imprimable : choisissez « Enregistrer en PDF » dans la fenêtre d'impression. Les factures s'impriment individuellement depuis « Factures ».</p><button class="btn btn-primary" id="pdf">Générer le rapport</button></div>`;
    $$('[data-x]', b).forEach(x => x.onclick = () => { const p = new URLSearchParams(); if ($('#from').value) p.set('from', $('#from').value); if ($('#to').value) p.set('to', $('#to').value + 'T23:59'); location.href = `/api/admin/export/${x.dataset.x}?${p}`; });
    $('#pdf').onclick = async () => { location.hash = 'dashboard'; setTimeout(() => print(), 1200); };
  };

  // ---------- Journal, anti-fraude, file d'envoi ----------
  V.logs = async (b) => {
    const page = Number(new URLSearchParams(location.hash.split('?')[1]).get('page')) || 1;
    const d = await api('/logs?page=' + page);
    b.innerHTML = table([{ label: 'Date', html: x => dt(x.created_at) }, { label: 'Qui', html: x => e(x.name || 'Système') }, { label: 'Action', html: x => `<code>${e(x.action)}</code>` }, { label: 'Élément', html: x => `${e(x.entity || '')} ${x.entity_id ? '#' + x.entity_id : ''}` }, { label: 'Détails', html: x => `<div class="small muted" style="max-width:460px;word-break:break-word">${e(x.details || '')}</div>` }, { label: 'IP', key: 'ip' }], d.logs)
      + `<div class="pagination">${page > 1 ? `<a class="btn btn-outline btn-sm" href="#logs?page=${page - 1}">← Plus récents</a>` : ''}${d.total > page * 100 ? `<a class="btn btn-outline btn-sm" href="#logs?page=${page + 1}">Plus anciens →</a>` : ''}</div>`;
  };
  V.fraud = async (b) => {
    const d = await api('/fraud');
    b.innerHTML = `<div class="box"><h2>${icon('users', 'sm')} Comptes multiples (même adresse IP)</h2>${table([{ label: 'IP', key: 'ip' }, { label: 'Comptes', key: 'accounts', num: 1 }, { label: 'Utilisateurs', html: x => x.users.map(u => `${e(u.name)} <span class="muted small">${e(u.phone)}</span>${u.banned ? ' <span class="st cancelled">banni</span>' : ''}`).join('<br>') }, { label: 'Dernière activité', html: x => dt(x.last) }], d.shared_ips, 'Aucune IP partagée')}</div>
      <div class="box"><h2>${icon('zap', 'sm')} Enchérisseurs très actifs (≥ 20 enchères / heure)</h2>${table([{ label: 'Compte', html: u => `${e(u.name)} <span class="muted small">${e(u.phone)}</span>` }, { label: 'Enchères', key: 'n', num: 1 }, { label: 'Vérifié', html: u => u.verified ? 'Oui' : '<span class="st suspended">Non</span>' }], d.fast_bidders, 'Rien à signaler')}</div>
      <div class="box"><h2>${icon('alert', 'sm')} Alertes</h2>${table([{ label: 'Date', html: x => dt(x.created_at) }, { label: 'Compte', key: 'name' }, { label: 'Alerte', key: 'action' }, { label: 'Détails', key: 'details' }], d.flags, 'Aucune alerte')}</div>
      <div class="box"><h2>${icon('globe', 'sm')} Journal IP</h2>${table([{ label: 'Date', html: x => dt(x.created_at) }, { label: 'Compte', key: 'name' }, { label: 'IP', key: 'ip' }, { label: 'Action', key: 'action' }, { label: 'Navigateur', html: x => `<span class="small muted">${e((x.user_agent || '').slice(0, 60))}</span>` }], d.ip_log)}</div>`;
  };
  V.outbox = async (b) => {
    const d = await api('/outbox');
    b.innerHTML = `<p class="muted">E-mails et messages WhatsApp générés par la plateforme (surenchère, gain, fin proche…). Les WhatsApp sont envoyés si l'API est configurée dans Paramètres.</p>` + table([{ label: 'Date', html: x => dt(x.created_at) }, { label: 'Canal', key: 'channel' }, { label: 'Destinataire', key: 'recipient' }, { label: 'Message', html: x => `<div class="small" style="max-width:480px">${e(x.body)}</div>` }, { label: 'Statut', html: x => `${st(x.status)} ${e(x.error || '')}` }], d.items);
  };

  // ---------- Connexion ----------
  function loginView(msg) {
    $('#admin').innerHTML = `<div class="login-box"><div class="card"><div style="display:flex;align-items:center;gap:10px;margin-bottom:16px"><span class="logo-mark">${icon('gavel')}</span><h1 style="font-size:1.3rem;margin:0">Back-office</h1></div>
      ${msg ? `<div class="alert alert-error" style="margin-bottom:14px">${e(msg)}</div>` : ''}<div id="err"></div>
      <form id="lf"><div class="field"><label>E-mail ou téléphone</label><input class="input" name="identifier" autocomplete="username" required></div>
      <div class="field"><label>Mot de passe</label><input class="input" name="password" type="password" autocomplete="current-password" required></div>
      <div class="field" id="cf" hidden><label>Code 2FA</label><input class="input" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
      <button class="btn btn-primary btn-block btn-lg">Se connecter</button></form></div></div>`;
    let need = false;
    $('#lf').onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try {
        const r = need ? await api('/api/auth/2fa', { method: 'POST', body: { code: f.code.value } }) : await api('/api/auth/login', { method: 'POST', body: { identifier: f.identifier.value, password: f.password.value } });
        if (r.need2fa) { need = true; $('#cf').hidden = false; f.code.focus(); return; }
        init();
      } catch (err) { $('#err').innerHTML = `<div class="alert alert-error" style="margin-bottom:14px">${e(err.message)}</div>`; }
    };
  }

  async function init() {
    try {
      const r = await api('/me');
      A.me = r.me; A.perms = r.perms;
    } catch (err) {
      if (err.data?.setup2fa) { A.me = { role: 'admin' }; A.perms = []; shell(); location.hash = 'security'; return go(); }
      return loginView(err.status === 403 && !err.data?.need2fa ? 'Ce compte n\'a pas accès au back-office.' : '');
    }
    shell(); go();
    if (window.io) {
      A.socket = window.io();
      A.socket.on('moderation:new', () => { toast('Nouveau lot soumis à modération'); counters.pending_lots = (counters.pending_lots || 0) + 1; });
      A.socket.on('invoice:update', () => toast('Un paiement est à vérifier'));
      A.socket.on('lot:update', (l) => { if (A.route === 'dashboard' || (A.route === 'lot' && location.hash.endsWith('/' + l.id))) { clearTimeout(A.rt); A.rt = setTimeout(go, 800); } });
    }
  }
  init();
})();
