// Récupère des photos libres de droits (Wikimedia Commons) pour les lots de démonstration.
// Usage : node server/demo-images.js   → télécharge dans public/uploads/demo/ et écrit data/demo-images.json
// Chaque image conserve son auteur et sa licence (affichés dans l'admin et à respecter en production).
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'uploads', 'demo');
const MAP = path.join(__dirname, '..', 'data', 'demo-images.json');

// Titre du lot (FR, tel que dans seed.js) → recherche Commons (anglais = meilleurs résultats)
const QUERIES = {
  'Toyota Land Cruiser Prado 2018 — 4x4 diesel': 'Toyota Land Cruiser Prado J150',
  'Toyota Hilux double cabine 2016': 'Toyota Hilux double cab 2016',
  'Hyundai Elantra 2019 — essence, climatisation': 'Hyundai Elantra 2019',
  'Suzuki Swift 2020 — faible kilométrage': 'Suzuki Swift 2020',
  'Lot de 4 pneus Michelin 265/65 R17 neufs': 'car tyres stack',
  'Camion benne Mercedes Actros 2014 — 20 m³': 'Mercedes-Benz Actros dump truck',
  'Isuzu NPR frigorifique 2017 — groupe froid Thermo King': 'Isuzu NPR refrigerated truck',
  'Tracteur Volvo FH12 + semi porte-conteneur 40 pieds': 'Volvo FH12 container truck',
  'Pont élévateur 2 colonnes 4 tonnes': 'two post car lift garage',
  'Lot de 10 batteries Varta 12V 100Ah': 'car battery',
  'iPhone 15 Pro 256 Go — titane naturel, sous garantie': 'iPhone 15 Pro',
  'Dell Precision 7520 — i7, 16 Go, SSD 512 Go': 'Dell Precision laptop',
  'TV Samsung QLED 65" 4K': 'Samsung QLED television',
  'Drone DJI Mini 4 Pro Fly More Combo': 'DJI Mini drone',
  'PlayStation 5 + 2 manettes + 3 jeux': 'PlayStation 5 console',
  'Déstockage : 500 paires de sandales': 'sandals market stall',
  'Lot de 300 chemises coton (tailles assorties)': 'folded shirts shop',
  'Climatiseur split LG 24 000 BTU inverter': 'split air conditioner indoor unit',
  'Réfrigérateur américain Samsung 600 L': 'side by side refrigerator',
  'Lave-linge Beko 9 kg': 'front loading washing machine',
  'Groupe électrogène SDMO 100 kVA insonorisé': 'diesel generator',
  'Pelle hydraulique Caterpillar 320D': 'Caterpillar 320D excavator',
  'Compresseur Atlas Copco XAS 97 mobile': 'Atlas Copco portable compressor',
  'Lot de 12 bureaux open space avec caissons': 'open space office desks',
  '20 fauteuils ergonomiques en maille': 'mesh office chair',
  'Tuk-tuk Bajaj RE 2021 — très bon état': 'Bajaj RE auto rickshaw',
  'Yamaha YZ250F 2019 — moto cross': 'Yamaha YZ250F',
  'Scooter Honda PCX 125': 'Honda PCX 125',
  'Vélo électrique urbain 250 W — autonomie 60 km': 'electric city bicycle',
  'VTT Giant Talon 29" — taille L': 'mountain bike',
  'Lot de 200 kg de dattes Medjool': 'Medjool dates',
  'Palette de 100 sacs de riz basmati 25 kg': 'rice sacks warehouse',
  "Lot de 120 packs d'eau minérale 6×1,5 L": 'bottled water pallet',
  'Salon traditionnel 8 places brodé main': 'majlis',
  "Canapé d'angle en cuir 6 places": 'leather corner sofa',
  'Tapis persan fait main 3×2 m': 'Persian carpet',
  'Toyota Hilux 2015': 'Toyota Hilux 2015',
  'Groupe électrogène 60 kVA': 'diesel generator',
  'MacBook Pro 14"': 'MacBook Pro 14',
  'Climatiseur Midea 18 000 BTU': 'air conditioner split unit wall',
};

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'EnchereDjiboutiDemo/1.0 (demo seed images)';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function search(q, n = 3) {
  const url = `${API}?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&prop=imageinfo&iiprop=url|mime|extmetadata|size&iiurlwidth=900`;
  let data;
  // Commons limite le débit : on patiente et on réessaie
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const txt = await res.text();
    try { data = JSON.parse(txt); break; } catch { await sleep(20000 * (attempt + 1)); }
  }
  if (!data) throw new Error('limite de requêtes Commons');
  const pages = Object.values(data.query?.pages || {}).sort((a, b) => a.index - b.index);
  return pages.map(p => ({ title: p.title, ii: p.imageinfo?.[0] }))
    .filter(p => p.ii && /jpeg|png|webp/.test(p.ii.mime) && p.ii.width >= 500 && p.ii.width >= p.ii.height * 0.9)
    .slice(0, n);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const map = fs.existsSync(MAP) ? JSON.parse(fs.readFileSync(MAP, 'utf8')) : {};
  let i = 0;
  for (const [lot, q] of Object.entries(QUERIES)) {
    i++;
    if (map[lot]?.images?.length) continue;
    try {
      const hits = await search(q);
      const images = [], credits = [];
      for (const [k, h] of hits.entries()) {
        const ext = h.ii.mime.includes('png') ? '.png' : '.jpg';
        const file = `lot-${String(i).padStart(2, '0')}-${k + 1}${ext}`;
        await sleep(1500);
        const r = await fetch(h.ii.thumburl || h.ii.url, { headers: { 'User-Agent': UA } });
        if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) continue;
        fs.writeFileSync(path.join(OUT, file), Buffer.from(await r.arrayBuffer()));
        images.push(`/uploads/demo/${file}`);
        const m = h.ii.extmetadata || {};
        credits.push({ file, source: h.ii.descriptionurl, author: strip(m.Artist?.value), license: strip(m.LicenseShortName?.value) });
      }
      map[lot] = { query: q, images, credits };
      console.log(`${images.length} image(s) — ${lot}`);
    } catch (e) {
      console.log(`ÉCHEC — ${lot} : ${e.message}`);
    }
    fs.writeFileSync(MAP, JSON.stringify(map, null, 2));
    await sleep(3000);
  }
}
main();
