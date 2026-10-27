// Seed : 12 catégories + sous-catégories, paramètres, zones, paiements, comptes de démo,
// ventes et lots de démonstration. `npm run seed` réinitialise complètement la base.
const fs = require('fs');
const path = require('path');
const TEXTS = require('./i18n-defaults');

const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'for_parts'];

// Filtres spécifiques par catégorie (clé d'attribut stockée dans lots.attrs)
const F = {
  brand: (opts) => ({ key: 'brand', label_fr: 'Marque', label_ar: 'العلامة', type: 'select', options: opts }),
  year: { key: 'year', label_fr: 'Année', label_ar: 'السنة', type: 'range' },
  km: { key: 'km', label_fr: 'Kilométrage', label_ar: 'المسافة المقطوعة', type: 'range' },
  fuel: { key: 'fuel', label_fr: 'Carburant', label_ar: 'الوقود', type: 'select', options: ['Essence', 'Diesel', 'Hybride', 'Électrique'] },
  gearbox: { key: 'gearbox', label_fr: 'Boîte', label_ar: 'ناقل الحركة', type: 'select', options: ['Manuelle', 'Automatique'] },
  power: { key: 'power', label_fr: 'Puissance (kVA/CV)', label_ar: 'القدرة', type: 'range' },
  capacity: { key: 'capacity', label_fr: 'Capacité', label_ar: 'السعة', type: 'select', options: ['Petite', 'Moyenne', 'Grande'] },
  material: { key: 'material', label_fr: 'Matière', label_ar: 'المادة', type: 'select', options: ['Bois', 'Métal', 'Tissu', 'Cuir', 'Verre', 'Plastique'] },
  storage: { key: 'storage', label_fr: 'Stockage', label_ar: 'التخزين', type: 'select', options: ['64 Go', '128 Go', '256 Go', '512 Go', '1 To'] },
  qty: { key: 'qty', label_fr: 'Quantité (unités)', label_ar: 'الكمية', type: 'range' },
  frame: { key: 'frame', label_fr: 'Taille', label_ar: 'المقاس', type: 'select', options: ['S', 'M', 'L', 'XL', 'Enfant'] },
  cc: { key: 'cc', label_fr: 'Cylindrée (cc)', label_ar: 'سعة المحرك', type: 'range' },
};

