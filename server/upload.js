// Upload d'images (logos, photos de lots, partenaires). Les images sont redimensionnées
// côté navigateur avant envoi (réseau lent) ; le serveur limite le type et la taille.
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex') + EXT[file.mimetype]),
  }),
  limits: { fileSize: 6 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    // SVG autorisé uniquement pour l'identité du site (admin), jamais pour les vendeurs
    const ok = EXT[file.mimetype] && (file.mimetype !== 'image/svg+xml' || req.path.startsWith('/api/admin'));
    cb(ok ? null : new Error('Format d\'image non autorisé'), !!ok);
  },
});

const fileUrl = (f) => '/uploads/' + f.filename;

module.exports = { upload, fileUrl, UPLOAD_DIR };
