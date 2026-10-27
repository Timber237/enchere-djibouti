// Architecture de paiement modulaire : chaque passerelle est un module { kind, initiate, verify }.
// Les passerelles sont activées / désactivées et configurées depuis l'admin (table payment_methods).
// Pour brancher une API réelle (D-Money, Waafi, CAC Pay, carte), implémentez `initiate`
// (appel au prestataire) et appelez /api/payments/webhook/:code depuis le prestataire.
const { get, all, run } = require('./db');

const fill = (tpl, cfg) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => cfg[k] ?? '');

const GATEWAYS = {
  // Mobile money : paiement marchand puis saisie de la référence SMS, vérifiée par un admin
  // (ou automatiquement via webhook si le prestataire est branché).
  mobile_money: {
    requiresReference: true,
    initiate: (inv, m, ref) => ({ status: 'pending', payment_ref: ref }),
  },
  bank_transfer: {
    requiresReference: true,
    initiate: (inv, m, ref) => ({ status: 'pending', payment_ref: ref }),
  },
  cash_on_delivery: {
    requiresReference: false,
    initiate: () => ({ status: 'pending', payment_ref: 'COD' }),
  },
  card: {
    requiresReference: false,
    initiate: (inv, m) => {
      const cfg = JSON.parse(m.config || '{}');
      if (!cfg.provider || !cfg.public_key) throw new Error('Le paiement par carte n\'est pas encore configuré.');
      // Point d'intégration du prestataire carte (redirection vers sa page sécurisée).
      return { status: 'pending', payment_ref: `CARD-${inv.number}`, redirect: cfg.checkout_url || null };
    },
  },
};

function listEnabled(lang = 'fr') {
  return all('SELECT * FROM payment_methods WHERE enabled = 1 ORDER BY sort').map(m => {
    const cfg = JSON.parse(m.config || '{}');
    return {
      code: m.code, name: m.name, kind: m.kind,
      requires_reference: !!(GATEWAYS[m.kind] || {}).requiresReference,
      instructions: fill(lang === 'ar' ? (m.instructions_ar || m.instructions_fr) : m.instructions_fr, cfg),
    };
  });
}

function pay(invoice, code, reference) {
  const m = get('SELECT * FROM payment_methods WHERE code = ? AND enabled = 1', code);
  if (!m) throw new Error('Moyen de paiement indisponible');
  const gw = GATEWAYS[m.kind];
  if (!gw) throw new Error('Passerelle inconnue');
  if (gw.requiresReference && !String(reference || '').trim()) throw new Error('Veuillez saisir la référence de transaction');
  const r = gw.initiate(invoice, m, String(reference || '').trim().slice(0, 80));
  run('UPDATE invoices SET status=?, payment_method=?, payment_ref=? WHERE id=?', r.status, code, r.payment_ref, invoice.id);
  return r;
}

module.exports = { GATEWAYS, listEnabled, pay };