const CATEGORIES = [
  { slug: 'voiture', fr: 'Voiture', ar: 'سيارات', icon: 'car', filters: [F.brand(['Toyota', 'Nissan', 'Mitsubishi', 'Hyundai', 'Suzuki', 'Mercedes', 'Peugeot', 'Kia']), F.year, F.km, F.fuel, F.gearbox],
    subs: [['berline', 'Berline', 'سيدان'], ['suv-4x4', 'SUV / 4x4', 'دفع رباعي'], ['citadine', 'Citadine', 'سيارة مدينة'], ['utilitaire-leger', 'Utilitaire léger', 'مركبة تجارية خفيفة'], ['voiture-collection', 'Voiture de collection', 'سيارات كلاسيكية'], ['pieces-auto', 'Pièces détachées auto', 'قطع غيار السيارات'], ['pneus-jantes', 'Pneus & jantes', 'إطارات وجنوط']] },
  { slug: 'camion', fr: 'Camion', ar: 'شاحنات', icon: 'truck', filters: [F.brand(['Mercedes', 'Volvo', 'Isuzu', 'Hino', 'MAN', 'Renault Trucks', 'Iveco']), F.year, F.km, F.fuel],
    subs: [['benne', 'Benne', 'شاحنة قلابة'], ['plateau', 'Plateau', 'شاحنة مسطحة'], ['frigorifique', 'Frigorifique', 'شاحنة مبردة'], ['citerne', 'Citerne', 'صهريج'], ['porte-conteneur', 'Porte-conteneur', 'حاملة حاويات'], ['remorque', 'Remorque', 'مقطورة'], ['pieces-poids-lourd', 'Pièces poids lourd', 'قطع غيار الشاحنات']] },
  { slug: 'automobile', fr: 'Automobile (accessoires & équipement)', ar: 'إكسسوارات ومعدات السيارات', icon: 'wrench', filters: [F.brand(['Bosch', 'Pioneer', 'Garmin', 'Varta', 'Michelin', 'Facom'])],
    subs: [['gps', 'GPS', 'أجهزة ملاحة'], ['autoradio', 'Autoradio', 'راديو السيارة'], ['jantes', 'Jantes', 'جنوط'], ['batteries', 'Batteries', 'بطاريات'], ['outillage-auto', 'Outillage auto', 'أدوات السيارات'], ['equipement-garage', 'Équipement garage', 'معدات الورشة']] },
  { slug: 'electronique', fr: 'Appareil électronique', ar: 'أجهزة إلكترونية', icon: 'phone', filters: [F.brand(['Apple', 'Samsung', 'Huawei', 'Xiaomi', 'HP', 'Dell', 'Lenovo', 'Sony', 'LG', 'DJI', 'Canon']), F.storage],
    subs: [['smartphone', 'Smartphone', 'هواتف ذكية'], ['ordinateur-portable', 'Ordinateur portable', 'حواسيب محمولة'], ['pc-fixe', 'PC fixe', 'حواسيب مكتبية'], ['tablette', 'Tablette', 'أجهزة لوحية'], ['tv', 'TV', 'تلفزيونات'], ['console', 'Console de jeu', 'أجهزة ألعاب'], ['audio-casque', 'Audio / casque', 'صوتيات / سماعات'], ['appareil-photo', 'Appareil photo', 'كاميرات'], ['drone', 'Drone', 'طائرات مسيرة'], ['accessoires-electronique', 'Accessoires', 'ملحقات']] },
  { slug: 'produit-manufacture', fr: 'Produit manufacturé', ar: 'منتجات مصنعة', icon: 'box', filters: [F.qty, F.material],
    subs: [['textile', 'Textile', 'منسوجات'], ['chaussures', 'Chaussures', 'أحذية'], ['maroquinerie', 'Maroquinerie', 'منتجات جلدية'], ['articles-maison', 'Articles de maison', 'أدوات منزلية'], ['quincaillerie', 'Quincaillerie', 'خردوات'], ['lots-gros-destockage', 'Lots de gros / déstockage', 'بيع بالجملة / تصفية']] },
  { slug: 'electromenager', fr: 'Appareil électroménager', ar: 'أجهزة منزلية كهربائية', icon: 'fridge', filters: [F.brand(['Samsung', 'LG', 'Whirlpool', 'Beko', 'Haier', 'Midea', 'Hisense']), F.capacity],
    subs: [['refrigerateur', 'Réfrigérateur', 'ثلاجات'], ['congelateur', 'Congélateur', 'مجمدات'], ['climatiseur', 'Climatiseur', 'مكيفات'], ['machine-a-laver', 'Machine à laver', 'غسالات'], ['cuisiniere', 'Cuisinière', 'مواقد طبخ'], ['micro-ondes', 'Micro-ondes', 'أفران ميكروويف'], ['petit-electromenager', 'Petit électroménager', 'أجهزة صغيرة']] },
  { slug: 'machine-industrielle', fr: 'Machine industrielle', ar: 'آلات صناعية', icon: 'factory', filters: [F.brand(['Caterpillar', 'Komatsu', 'Atlas Copco', 'SDMO', 'John Deere', 'JCB', 'Perkins']), F.year, F.power],
    subs: [['groupe-electrogene', 'Groupe électrogène', 'مولدات كهربائية'], ['compresseur', 'Compresseur', 'ضواغط'], ['machine-btp', 'Machine BTP', 'آلات البناء'], ['machine-agricole', 'Machine agricole', 'آلات زراعية'], ['froid-industriel', 'Équipement de froid industriel', 'معدات التبريد الصناعي'], ['machine-textile', 'Machine textile', 'آلات النسيج'], ['outillage-pro', 'Outillage pro', 'أدوات احترافية']] },
  { slug: 'meuble-bureau', fr: 'Meuble de bureau', ar: 'أثاث مكتبي', icon: 'desk', filters: [F.material, F.qty],
    subs: [['bureau', 'Bureau', 'مكاتب'], ['fauteuil', 'Fauteuil', 'كراسي مكتب'], ['armoire', 'Armoire', 'خزائن'], ['caisson', 'Caisson', 'أدراج'], ['mobilier-accueil', 'Mobilier accueil', 'أثاث الاستقبال'], ['mobilier-reunion', 'Mobilier de réunion', 'أثاث الاجتماعات'], ['informatique-bureau', 'Équipement informatique de bureau', 'معدات مكتبية إلكترونية']] },
  { slug: 'moto', fr: 'Moto', ar: 'دراجات نارية', icon: 'moto', filters: [F.brand(['Yamaha', 'Honda', 'Suzuki', 'Kawasaki', 'TVS', 'Bajaj', 'Piaggio']), F.year, F.km, F.cc],
    subs: [['scooter', 'Scooter', 'سكوتر'], ['moto-route', 'Moto route', 'دراجة طريق'], ['moto-cross', 'Moto cross / tout-terrain', 'دراجة طرق وعرة'], ['tricycle-tuk-tuk', 'Tricycle / tuk-tuk', 'دراجة ثلاثية / توك توك'], ['pieces-moto', 'Pièces & accessoires moto', 'قطع وإكسسوارات'], ['casques', 'Casques', 'خوذ']] },
  { slug: 'velo', fr: 'Vélo', ar: 'دراجات هوائية', icon: 'bike', filters: [F.brand(['Btwin', 'Giant', 'Trek', 'Specialized', 'Scott']), F.frame],
    subs: [['vtt', 'VTT', 'دراجة جبلية'], ['velo-ville', 'Vélo de ville', 'دراجة مدينة'], ['velo-electrique', 'Vélo électrique', 'دراجة كهربائية'], ['velo-enfant', 'Vélo enfant', 'دراجة أطفال'], ['pieces-velo', 'Pièces & accessoires', 'قطع وإكسسوارات']] },
  { slug: 'nourriture', fr: 'Nourriture', ar: 'مواد غذائية', icon: 'food', requires_expiry: 1, filters: [F.qty],
    subs: [['denrees-non-perissables', 'Denrées non périssables', 'مواد غير قابلة للتلف'], ['produits-gros', 'Produits en gros', 'منتجات بالجملة'], ['epicerie', 'Épicerie', 'بقالة'], ['boissons', 'Boissons', 'مشروبات'], ['dattes-terroir', 'Dattes & produits du terroir', 'تمور ومنتجات محلية'], ['lots-alimentaires-pro', 'Lots alimentaires professionnels', 'دفعات غذائية للمحترفين']] },
  { slug: 'meuble-salon', fr: 'Meuble salon', ar: 'أثاث الصالون', icon: 'sofa', filters: [F.material],
    subs: [['canape', 'Canapé', 'كنب'], ['salon-complet', 'Salon complet', 'صالون كامل'], ['table-basse', 'Table basse', 'طاولة قهوة'], ['meuble-tv', 'Meuble TV', 'طاولة تلفزيون'], ['decoration', 'Décoration', 'ديكور'], ['tapis', 'Tapis', 'سجاد'], ['luminaire', 'Luminaire', 'إنارة'], ['salon-traditionnel', 'Salon traditionnel', 'مجلس تقليدي']] },
];

