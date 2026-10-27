# Plateforme d'enchères — Djibouti

Plateforme d'enchères en ligne bilingue FR/AR, en FDJ, avec mobile money et une salle de vente en direct.
Le design s'inspire de catawiki.com pour le catalogue et de bertencheres-live.com pour le bloc live.
Il reprend leur niveau de finition, pas leur identité de marque.

## Installation

Prérequis : Node.js 22.5 ou plus récent (SQLite intégré, aucune compilation native).

```bash
npm install
npm start          # http://localhost:3000  — back-office : /admin
npm run seed       # réinitialise la base avec les données de démo
```

La base est créée automatiquement dans `data/enchere.db` au premier lancement.

### Comptes de démonstration

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Super-admin | admin@mazad.dj | Admin@2026 |
| Commissaire-priseur | cp@mazad.dj | Commissaire@2026 |
| Modérateur | modo@mazad.dj | Moderateur@2026 |
| Vendeur vérifié | vendeur@mazad.dj | Vendeur@2026 |
| Client | client1@mazad.dj | Client@2026 |

### Variables d'environnement

`PORT` (3000 par défaut), `DATA_DIR`, `COOKIE_SECURE=1` (en HTTPS), `TRUST_PROXY=1` (derrière un proxy).

## État d'avancement

### Terminé (backend, testé)
- Migrations et seed : les 12 catégories avec toutes leurs sous-catégories et des filtres propres à chacune, 7 zones de livraison, 6 passerelles de paiement, comptes de démo, 4 ventes, 36 lots.
- Moteur d'enchères : enchère classique et automatique (proxy), paliers, réserve masquée, achat immédiat, anti-sniping paramétrable, ouverture et clôture automatiques, factures, temps réel (Socket.IO).
- Authentification : téléphone +253 validé, scrypt, sessions, CSRF, rate-limiting, 2FA TOTP, rôles (super-admin, admin, modérateur, commissaire-priseur).
- Anti-fraude : limite d'enchère pour les comptes non vérifiés, journal des IP, détection des comptes multiples, annulation d'enchères.
- API admin complète : lots (modification en direct, clôture, prolongation, suspension, relance, validation), ventes, utilisateurs, factures, catégories, paiements, zones, identité (nom, logo, couleurs), textes FR/AR, bannières, partenaires, avis, avis flottants, statistiques, exports CSV, journal d'activité.
- Notifications in-app et temps réel, plus une file e-mail et WhatsApp (envoi réel via WhatsApp Cloud API si un jeton est configuré).

### Site public (`public/js/app.js`)
- Accueil : carrousel, recherche, grille des 12 catégories, bloc lot en direct, coups de cœur, se terminent bientôt, prochaines ventes, statistiques, comment ça marche, avis, partenaires, footer.
- Pages catégorie avec sous-catégories et filtres propres (marque, année, kilométrage…), recherche, tri, pagination.
- Fiche lot : galerie (swipe), compte à rebours, enchère et enchère automatique, achat immédiat, historique en direct, vendeur, zones de livraison, bouton WhatsApp.
- Salle de vente live, ventes, compte client (enchères, suivis, factures, notifications, mes lots, profil, avis), paiement de facture avec choix de zone, dépôt de lot avec photos compressées.
- Bascule FR / AR (RTL), mode sombre, choix de devise, avis flottants, bouton WhatsApp flottant.
- PWA installable (`manifest.webmanifest`, `sw.js`) et consultation hors ligne des lots déjà vus.

### Back-office (`/admin`)
22 écrans reliés à l'API : tableau de bord, lots (création et modification en direct, clôture, prolongation, suspension, relance), modération, ventes et programmation live, enchères (annulation), factures et livraisons (impression PDF), utilisateurs (vérification, bannissement, rôles, dépôt), avis, avis flottants, identité (nom, slogan, logo, favicon, couleurs), textes FR/AR, bannières, partenaires, catégories, paiements, zones, paramètres, 2FA, exports CSV, journal, anti-fraude, notifications envoyées.

### Photos de démonstration
Les 40 lots de démo utilisent 83 photos libres de droits de Wikimedia Commons, stockées dans `public/uploads/demo/` (800 px, environ 80 Ko chacune). L'auteur et la licence de chaque photo sont dans `data/demo-images.json` et s'affichent sous la description du lot, comme l'exigent les licences CC BY-SA.
- Elles ont été récupérées avec `node server/demo-images.js`, qui ne télécharge que les produits manquants.
- `npm run seed` conserve ces photos.
- En production, remplacez-les par les photos réelles des vendeurs depuis l'admin.

### Limites connues
- Les paiements D-Money, Waafi et CAC Pay fonctionnent par saisie de la référence SMS, vérifiée par un admin. La confirmation automatique demande les API des prestataires : un webhook est prévu (`POST /api/payments/webhook/:code`).
- Les e-mails sont mis en file sans être envoyés (aucun serveur SMTP configuré). WhatsApp n'est envoyé que si le jeton de l'API Cloud est renseigné dans les paramètres.
- Les notifications push s'affichent quand l'application est ouverte ou en arrière-plan. Le push serveur (VAPID) n'est pas en place.
- Le rapport PDF passe par l'impression du navigateur (« Enregistrer en PDF »).
- Le back-office est en français uniquement ; seul le site public est bilingue.
