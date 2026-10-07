/* Centralized anatomy database + mesh-name mapping + indexed search.
 * DOM-free. Maps real GLB mesh names to anatomical structures.
 * Verifies FMA associations only on strong name-token evidence (never fabricated).
 */
import { FMA } from './fmaDb.js';

export const SIDE = { R: 'Right', L: 'Left', M: '' };

const STOP = new Set([
  'of', 'the', 'and', 'set', 'sets', 'part', 'parts', 'group', 'g', 'e', 'o', 'o1',
]);

/* Left/Right prefix markers used by Z-Anatomy node names */
export function splitName(raw) {
  let name = String(raw || '').trim();
  let side = 'M';
  name = name.replace(/[()]/g, '');
  name = name.replace(/[_\-]+/g, '_').replace(/^_+|_+$/g, '');
  let m = name.toLowerCase().match(/^(right|left)_(.+)$/i);
  if (m) { side = m[1].toLowerCase() === 'right' ? 'R' : 'L'; name = m[2]; }
  // muscle/ligament/artery/vein/nerve/bone suffixes: strip artifact tails then side letter
  // e.g. Sartorius_muscleer, Soleus_muscleo1r, Patellar_ligamenter, Femoral_arteryr, Ureterr
  name = name.replace(/_muscle[eo]*$/i, '');
  m = name.match(/^(.*?)_(muscle|ligament|artery|vein|nerve|bone|muscleo)[eo1]*([rlRL])$/);
  if (m && m[1].length > 3) {
    const cand = m[1] + '_' + m[2];
    if (m[3] && side === 'M') side = m[3].toLowerCase() === 'r' ? 'R' : 'L';
    name = cand;
  } else {
    m = name.match(/^(.*?)([rlRL])$/);
    if (m && m[1].length >= 3 && side === 'M') {
      const base = m[1];
      // dictionary-proof: only strip a trailing r/l when the result names a real FMA term
      const bl = base.toLowerCase().replace(/_/g, ' ');
      const dictOk = FMA[bl] || FMA[bl.replace(/s$/, '')] || FMA[bl + 's'] || FMA[bl + 'e'];
      // corpus-proof: a paired Xr / Xl twin marks the trailing letter as a side marker
      const twinOk = TWIN_MARKERS.has(base.toLowerCase());
      if (dictOk || twinOk) { side = m[2].toLowerCase() === 'r' ? 'R' : 'L'; name = base; }
    }
  }
  name = name.replace(/[ _]+$/, '');
  return { name, side };
}

/* Data-driven side-marker priming: given all raw mesh names of the loaded corpus, any name
 * ending in r/l whose twin (swap r<->l) also exists has a trailing *side marker*. */
let TWIN_MARKERS = new Set();
export function primeSideMarkers(rawNames) {
  const names = [...new Set(rawNames)];
  const ends = (s, ch) => s.length > 1 && /[rl]+$/i.test(s) && s.charAt(s.length - 1).toLowerCase() === ch;
  TWIN_MARKERS = new Set();
  for (const n of names) {
    const last = n.charAt(n.length - 1);
    if (last !== 'r' && last !== 'l') continue;
    const base = n.slice(0, -1);
    const twin = base + (last === 'r' ? 'l' : 'r');
    if (names.includes(twin)) TWIN_MARKERS.add(base.toLowerCase());
  }
  return TWIN_MARKERS.size;
}

export function tokens(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t && !STOP.has(t));
}

/* tokenized index of FMA names */
const fmIndex = [];
{
  const seen = new Set();
  for (const [label, [id, disp]] of Object.entries(FMA)) {
    const key = id + '|' + label;
    if (seen.has(key)) continue;
    seen.add(key);
    fmIndex.push({ id, disp: disp || label, label, toks: tokens(label) });
  }
}
const fmByToken = new Map();
for (const e of fmIndex) for (const t of e.toks) {
  if (!fmByToken.has(t)) fmByToken.set(t, []);
  fmByToken.get(t).push(e);
}

/* Family nouns allowed to drop when comparing names (e.g. "Sartorius muscle" ~ "Sartorius") */
const FAMILY = new Set(['muscle', 'artery', 'vein', 'nerve', 'ligament', 'gland', 'bone', 'joint', 'organ', 'skin']);
const LATERAL = { right: 'R', left: 'L' };

/* score a cleaned name against a FMA entry (token overlap, order/containment bonus,
 * family tolerance, lateral agreement) */