// Photo d'illustration de chaque catégorie (modifiable dans l'admin > Catégories)
const CATEGORY_IMAGES = {
  voiture: '/uploads/demo/lot-04-1.jpg', camion: '/uploads/demo/lot-08-2.jpg', automobile: '/uploads/demo/lot-05-2.jpg',
  electronique: '/uploads/demo/lot-11-3.jpg', 'produit-manufacture': '/uploads/demo/lot-17-1.jpg', electromenager: '/uploads/demo/lot-20-2.jpg',
  'machine-industrielle': '/uploads/demo/lot-22-1.jpg', 'meuble-bureau': '/uploads/demo/lot-25-1.jpg', moto: '/uploads/demo/lot-28-1.jpg',
  velo: '/uploads/demo/lot-30-2.jpg', nourriture: '/uploads/demo/lot-31-3.jpg', 'meuble-salon': '/uploads/demo/lot-35-3.jpg',
};

const SETTINGS = {
  site_name: 'Mazad Djibouti',
  slogan_fr: 'Les enchères en ligne, en direct, à Djibouti',
  slogan_ar: 'مزادات إلكترونية مباشرة في جيبوتي',
  logo: '',
  favicon: '',
  color_primary: '#1438c8',
  color_accent: '#f26a1b',
  color_dark: '#0d1430',
  default_lang: 'fr',
  currency: 'DJF',
  currencies_enabled: 'DJF,USD,EUR',
  rate_USD: '0.005625',
  rate_EUR: '0.0052',
  anti_snipe_window: '60',
  anti_snipe_extend: '60',
  default_increment: '0',
  buyer_fee_pct: '5',
  seller_commission_pct: '10',
  unverified_bid_limit: '500000',
  max_accounts_per_ip: '3',
  bid_rate_limit: '8',
  payment_deadline_hours: '72',
  whatsapp_number: '25377000000',
  support_email: 'contact@mazad.dj',
  support_phone: '+253 21 00 00 00',
  address: 'Boulevard de la République, Djibouti-ville',
  deposit_enabled: '0',
  deposit_amount: '20000',
  admin_2fa_required: '0',
  toasts_enabled: '1',
  toast_duration: '6',
  toast_interval: '14',
  toast_position: 'bottom-left',
  toast_source: 'both',
  whatsapp_api_token: '',
  whatsapp_phone_id: '',
  social_facebook: 'https://facebook.com',
  social_instagram: 'https://instagram.com',
  social_tiktok: '',
};

const ZONES = [
  ['Retrait sur place (dépôt Djibouti-ville)', 'الاستلام من المستودع (مدينة جيبوتي)', 0, 'Immédiat', 1],
  ['Djibouti-ville', 'مدينة جيبوتي', 1500, '24 h', 0],
  ['Arta', 'عرتا', 4000, '48 h', 0],
  ['Ali Sabieh', 'علي صبيح', 6000, '48–72 h', 0],
  ['Dikhil', 'دخيل', 7000, '48–72 h', 0],
  ['Tadjourah', 'تاجورة', 9000, '3–5 jours', 0],
  ['Obock', 'أبخ', 11000, '3–5 jours', 0],
];

const PAYMENTS = [
  ['dmoney', 'D-Money', 'mobile_money', 1, 'Envoyez le montant au marchand {merchant} depuis votre application D-Money, puis saisissez la référence reçue par SMS.', 'أرسل المبلغ إلى التاجر {merchant} من تطبيق دي-موني ثم أدخل المرجع المستلم.', { merchant: '77 00 00 01' }],
  ['waafi', 'Waafi', 'mobile_money', 1, 'Payez via Waafi au numéro marchand {merchant}, puis saisissez la référence de transaction.', 'ادفع عبر وافي إلى رقم التاجر {merchant} ثم أدخل مرجع المعاملة.', { merchant: '77 00 00 02' }],
  ['cacpay', 'CAC Pay', 'mobile_money', 1, 'Payez via CAC Pay au marchand {merchant}, puis saisissez la référence de transaction.', 'ادفع عبر كاك باي إلى التاجر {merchant} ثم أدخل المرجع.', { merchant: '77 00 00 03' }],
  ['bank', 'Virement bancaire', 'bank_transfer', 1, 'Virement sur le compte {bank} — IBAN {iban}. Indiquez le numéro de facture en libellé.', 'تحويل إلى حساب {bank} — رقم الحساب {iban}. اذكر رقم الفاتورة.', { bank: 'Banque de démonstration', iban: 'DJ00 0000 0000 0000 0000' }],
  ['cod', 'Paiement à la livraison', 'cash_on_delivery', 1, 'Vous payez en espèces au livreur ou au retrait. Aucune référence requise.', 'تدفع نقداً للمندوب أو عند الاستلام. لا حاجة لمرجع.', {}],
  ['card', 'Carte bancaire', 'card', 0, 'Paiement par carte via le prestataire configuré.', 'الدفع بالبطاقة عبر مزود الخدمة.', { provider: '', public_key: '' }],
];

const SAMPLE_LOTS = [
  ['voiture', 'suv-4x4', 'Toyota Land Cruiser Prado 2018 — 4x4 diesel', 'تويوتا لاند كروزر برادو 2018 — ديزل دفع رباعي', 3800000, 4500000, { brand: 'Toyota', year: 2018, km: 96000, fuel: 'Diesel', gearbox: 'Automatique' }],
  ['voiture', 'utilitaire-leger', 'Toyota Hilux double cabine 2016', 'تويوتا هايلكس كابينة مزدوجة 2016', 2600000, 3000000, { brand: 'Toyota', year: 2016, km: 148000, fuel: 'Diesel', gearbox: 'Manuelle' }],
  ['voiture', 'berline', 'Hyundai Elantra 2019 — essence, climatisation', 'هيونداي إلنترا 2019 — بنزين، مكيف', 1500000, 0, { brand: 'Hyundai', year: 2019, km: 72000, fuel: 'Essence', gearbox: 'Automatique' }],
  ['voiture', 'citadine', 'Suzuki Swift 2020 — faible kilométrage', 'سوزوكي سويفت 2020 — مسافة قليلة', 1100000, 1300000, { brand: 'Suzuki', year: 2020, km: 31000, fuel: 'Essence', gearbox: 'Manuelle' }],
  ['voiture', 'pneus-jantes', 'Lot de 4 pneus Michelin 265/65 R17 neufs', '4 إطارات ميشلان جديدة 265/65 R17', 90000, 0, { brand: 'Toyota' }],
  ['camion', 'benne', 'Camion benne Mercedes Actros 2014 — 20 m³', 'شاحنة قلابة مرسيدس أكتروس 2014', 9500000, 11000000, { brand: 'Mercedes', year: 2014, km: 410000, fuel: 'Diesel' }],
  ['camion', 'frigorifique', 'Isuzu NPR frigorifique 2017 — groupe froid Thermo King', 'إيسوزو NPR مبردة 2017', 4200000, 0, { brand: 'Isuzu', year: 2017, km: 205000, fuel: 'Diesel' }],
  ['camion', 'porte-conteneur', 'Tracteur Volvo FH12 + semi porte-conteneur 40 pieds', 'رأس قاطرة فولفو FH12 مع مقطورة حاويات', 12000000, 14000000, { brand: 'Volvo', year: 2012, km: 690000, fuel: 'Diesel' }],
  ['automobile', 'equipement-garage', 'Pont élévateur 2 colonnes 4 tonnes', 'رافعة سيارات بعمودين 4 أطنان', 450000, 0, { brand: 'Bosch' }],
  ['automobile', 'batteries', 'Lot de 10 batteries Varta 12V 100Ah', '10 بطاريات فارتا 12 فولت', 180000, 0, { brand: 'Varta' }],
  ['electronique', 'smartphone', 'iPhone 15 Pro 256 Go — titane naturel, sous garantie', 'آيفون 15 برو 256 جيجا — تيتانيوم طبيعي', 120000, 160000, { brand: 'Apple', storage: '256 Go' }],
  ['electronique', 'ordinateur-portable', 'Dell Precision 7520 — i7, 16 Go, SSD 512 Go', 'ديل بريسيجن 7520 — i7، 16 جيجا', 45000, 0, { brand: 'Dell', storage: '512 Go' }],
  ['electronique', 'tv', 'TV Samsung QLED 65" 4K', 'تلفزيون سامسونج QLED 65 بوصة 4K', 110000, 0, { brand: 'Samsung' }],
  ['electronique', 'drone', 'Drone DJI Mini 4 Pro Fly More Combo', 'طائرة DJI ميني 4 برو', 95000, 0, { brand: 'DJI' }],
  ['electronique', 'console', 'PlayStation 5 + 2 manettes + 3 jeux', 'بلايستيشن 5 مع يدتين و3 ألعاب', 70000, 85000, { brand: 'Sony' }],
  ['produit-manufacture', 'lots-gros-destockage', 'Déstockage : 500 paires de sandales', 'تصفية: 500 زوج صنادل', 250000, 0, { qty: 500, material: 'Plastique' }],
  ['produit-manufacture', 'textile', 'Lot de 300 chemises coton (tailles assorties)', '300 قميص قطني بمقاسات متنوعة', 180000, 0, { qty: 300, material: 'Tissu' }],
  ['electromenager', 'climatiseur', 'Climatiseur split LG 24 000 BTU inverter', 'مكيف سبليت إل جي 24000 وحدة', 85000, 0, { brand: 'LG', capacity: 'Grande' }],
  ['electromenager', 'refrigerateur', 'Réfrigérateur américain Samsung 600 L', 'ثلاجة سامسونج 600 لتر بابين', 130000, 160000, { brand: 'Samsung', capacity: 'Grande' }],
  ['electromenager', 'machine-a-laver', 'Lave-linge Beko 9 kg', 'غسالة بيكو 9 كغ', 55000, 0, { brand: 'Beko', capacity: 'Moyenne' }],
  ['machine-industrielle', 'groupe-electrogene', 'Groupe électrogène SDMO 100 kVA insonorisé', 'مولد SDMO بقدرة 100 كيلو فولت أمبير', 2400000, 2800000, { brand: 'SDMO', year: 2019, power: 100 }],
  ['machine-industrielle', 'machine-btp', 'Pelle hydraulique Caterpillar 320D', 'حفارة كاتربيلر 320D', 15000000, 18000000, { brand: 'Caterpillar', year: 2011, power: 150 }],
  ['machine-industrielle', 'compresseur', 'Compresseur Atlas Copco XAS 97 mobile', 'ضاغط أطلس كوبكو متنقل', 1800000, 0, { brand: 'Atlas Copco', year: 2015, power: 50 }],
  ['meuble-bureau', 'bureau', 'Lot de 12 bureaux open space avec caissons', '12 مكتباً مع أدراج', 240000, 0, { material: 'Bois', qty: 12 }],
  ['meuble-bureau', 'fauteuil', '20 fauteuils ergonomiques en maille', '20 كرسياً مريحاً', 160000, 0, { material: 'Tissu', qty: 20 }],
  ['moto', 'tricycle-tuk-tuk', 'Tuk-tuk Bajaj RE 2021 — très bon état', 'توك توك باجاج 2021 — حالة ممتازة', 420000, 0, { brand: 'Bajaj', year: 2021, km: 18000, cc: 200 }],
  ['moto', 'moto-cross', 'Yamaha YZ250F 2019 — moto cross', 'ياماها YZ250F 2019', 520000, 600000, { brand: 'Yamaha', year: 2019, km: 9000, cc: 250 }],
  ['moto', 'scooter', 'Scooter Honda PCX 125', 'سكوتر هوندا PCX 125', 260000, 0, { brand: 'Honda', year: 2022, km: 6000, cc: 125 }],
  ['velo', 'velo-electrique', 'Vélo électrique urbain 250 W — autonomie 60 km', 'دراجة كهربائية 250 واط', 75000, 0, { brand: 'Btwin', frame: 'M' }],
  ['velo', 'vtt', 'VTT Giant Talon 29" — taille L', 'دراجة جبلية جاينت 29 بوصة', 60000, 0, { brand: 'Giant', frame: 'L' }],
  ['nourriture', 'dattes-terroir', 'Lot de 200 kg de dattes Medjool', '200 كغ من تمور المجهول', 160000, 0, { qty: 200 }],
  ['nourriture', 'denrees-non-perissables', 'Palette de 100 sacs de riz basmati 25 kg', '100 كيس أرز بسمتي 25 كغ', 900000, 1000000, { qty: 100 }],
  ['nourriture', 'boissons', 'Lot de 120 packs d\'eau minérale 6×1,5 L', '120 علبة مياه معدنية', 70000, 0, { qty: 120 }],
  ['meuble-salon', 'salon-traditionnel', 'Salon traditionnel 8 places brodé main', 'مجلس تقليدي 8 مقاعد مطرز يدوياً', 280000, 330000, { material: 'Tissu' }],
  ['meuble-salon', 'canape', 'Canapé d\'angle en cuir 6 places', 'كنبة زاوية جلدية 6 مقاعد', 190000, 0, { material: 'Cuir' }],
  ['meuble-salon', 'tapis', 'Tapis persan fait main 3×2 m', 'سجادة فارسية يدوية 3×2 م', 120000, 150000, { material: 'Tissu' }],
];