function score(clean, toks, entry) {
  const a = toks;
  const b = entry.toks;
  let hit = 0;
  for (const t of a) if (b.includes(t)) hit++;
  const union = a.length + b.length - hit;
  let s = union === 0 ? 0 : hit / union;
  // family- & lateral-tolerant comparison
  const stripMe = (t) => !FAMILY.has(t) && !(t in LATERAL);
  const aC = a.filter(stripMe);
  const bC = b.filter(stripMe);
  if (aC.length && bC.length && (aC.length !== a.length || bC.length !== b.length)) {
    let h2 = 0;
    for (const t of aC) if (bC.includes(t)) h2++;
    const u2 = aC.length + bC.length - h2;
    if (u2 > 0) s = Math.max(s, h2 / u2);
  }
  const joined = clean.replace(/[^a-z0-9]+/g, ' ');
  if (entry.label.includes(joined)) s = Math.max(s, 0.92);
  if (joined.includes(entry.label)) s = Math.max(s, 0.9);
  if (entry.label === clean) s = 1;
  else if (aC.length === 1 && bC.length === 1 && aC[0] === bC[0]) s = Math.max(s, 0.85);
  // lateral agreement
  const aLat = a.find((t) => t in LATERAL);
  const bLat = b.find((t) => t in LATERAL);
  if (!aLat && bLat) s *= 0.8;               // unpaired query vs lateral FMA term
  else if (aLat && !bLat) s *= 0.85;         // lateral query vs midline FMA term
  else if (aLat && bLat && aLat !== bLat) s = Math.min(s, 0.2); // wrong side
  return s;
}

export function lookupFMA(cleanName, side) {
  const clean = cleanName.toLowerCase().replace(/_/g, ' ');
  const toks = tokens(clean);
  if (!toks.length) return null;
  const cands = new Map();
  for (const t of toks) for (const e of fmByToken.get(t) || []) {
    const s = score(clean, toks, e);
    if (s > 0.6 && (!cands.has(e.id) || cands.get(e.id).score < s)) cands.set(e.id, { e, score: s });
  }
  const pool = [...cands.values()].sort((a, b) => (b.score - a.score) || (Math.abs(a.e.label.length - clean.length) - Math.abs(b.e.label.length - clean.length)));
  if (!pool.length) return null;
  const winner = pool[0];
  const rival = pool[1];
  const ambiguous = rival && rival.score >= 0.82 && Math.abs(rival.score - winner.score) < 0.04;
  return {
    id: winner.e.id,
    name: winner.e.disp,
    side,
    score: Math.round(winner.score * 100) / 100,
    verified: winner.score >= 0.72 && !ambiguous,
  };
}

/* system classification by anatomy keywords (anatomical truth, not fabrication).
 * Rule order matters: organ rules precede generic 'muscle' rules so e.g.
 * 'urinary bladder neck (smooth muscle)' classifies as urinary, not muscular. */