const DESC_FR = (t) => `<p>${t}. Lot contrôlé par notre équipe, photos non contractuelles. Visite possible sur rendez-vous à Djibouti-ville avant la clôture.</p><ul><li>Documents disponibles</li><li>Vendu en l'état</li><li>Retrait ou livraison selon la zone choisie</li></ul>`;
const DESC_AR = (t) => `<p>${t}. تم فحص القطعة من قبل فريقنا، الصور غير تعاقدية. يمكن المعاينة بموعد مسبق في مدينة جيبوتي قبل الإغلاق.</p><ul><li>الوثائق متوفرة</li><li>تباع بحالتها</li><li>الاستلام أو التوصيل حسب المنطقة</li></ul>`;

function seed(dbm, { reset = false } = {}) {
  const { db, run, get, all } = dbm;
  if (reset) {
    db.exec('PRAGMA foreign_keys = OFF');
    for (const t of ['bids', 'proxy_bids', 'watches', 'invoices', 'notifications', 'lots', 'sales', 'categories', 'reviews', 'toast_messages', 'partners', 'banners', 'texts', 'settings', 'zones', 'payment_methods', 'activity_log', 'ip_log', 'sessions', 'outbox', 'users']) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM sqlite_sequence");
    db.exec('PRAGMA foreign_keys = ON');
  }
  if (get('SELECT COUNT(*) c FROM users').c > 0) return false;

  const { hashPassword } = require('./auth');
  // Photos réelles téléchargées par `node server/demo-images.js` (repli : visuel généré)
  const mapFile = path.join(__dirname, '..', 'data', 'demo-images.json');
  const photoMap = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : {};
  const photos = (title, fallback) => {
    const imgs = (photoMap[title]?.images || []).filter(src => fs.existsSync(path.join(__dirname, '..', 'public', src)));
    return imgs.length ? imgs : fallback;
  };
  // Mention obligatoire des auteurs / licences des photos Wikimedia Commons
  const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const credit = (title) => {
    const c = (photoMap[title]?.credits || []).filter(x => fs.existsSync(path.join(__dirname, '..', 'public', 'uploads', 'demo', x.file)));
    if (!c.length) return '';
    return `<p class="small muted">Photos : ${c.map(x => `<a href="${esc(x.source)}" target="_blank" rel="noopener">${esc(x.author || 'auteur inconnu')}</a> (${esc(x.license || 'licence libre')})`).join(', ')} — Wikimedia Commons.</p>`;
  };
  const now = Date.now();
  const H = 3600e3, D = 24 * H, M = 60e3;

  db.exec('BEGIN');
  try {
    for (const [k, v] of Object.entries(SETTINGS)) run('INSERT INTO settings (key, value) VALUES (?, ?)', k, v);
    for (const [k, [fr, ar]] of Object.entries(TEXTS)) run('INSERT INTO texts (key, fr, ar, long) VALUES (?,?,?,?)', k, fr, ar, k.startsWith('page.') && k.endsWith('.body') ? 1 : 0);

    // Catégories + sous-catégories
    const catIds = {};
    CATEGORIES.forEach((c, i) => {
      const img = CATEGORY_IMAGES[c.slug] && fs.existsSync(path.join(__dirname, '..', 'public', CATEGORY_IMAGES[c.slug])) ? CATEGORY_IMAGES[c.slug] : null;
      const r = run('INSERT INTO categories (parent_id, slug, name_fr, name_ar, icon, filters, requires_expiry, sort, image) VALUES (NULL,?,?,?,?,?,?,?,?)', c.slug, c.fr, c.ar, c.icon, JSON.stringify(c.filters), c.requires_expiry || 0, i + 1, img);
      catIds[c.slug] = Number(r.lastInsertRowid);
      c.subs.forEach(([slug, fr, ar], j) => {
        const s = run('INSERT INTO categories (parent_id, slug, name_fr, name_ar, icon, requires_expiry, sort) VALUES (?,?,?,?,?,?,?)', catIds[c.slug], slug, fr, ar, c.icon, c.requires_expiry || 0, j + 1);
        catIds[slug] = Number(s.lastInsertRowid);
      });
    });

    ZONES.forEach(([fr, ar, fee, delay, pickup], i) => run('INSERT INTO zones (name_fr, name_ar, fee, delay_fr, is_pickup, sort) VALUES (?,?,?,?,?,?)', fr, ar, fee, delay, pickup, i));
    PAYMENTS.forEach(([code, name, kind, en, ifr, iar, cfg], i) => run('INSERT INTO payment_methods (code, name, kind, enabled, instructions_fr, instructions_ar, config, sort) VALUES (?,?,?,?,?,?,?,?)', code, name, kind, en, ifr, iar, JSON.stringify(cfg), i));

    // Comptes de démonstration
    const mkUser = (name, pseudo, email, phone, pass, role, extra = {}) => Number(run(
      'INSERT INTO users (name, pseudo, email, phone, password_hash, role, is_seller, verified, seller_verified, city, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      name, pseudo, email, phone, hashPassword(pass), role, extra.seller ? 1 : 0, extra.verified ? 1 : 0, extra.sv ? 1 : 0, extra.city || 'Djibouti-ville', now - Math.floor(Math.random() * 90) * D).lastInsertRowid);
    const admin = mkUser('Administrateur', 'Admin', 'admin@mazad.dj', '+25377000000', 'Admin@2026', 'superadmin', { verified: 1 });
    mkUser('Commissaire-priseur', 'Commissaire', 'cp@mazad.dj', '+25377000009', 'Commissaire@2026', 'auctioneer', { verified: 1 });
    mkUser('Modérateur', 'Modo', 'modo@mazad.dj', '+25377000008', 'Moderateur@2026', 'moderator', { verified: 1 });
    const seller = mkUser('Djibouti Auto Import', 'DjibAuto', 'vendeur@mazad.dj', '+25377111111', 'Vendeur@2026', 'user', { seller: 1, verified: 1, sv: 1 });
    const seller2 = mkUser('Port Équipements SARL', 'PortEquip', 'port@mazad.dj', '+25377222222', 'Vendeur@2026', 'user', { seller: 1, verified: 1, sv: 1 });
    const buyers = [
      ['Hassan Ahmed', 'Hassan', 'Djibouti-ville'], ['Fatouma Ali', 'Fatouma', 'Ali Sabieh'], ['Ibrahim Moussa', 'Ibrahim', 'Tadjourah'],
      ['Amina Omar', 'Amina', 'Djibouti-ville'], ['Youssouf Daher', 'Youssouf', 'Dikhil'], ['Kadra Hassan', 'Kadra', 'Arta'],
    ].map(([n, p, city], i) => mkUser(n, p, `client${i + 1}@mazad.dj`, `+2537733330${i}`, 'Client@2026', 'user', { verified: i < 4, city }));

    // Ventes
    const mkSale = (fr, ar, start, end, live, cover) => Number(run('INSERT INTO sales (title_fr, title_ar, description_fr, description_ar, cover, is_live, starts_at, ends_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      fr, ar, 'Vente organisée et contrôlée par nos commissaires-priseurs.', 'مزاد منظم ومراقب من قبل خبرائنا.', cover, live ? 1 : 0, start, end, start <= now ? 'live' : 'upcoming', now).lastInsertRowid);
    const saleLive = mkSale('Grande vente live — Véhicules & engins', 'المزاد المباشر الكبير — مركبات وآليات', now - 10 * M, now + 3 * H, 1, photos('Camion benne Mercedes Actros 2014 — 20 m³', ['/ph/camion.svg'])[0]);
    const saleHigh = mkSale('High-tech & électroménager — prix de départ bas', 'تقنية وأجهزة منزلية — أسعار افتتاح منخفضة', now - D, now + 2 * D, 0, photos('PlayStation 5 + 2 manettes + 3 jeux', ['/ph/electronique.svg'])[0]);
    const saleHome = mkSale('Maison, bureau & déstockage', 'المنزل والمكتب والتصفية', now - 2 * D, now + 4 * D, 0, photos("Canapé d'angle en cuir 6 places", ['/ph/meuble-salon.svg'])[0]);
    const saleNext = mkSale('Vente du port : machines & groupes électrogènes', 'مزاد الميناء: آلات ومولدات', now + D, now + 6 * D, 0, photos('Pelle hydraulique Caterpillar 320D', ['/ph/machine-industrielle.svg'])[0]);

    const saleFor = (cat) => ['voiture', 'camion', 'moto'].includes(cat) ? saleLive
      : ['electronique', 'electromenager', 'automobile', 'velo'].includes(cat) ? saleHigh
        : cat === 'machine-industrielle' ? saleNext : saleHome;

    let liveIdx = 0, n = 0;
    const lotIds = [];
    for (const [cat, sub, tfr, tar, price, reserve, attrs] of SAMPLE_LOTS) {
      n++;
      const sale = saleFor(cat);
      let starts, ends;
      if (sale === saleLive) { starts = now - 10 * M; ends = now + (4 + liveIdx * 3) * M; liveIdx++; }
      else if (sale === saleNext) { starts = now + D; ends = now + (5 + (n % 3)) * D; }
      else { starts = now - (n % 3 + 1) * D; ends = now + ((n * 7) % 60 + 2) * H + (n % 5) * 11 * M; }
      const status = starts <= now ? 'live' : 'upcoming';
      const imgs = photos(tfr, [1, 2, 3].map(k => `/ph/${cat}.svg?v=${n}-${k}`));
      const expiry = cat === 'nourriture' ? new Date(now + (120 + n * 3) * D).toISOString().slice(0, 10) : null;
      const r = run(`INSERT INTO lots (lot_number, sale_id, category_id, subcategory_id, seller_id, title_fr, title_ar, description_fr, description_ar, condition, location, images, attrs, expiry_date,
        start_price, reserve_price, increment, buy_now_price, current_price, starts_at, ends_at, status, featured, favorite, views, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        100 + n, sale, catIds[cat], catIds[sub], n % 2 ? seller : seller2, tfr, tar, DESC_FR(tfr) + credit(tfr), DESC_AR(tar) + credit(tfr), CONDITIONS[n % 4], ZONES[1 + (n % 6)][0],
        JSON.stringify(imgs), JSON.stringify(attrs), expiry, price, reserve, 0, n % 5 === 0 ? Math.round(price * 1.9) : 0, price, starts, ends, status,
        n % 4 === 0 ? 1 : 0, n % 3 === 0 ? 1 : 0, 20 + (n * 37) % 400, now - 3 * D, now);
      lotIds.push({ id: Number(r.lastInsertRowid), price, status, ends });
    }

    // Quelques enchères de démonstration
    const { incrementFor } = require('./engine');
    for (const l of lotIds) {
      if (l.status !== 'live' || Math.random() < 0.25) continue;
      let p = l.price; const count = 1 + Math.floor(Math.random() * 6);
      let leader = null, t = now - 5 * H;
      for (let i = 0; i < count; i++) {
        const u = buyers[(l.id + i) % buyers.length];
        if (i > 0) p += incrementFor(p, 0);
        t += Math.floor(Math.random() * 40) * M;
        run('INSERT INTO bids (lot_id, user_id, amount, is_auto, ip, created_at) VALUES (?,?,?,?,?,?)', l.id, u, p, 0, '196.201.0.' + (u % 50), Math.min(t, now - M));
        leader = u;
      }
      run('UPDATE lots SET current_price=?, bids_count=?, leader_id=? WHERE id=?', p, count, leader, l.id);
    }

    // Lots déjà vendus (alimentent les avis flottants "X a remporté…")
    const soldTitles = [['Toyota Hilux 2015', 'تويوتا هايلكس 2015', 'voiture', 'utilitaire-leger', 2900000], ['Groupe électrogène 60 kVA', 'مولد 60 كيلو فولت أمبير', 'machine-industrielle', 'groupe-electrogene', 1450000], ['MacBook Pro 14"', 'ماك بوك برو 14', 'electronique', 'ordinateur-portable', 210000], ['Climatiseur Midea 18 000 BTU', 'مكيف ميديا', 'electromenager', 'climatiseur', 62000]];
    soldTitles.forEach(([fr, ar, cat, sub, price], i) => {
      const w = buyers[i];
      const end = now - (i * 47 + 5) * M;
      const r = run(`INSERT INTO lots (lot_number, sale_id, category_id, subcategory_id, seller_id, title_fr, title_ar, description_fr, description_ar, condition, location, images, attrs, start_price, current_price, bids_count, leader_id, winner_id, final_price, starts_at, ends_at, status, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, 90 + i, saleHome, catIds[cat], catIds[sub], seller, fr, ar, DESC_FR(fr) + credit(fr), DESC_AR(ar) + credit(fr), 'good', 'Djibouti-ville', JSON.stringify(photos(fr, [`/ph/${cat}.svg?v=s${i}`])), '{}',
        Math.round(price * 0.7), price, 9 + i, w, w, price, end - 3 * D, end, 'sold', end - 4 * D, end);
      const lotId = Number(r.lastInsertRowid);
      const fee = Math.round(price * 0.05);
      run('INSERT INTO invoices (number, lot_id, user_id, amount, buyer_fee, delivery_fee, total, status, payment_method, delivery_status, created_at, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        `F${new Date(end).getFullYear()}-${String(i + 1).padStart(5, '0')}`, lotId, w, price, fee, 0, price + fee, i < 2 ? 'paid' : 'unpaid', i < 2 ? 'dmoney' : null, i < 2 ? 'delivered' : 'waiting', end, i < 2 ? end + H : null);
    });

    // Avis
    const reviews = [
      ['Hassan', 5, 'Voiture conforme à la description, paiement D-Money très simple. Je recommande !'],
      ['Fatouma', 5, 'Livraison rapide jusqu\'à Ali Sabieh, équipe sérieuse et à l\'écoute.'],
      ['Ibrahim', 4, 'Bonne expérience, j\'ai eu mon groupe électrogène à un très bon prix.'],
      ['Amina', 5, 'La salle live est géniale, on suit tout en temps réel sur le téléphone.'],
      ['Youssouf', 4, 'Support WhatsApp réactif. Je reviendrai pour la prochaine vente.'],
      ['Kadra', 3, 'Bien dans l\'ensemble, j\'aimerais plus de lots à Arta.'],
    ];
    reviews.forEach(([name, rating, comment], i) => run('INSERT INTO reviews (user_id, seller_id, author_name, rating, comment, status, featured, created_at) VALUES (?,?,?,?,?,?,?,?)',
      buyers[i], i % 2 ? seller : null, name, rating, comment, i < 5 ? 'approved' : 'pending', i < 3 ? 1 : 0, now - (i + 1) * D));

    [['🔥 Nouvelle vente live ce soir à 20 h : véhicules & engins', '🔥 مزاد مباشر جديد الليلة الساعة 20:00: مركبات وآليات'],
     ['🚚 Livraison offerte à Djibouti-ville cette semaine sur les lots électroménager', '🚚 توصيل مجاني في مدينة جيبوتي هذا الأسبوع على الأجهزة المنزلية']]
      .forEach(([fr, ar]) => run('INSERT INTO toast_messages (text_fr, text_ar) VALUES (?,?)', fr, ar));

    ['Port de Djibouti', 'Banque Partenaire', 'D-Money', 'Waafi', 'Chambre de Commerce', 'Transit Express', 'Assurances Mer Rouge']
      .forEach((name, i) => run('INSERT INTO partners (name, logo, url, sort) VALUES (?,?,?,?)', name, `/ph/partner.svg?n=${encodeURIComponent(name)}`, '#', i));

    run('INSERT INTO banners (kind, title_fr, title_ar, subtitle_fr, subtitle_ar, image, link, sort) VALUES (?,?,?,?,?,?,?,?)', 'hero',
      'Grande vente live : véhicules & engins', 'المزاد المباشر الكبير: مركبات وآليات', 'Prado, Hilux, Actros, Caterpillar… les lots défilent en direct.', 'برادو، هايلكس، أكتروس، كاتربيلر… القطع تُعرض مباشرة.', photos('Toyota Land Cruiser Prado 2018 — 4x4 diesel', ['/ph/voiture.svg?v=hero'])[0], '/live', 0);
    run('INSERT INTO banners (kind, title_fr, title_ar, subtitle_fr, subtitle_ar, image, link, sort) VALUES (?,?,?,?,?,?,?,?)', 'hero',
      'High-tech à prix cassés', 'تقنية بأسعار مخفضة', 'Smartphones, ordinateurs, drones — mises à prix dès 45 000 FDJ.', 'هواتف، حواسيب، طائرات مسيرة — أسعار افتتاح من 45000 فرنك.', photos('iPhone 15 Pro 256 Go — titane naturel, sous garantie', ['/ph/electronique.svg?v=hero'])[0], '/c/electronique', 1);
    run('INSERT INTO banners (kind, title_fr, title_ar, subtitle_fr, subtitle_ar, image, link, sort) VALUES (?,?,?,?,?,?,?,?)', 'promo',
      'Déposez vos lots gratuitement', 'أضف قطعك مجاناً', 'Commission uniquement en cas de vente.', 'العمولة فقط عند البيع.', '', '/vendre', 0);

    run('INSERT INTO activity_log (user_id, action, entity, details, created_at) VALUES (?,?,?,?,?)', admin, 'seed', 'system', 'Base initialisée avec les données de démonstration', now);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return true;
}

module.exports = { seed, CATEGORIES };

if (require.main === module) {
  const dbm = require('./db');
  dbm.migrate();
  const reset = process.argv.includes('--reset');
  const done = seed(dbm, { reset });
  console.log(done ? 'Seed terminé. Admin : admin@mazad.dj / Admin@2026' : 'Base déjà initialisée (utilisez --reset pour réinitialiser).');
  // Supprime les uploads orphelins lors d'un reset complet
  if (reset) {
    const dir = path.join(__dirname, '..', 'public', 'uploads');
    // Les photos de démo (uploads/demo) sont conservées
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) if (f.isFile() && f.name !== '.gitkeep') fs.unlinkSync(path.join(dir, f.name));
  }
}