const SYS_RULES = [
  { sys: 'cardiovascular', re: /artery|arteries|vein|veins|vena|venae|capillary|portal|aorta|aortic|heart|cordis|coronar|pulmonary|saphenous|jugular|brachiocephalic|atrium|atria|ventricle|valve|septum|endocardium|myocardium|pericardium|chamber|aneurysm|arch|arches|trunk|rete|network|bundle|sinus/i },
  { sys: 'nervous', re: /nerve|cerebr|cerebell|brain|spinal|pons|medulla|midbrain|thalamus|hypothalamus|ganglion|plexus|tract|funicul|tentorium|falx|meninx|meninges|retina|cornea|optic|visual|lens|cochlea|vestibul|hippocamp|amygdala|cortex|hypophys|pituitar|pineal|neur|sclera|iris|pupil|ciliary|aqueous|vitreous|choroid|conjunctiva|palpebral|uvea|fovea|macula|trabecular/i },
  { sys: 'urinary', re: /kidney|renal|ureter|bladder|urethra|nephron|calyx|pelvis/i },
  { sys: 'reproductive', re: /uterus|cervix|ovary|ovarian|testis|testicular|penis|scrotum|prostate|fallopian|vagina|epididymis|labium|deferens|ejaculatory|seminal|ductus|vesicular|clitoris|placenta|amnion|chorion|umbilical|gestational|endometri|basal[ _]?plate/i },
  { sys: 'lymphatic', re: /lymph|lymphoid|spleen|tonsil|thymus/i },
  { sys: 'muscular', re: /muscle|myo|fascia|tendon|sartorius|biceps|triceps|quadriceps|tibialis|gastrocnemius|soleus|deltoid|trapezius|latissimus|pectoral|glute|abdominis|oblique|brachioradial|flexor|extensor|supinator|pronator|adduct|abduct|levator|depressor|elevator|contrac|sphincter/i },
  { sys: 'skeletal', re: /bone|os \b|oss|vertebra|vertebral|rib\b|ribs|skeleton|clavicle|scapula|humerus|radius|ulna|carp|metacarp|phalang|femur|tibia|fibula|patella|tarsal|metatars|pelvis|pelvic|iliac|ischium|pubis|pubic|sacrum|coccyx|sternum|mandible|maxilla|zygomatic|frontal|parietal|temporal|occipital|sphenoid|ethmoid|vomer|hyoid|skull|cranium|ligament|cartilage|meniscus|condyle|epicondyle|tuberos|trocanter|malleolus|suture|joint|articul|disk|disc|synovial|acetabulum|glenoid|intervertebral|labrum|membrane|pulposus|ligamentum|foramen|canal|tubercle|process|fossa|groove|notch|sulcus/i },
  { sys: 'respiratory', re: /lung|pulmonary|trachea|bronchus|bronch|alveol|pharynx|larynx|diaphragm|pleura|lobe|lingular|nasal|nose|mucosa|concha|sinus of nose|hilum|carina/i },
  { sys: 'digestive', re: /stomach|intestine|duoden|jejunum|ileum|colon|cecum|caecum|appendix|rectum|anus|esophagus|oesophagus|liver|hepat|pancreas|gallbladder|biliary|bile|salivar|tongue|mesentery|omentum|pylor|gastric|palate|uvula|gingiva|taenia|parotid|submandibular|sublingual|segment\d*$/i },
  { sys: 'endocrine', re: /thyroid|parathyroid|adrenal|pituitary|hypophys|pancreatic islet|endocrine/i },
  { sys: 'integumentary', re: /skin|epiderm|dermis|hair|nail|subcutaneous|dermic|integument|region of|region$|fold$/i },
];
export function classifySystem(name, hint) {
  if (hint) return hint;
  const nn = (name || '').toLowerCase();
  // female reproductive tube/horn/uterine terms not covered by the main rule list
  if (/uterine|cervix|fallopian|fimbria|cornu/.test(nn)) return 'reproductive';
  for (const r of SYS_RULES) if (r.re.test(name)) return r.sys;
  return 'unknown';
}

/* region guess from group hierarchy name (persisted by loader) + keywords */
export function regionFromHints(name, groupChain) {
  const g = (groupChain || []).slice(-3).join(' ').toLowerCase();
  if (/head|face|cranial|skull|ocular|oral|nasal|ear\b|neck|cervic/.test(g)) return 'Head & Neck';
  if (/thigh|leg|foot|crus|sural|femoral|tibial|talocrural/.test(g)) return 'Lower Limb';
  if (/arm|forearm|hand|brachial|humeral|radial|ulnar|palmar|digital|deltoid/.test(g)) return 'Upper Limb';
  if (/thorax|thorac|chest|mediastin|pulmonary|cardiac|intercostal|sternal|axillary|breast|mammar/.test(g)) return 'Thorax';
  if (/abdom|celiac|hepato|splenic|pancreat|mesenteric|omental|lumbar|renal|suprarenal/.test(g)) return 'Abdomen';
  if (/pelv|inguinal|gluteal|perine|sacral|coccyg/.test(g)) return 'Pelvis';
  if (/back|dorsal|vertebral|scapular/.test(g)) return 'Back & Spine';
  if (/lower limb|superior limb/.test(g)) return 'Limb';
  const n = (name || '').toLowerCase();
  if (/cerebr|cerebell|brain|skull|cranial|ocular|cochlea|optic|nasal|mandible|maxilla|tooth|pons|medulla|midbrain|thalamus|hypothalamus/.test(n)) return 'Head & Neck';
  if (/cervic|neck|thyroid|larynx|pharynx/.test(n)) return 'Head & Neck';
  if (/thorac|rib|sternum|lung|heart|pulmonary|aorta|trachea|bronch|diaphragm|mammar/.test(n)) return 'Thorax';
  if (/abdom|liver|stomach|kidney|pancreas|spleen|colon|intestine|mesenteric|duodenum|gallbladder|ureter/.test(n)) return 'Abdomen';
  if (/pelv|bladder|uterus|prostate|ovary|testis|rectum|glute/.test(n)) return 'Pelvis';
  if (/femur|tibia|fibula|patella|tarsal|metatars|gastrocnem|soleus|sartorius|quadriceps|glute/.test(n)) return 'Lower Limb';
  if (/humerus|radius|ulna|carp|metacarp|phalang|brachial|deltoid|biceps|triceps|flexor|extensor/.test(n)) return 'Upper Limb';
  if (/vertebr|spinal|cord|dorsal|scapular/.test(n)) return 'Back & Spine';
  return 'Whole Body';
}

export function cleanLabel(name, side) {
  let label = name.split('_').join(' ').trim();
  label = label.replace(/\s+/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/* Prebuilt alias map for search (verified synonymy) */
const ALIASES = {
  heart: ['cardiac', 'myocardium'],
  brain: ['cerebrum', 'encephalon'],
  lungs: ['pulmonary organ'],
  femur: ['thigh bone', 'os femoris'],
  tibia: ['shinbone', 'shin'],
  humerus: ['arm bone'],
  radiusbone: ['radius bone', 'radial bone'],
  skull: ['cranium', 'neurocranium'],
  mandible: ['jawbone', 'lower jaw'],
  'urinary bladder': ['bladder'],
  gallbladder: ['gall bladder', 'cholecyst'],
  'small intestine': ['small bowel'],
  'large intestine': ['large bowel', 'colon'],
  'spinal cord': ['medulla spinalis'],
  sternum: ['breastbone'],
  clavicle: ['collarbone'],
  scapula: ['shoulder blade'],
  patella: ['kneecap'],
  trachea: ['windpipe'],
  esophagus: ['oesophagus', 'gullet'],
  stomach: ['gaster', 'gastric organ'],
  liver: ['hepar'],
  kidney: ['renal organ', 'nephros'],
  'optical nerve': ['optic nerve', 'cranial nerve ii'],
};

export const PREVIEW = 'FMA';

/* Build a Structure record */
export function structureFromName(rawName, opts = {}) {
  const { groupChain, systemHint } = opts;
  const { name, side } = splitName(rawName);
  const clean = cleanLabel(name, side);
  const fma = lookupFMA(name, side);
  const system = classifySystem(name + ' ' + clean, systemHint);
  const region = regionFromHints(name, groupChain);
  return {
    key: (side === 'M' ? '' : side + '_') + name.replace(/\s+/g, '_').toLowerCase(),
    rawName,
    name: clean,
    side: side === 'M' ? '' : SIDE[side],
    nameFull: (side === 'M' ? '' : SIDE[side] + ' ') + clean,
    system,
    region,
    fma: fma ? { id: fma.id, name: fma.name, verified: fma.verified, score: fma.score } : null,
    verified: fma ? fma.verified : false,
    mappingNote: fma && !fma.verified ? 'Mapping not verified' : null,
  };
}

/* ------------- indexed search ------------- */
const STRUCT_INDEX = [];
const STRUCT_BY_KEY = new Map();
export function registerStructures(structs) {
  for (const s of structs) {
    if (STRUCT_BY_KEY.has(s.key)) continue;
    STRUCT_BY_KEY.set(s.key, s);
    const toks = new Set([...tokens(s.nameFull), ...tokens(s.name), ...(ALIASES[s.name.toLowerCase()] || []).map((a) => tokens(a)).flat()]);
    if (s.fma) { toks.add(s.fma.id.toLowerCase()); tokens(s.fma.name).forEach((t) => toks.add(t)); }
    STRUCT_INDEX.push({ s, toks: [...toks] });
  }
  return STRUCT_INDEX.length;
}
export function searchStructures(query, limit = 40) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const qToks = tokens(q);
  const qExact = q.replace(/[^a-z0-9]/g, ' ');
  const scored = [];
  for (const item of STRUCT_INDEX) {
    let score = 0;
    if (item.s.nameFull.toLowerCase() === q) score = 100;
    else if (item.s.name.toLowerCase() === q) score = 99;
    else if (item.s.fma && item.s.fma.id.toLowerCase() === q) score = 98;
    else if (ALIASES[item.s.name.toLowerCase()] && ALIASES[item.s.name.toLowerCase()].some((a) => a.toLowerCase() === q)) score = 95;
    else {
      const label = item.s.nameFull.toLowerCase() + ' ' + item.toks.join(' ');
      if (label.startsWith(qExact)) score = 60;
      else if (label.includes(qExact)) score = 40;
      else {
        let hits = 0;
        for (const t of qToks) if (item.toks.includes(t)) hits++;
        score = hits / Math.max(1, qToks.length) * 25;
      }
    }
    if (score > 0) scored.push({ s: item.s, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.s);
}
export function getStructure(key) { return STRUCT_BY_KEY.get(key) || null; }
export function structureCount() { return STRUCT_INDEX.length; }
export function structuresBySystem(sys) { return STRUCT_INDEX.filter((x) => x.s.system === sys).map((x) => x.s); }