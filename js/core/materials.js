/* Anatomical material system. Physically-based tissue palette with procedural
 * micro-detail (bump maps), wet-eye optics, subsurface-ish skin, and subtle
 * per-mesh organic variation. Honors verified structure data; never fabricates. */
import * as THREE from 'three';

/* ---- deterministic procedural noise (seeded; identical on every load) ---- */
function prng(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function valueNoise(seed, ox = 0, oy = 0) {
  const r = prng(seed);
  const L = 65;
  const grid = new Float32Array(L * L);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  return (x, y) => {
    const xi = Math.floor(x) + ox, yi = Math.floor(y) + oy;
    const fx = x - Math.floor(x), fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const g = (cx, cy) => grid[((cx % L) + L) % L + L * (((cy % L) + L) % L)];
    const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function fbm(seed, octaves = 3) {
  const layers = [];
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push({ n: valueNoise(seed + o * 7919, o * 101, o * 137), s: 1 + o, a: amp });
    total += amp;
    amp *= 0.5;
  }
  return (x, y) => {
    let v = 0;
    for (const l of layers) v += l.n(x / l.s, y / l.s) * l.a;
    return v / total;
  };
}

function hasCanvas() { return typeof document !== 'undefined' && typeof document.createElement === 'function'; }

function makeBumpMap(tissue, seed) {
  if (!hasCanvas()) return null;
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const contrast = { skin: 0.75, 'skin-in': 0.7, muscle: 0.9, 'muscle-stripe': 0.95, heart: 0.45, lung: 0.3, liver: 0.55, kidney: 0.4, gut: 0.35, brain: 0.5, nerve: 0.25, bone: 0.5, organ: 0.35, uterus: 0.35, ovary: 0.5, placenta: 0.65, pancreas: 0.35, spleen: 0.5, artery: 0.4, vein: 0.4, sclera: 0.2, iris: 0.7 }[tissue] || 0.35;
  const base = 128;
  if (tissue === 'muscle' || tissue === 'muscle-stripe') {
    const n = fbm(seed + 11, 3);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const fiber = n(x / 22, y / 16);
        const grain = fbm(seed + 31, 2)(x / 7, y / 7);
        let v = 0.55 + (fiber - 0.5) * 1.1 + (grain - 0.5) * 0.5;
        const i = (y * S + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, base + (v - 0.5) * 255 * contrast));
        d[i + 3] = 255;
      }
    }
  } else if (tissue === 'liver') {
    const n = fbm(seed + 5, 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = n(x / 46, y / 46);
      const i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, base + (v - 0.5) * 255 * contrast));
      d[i + 3] = 255;
    }
  } else if (tissue === 'skin' || tissue === 'skin-in') {
    const fine = fbm(seed + 7, 3);
    const broad = fbm(seed + 9, 3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = 0.5 + (fine(x / 34, y / 34) - 0.5) + (broad(x / 9, y / 9) - 0.5) * 0.6 + (fbm(seed + 13, 2)(x / 3.4, y / 3.4) - 0.5) * 0.9;
      const i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, base + (v - 0.5) * 255 * contrast));
      d[i + 3] = 255;
    }
  } else if (tissue === 'bone') {
    const n = fbm(seed + 3, 3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = n(x / 130, y / 130) * 0.8 + n(x / 13, y / 13) * 0.3;
      const i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, base + (v - 0.5) * 255 * contrast));
      d[i + 3] = 255;
    }
  } else if (tissue === 'iris') {
    const n = fbm(seed + 17, 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const ang = Math.atan2(y - S / 2, x - S / 2);
      const rad = Math.hypot(x - S / 2, y - S / 2);
      const spokes = 0.5 + 0.5 * Math.sin(ang * 18 + n(x / 20, y / 20) * rad / 8);
      const v = spokes * 0.7 + n(x / 9, y / 9) * 0.3;
      const i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, base + (v - 0.5) * 255 * contrast));
      d[i + 3] = 255;
    }
  } else {
    const n = fbm(seed + 3, 3);
    const s = { lung: 60, kidney: 26, gut: 40, brain: 30, organ: 34, heart: 24, ovary: 22, uterus: 30, placenta: 34, spleen: 24, pancreas: 24, artery: 18, vein: 18, nerve: 26, sclera: 40 }[tissue] || 30;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = n(x / s, y / s);
      const i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, base + (v - 0.5) * 255 * contrast));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ---- tissue definitions ---- */
const T = (p) => p;
const TISSUES = {
  bone: T({ color: 0xf0e6d2, roughness: 0.48, metalness: 0.0, sheen: 0.12, bump: 0.5, bumpScale: 0.22, env: 0.75, variation: true, seed: 3 }),
  cartilage: T({ color: 0xd9d1ec, roughness: 0.42, metalness: 0.0, transparent: true, opacity: 0.62, shine: true, env: 0.9 }),
  muscle: T({ color: 0x9a302a, roughness: 0.74, metalness: 0.0, bump: 0.9, bumpScale: 0.42, env: 0.45, variation: true, seed: 11 }),
  'muscle-stripe': T({ color: 0x8f2b26, roughness: 0.68, metalness: 0.0, bump: 0.95, bumpScale: 0.5, env: 0.45, variation: true, seed: 13 }),
  heart: T({ color: 0x7d1c24, roughness: 0.5, metalness: 0.02, bump: 0.45, bumpScale: 0.2, env: 0.7, variation: true, seed: 5 }),
  lung: T({ color: 0xd9a4ac, roughness: 0.74, metalness: 0.0, bump: 0.3, bumpScale: 0.14, env: 0.5, variation: true, seed: 19 }),
  liver: T({ color: 0x7a3724, roughness: 0.66, metalness: 0.01, bump: 0.55, bumpScale: 0.3, env: 0.6, variation: true, seed: 23 }),
  kidney: T({ color: 0xa05a3e, roughness: 0.62, metalness: 0.01, bump: 0.4, bumpScale: 0.2, env: 0.6, variation: true, seed: 29 }),
  gut: T({ color: 0xb0784e, roughness: 0.7, metalness: 0.0, bump: 0.35, bumpScale: 0.16, env: 0.5, variation: true, seed: 31 }),
  intestine: T({ color: 0xc28f78, roughness: 0.66, metalness: 0.0, bump: 0.35, bumpScale: 0.16, env: 0.5, variation: true, seed: 37 }),
  stomach: T({ color: 0xc88f74, roughness: 0.66, metalness: 0.0, bump: 0.35, bumpScale: 0.16, env: 0.5, variation: true, seed: 41 }),
  bladder: T({ color: 0xd0938f, roughness: 0.5, metalness: 0.0, bump: 0.4, bumpScale: 0.18, env: 0.6, variation: true, shine: true, seed: 43 }),
  pancreas: T({ color: 0xd9a475, roughness: 0.72, metalness: 0.0, bump: 0.35, bumpScale: 0.14, env: 0.5, variation: true, seed: 47 }),
  spleen: T({ color: 0x7d2b30, roughness: 0.72, metalness: 0.0, bump: 0.5, bumpScale: 0.2, env: 0.55, variation: true, seed: 53 }),
  thymus: T({ color: 0xd9a5a3, roughness: 0.68, metalness: 0.0, bump: 0.35, bumpScale: 0.16, env: 0.5, variation: true, seed: 59 }),
  brain: T({ color: 0xd0a9b4, roughness: 0.56, metalness: 0.0, bump: 0.5, bumpScale: 0.22, env: 0.6, variation: true, seed: 61 }),
  nerve: T({ color: 0xe6d7b4, roughness: 0.66, metalness: 0.0, bump: 0.25, bumpScale: 0.1, env: 0.55, variation: true, seed: 67 }),
  artery: T({ color: 0xb8232b, roughness: 0.52, metalness: 0.0, bump: 0.4, bumpScale: 0.2, env: 0.65, variation: true, seed: 71 }),
  vein: T({ color: 0x47539c, roughness: 0.52, metalness: 0.0, bump: 0.4, bumpScale: 0.2, env: 0.65, variation: true, seed: 73 }),
  lymph: T({ color: 0xacc0ab, roughness: 0.58, metalness: 0.0, bump: 0.3, bumpScale: 0.12, env: 0.6, variation: true, seed: 79 }),
  skin: T({ color: 0xe0ac7e, roughness: 0.6, metalness: 0.0, sheen: 0.4, sheenColor: 0x7a3c2e, clearcoat: 0.12, bump: 0.75, bumpScale: 0.5, env: 0.85, femaleColor: 0xdba97d, seed: 83 }),
  'skin-in': T({ color: 0xc98f6d, roughness: 0.66, metalness: 0.0, sheen: 0.3, sheenColor: 0x6f3328, bump: 0.7, bumpScale: 0.45, env: 0.8, femaleColor: 0xc58b68, seed: 89 }),
  hair: T({ color: 0x2b1e18, roughness: 0.32, metalness: 0.05, env: 1.0 }),
  organ: T({ color: 0xb0799e, roughness: 0.72, metalness: 0.0, bump: 0.35, bumpScale: 0.16, env: 0.55, variation: true, seed: 97 }),
  'tract': T({ color: 0xcfa6b0, roughness: 0.68, metalness: 0.0, bump: 0.3, bumpScale: 0.12, env: 0.55, variation: true, seed: 101 }),
  uterus: T({ color: 0xc77a94, roughness: 0.64, metalness: 0.0, bump: 0.35, bumpScale: 0.16, env: 0.55, variation: true, seed: 103 }),
  ovary: T({ color: 0xd09a7c, roughness: 0.66, metalness: 0.0, bump: 0.5, bumpScale: 0.22, env: 0.55, variation: true, seed: 107 }),
  placenta: T({ color: 0x9a4a4a, roughness: 0.72, metalness: 0.0, bump: 0.65, bumpScale: 0.3, env: 0.5, variation: true, seed: 109 }),
  sclera: T({ color: 0xf0e8dc, roughness: 0.42, metalness: 0.0, shine: true, env: 1.1 }),
  cornea: T({ color: 0xefe9df, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.12, ior: 1.376, shine: true, env: 1.4 }),
  lens: T({ color: 0xe8dcb8, roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.35, ior: 1.42, shine: true, env: 1.2 }),
  vitreous: T({ color: 0xdbe0dd, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.06, ior: 1.33, shine: true, env: 1.3 }),
  iris: T({ color: 0x6b4a2c, roughness: 0.4, metalness: 0.0, bump: 0.7, bumpScale: 0.5, env: 1.0 }),
  default: T({ color: 0xc9c9c9, roughness: 0.65, metalness: 0.0, variation: true, seed: 113 }),
};
const FEMALE_COLORS = {
  muscle: 0xa83a34, 'muscle-stripe': 0x9e332e, heart: 0x8a242c, lung: 0xdfa9b2, liver: 0x843b27,
  gut: 0xb87f55, kidney: 0xa86044, uterus: 0xcf84a0, ovary: 0xd69f81, placenta: 0xa55454,
};

export function tissueFor(name, group) {
  const n = (name || '').toLowerCase();
  const grp = (group || '').replace(/^female-/, '');
  const EYE = /cornea|lens|vitreous|aqueous|iris|sclera|pupil|conjunctiv|ciliary|choroid|retina|macula|fovea|optic_disc|ora_serrata|zonule|trabecular|schlemm/;
  if (grp === 'skin') {
    if (/hair|eyelash|brow|lash/.test(n)) return 'hair';
    if (/inner|interior|inside|cavity_v/.test(n)) return 'skin-in';
    return 'skin';
  }
  if (grp === 'skeleton') return n.includes('cartilage') || /disc|disk/.test(n) ? 'cartilage' : 'bone';
  if (grp === 'joints') return n.includes('ligament') || n.includes('cartilage') ? 'cartilage' : 'cartilage';
  if (grp === 'muscles') return n.includes('fascia') ? 'muscle-stripe' : 'muscle';
  if (grp === 'vessels') {
    let t = 'artery';
    if (/vein|ven[ae]|sinus$|plexus|capillar/.test(n)) t = 'vein';
    if (/heart|cardiac|myocard|coronar|aorta/.test(n)) t = 'heart';
    return t;
  }
  if (grp === 'nervous') {
    if (EYE.test(n)) return eyeTissue(n);
    let t = 'nerve';
    if (/cerebr|cerebell|cortex|brain|pons|medulla|midbrain|thalamus|gan/g.test(n) && /nerve|tract|nucleus/.test(n) === false) t = 'brain';
    return t;
  }
  if (grp === 'lymphatic') return 'lymph';
  if (grp === 'organs') {
    if (/heart|cardiac/.test(n) && !/vein/.test(n)) return 'heart';
    if (/lung|alveol|pulmon-/.test(n)) return 'lung';
    if (/liver|hepat/.test(n)) return 'liver';
    if (/kidney|renal/.test(n)) return 'kidney';
    if (/spleen/.test(n)) return 'spleen';
    if (/pancreas/.test(n)) return 'pancreas';
    if (/thymus/.test(n)) return 'thymus';
    if (/bladder|vesic/.test(n)) return 'bladder';
    if (/ureter|calyx|pelvis_renal|renal_pelvis/.test(n)) return 'gut';
    if (/stomach|gastr/.test(n)) return 'stomach';
    if (/intest|colon|sigmoid|duodenum|cecum|appendix|rectum|mesenter|omentum/.test(n)) return 'intestine';
    if (/uterus|uterine|cervix|endometri|amnion|chorion|fallopian|fimbria|vagina/.test(n)) return 'uterus';
    if (/placenta|umbilical/.test(n)) return 'placenta';
    if (/ovary|ovarian/.test(n)) return 'ovary';
    if (/tract/.test(n)) return 'tract';
    if (EYE.test(n)) return eyeTissue(n);
    return 'organ';
  }
  return 'default';
}
function eyeTissue(n) {
  if (/cornea|conjunctiv/.test(n)) return 'cornea';
  if (/vitreous|aqueous|humor/.test(n)) return 'vitreous';
  if (/lens/.test(n)) return 'lens';
  if (/sclera/.test(n)) return 'sclera';
  if (/iris/.test(n)) return 'iris';
  return 'sclera';
}

/* ---- material cache ---- */
const baseCache = new Map();   // tissue -> base physical material
const texCache = new Map();    // tissue -> bump texture
const variantCache = new Map(); // tissue:variant -> cloned material

function setOptics(m, p) {
  if (p.sheen) m.sheen = p.sheen;
  if (p.sheenColor) m.sheenColor = new THREE.Color(p.sheenColor);
  if (p.clearcoat) m.clearcoat = p.clearcoat;
  if (p.shine) m.clearcoat = 0.6;
}
function buildBase(tissue) {
  const p = TISSUES[tissue] || TISSUES.default;
  const mat = new THREE.MeshPhysicalMaterial({ color: p.color, roughness: p.roughness, metalness: p.metalness, envMapIntensity: p.env ?? 0.55, name: 'tissue:' + tissue });
  if (p.transparent) { mat.transparent = true; mat.opacity = p.opacity; mat.depthWrite = false; }
  if (p.ior) mat.ior = p.ior;
  setOptics(mat, p);
  if (p.bump) {
    const key = tissue;
    if (!texCache.has(key)) texCache.set(key, makeBumpMap(tissue, p.seed || 1));
    const t = texCache.get(key);
    if (t) { mat.bumpMap = t; mat.bumpScale = p.bumpScale; }
  }
  return mat;
}
function baseMaterial(tissue) {
  if (!baseCache.has(tissue)) baseCache.set(tissue, buildBase(tissue));
  return baseCache.get(tissue);
}

function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

export function tissueMaterial(tissue, opts = {}) {
  const base = baseMaterial(tissue);
  if (!opts.variation && !opts.sex) return base;
  const seed = hashName(opts.name || '') | 0;
  const vid = Math.abs(seed) % 9;
  const key = tissue + ':' + (opts.sex || 'm') + ':' + vid;
  if (variantCache.has(key)) return variantCache.get(key);
  const p = TISSUES[tissue] || TISSUES.default;
  const c = new THREE.Color(p.color);
  let shade = opts.sex === 'f' ? (FEMALE_COLORS[tissue] ? new THREE.Color(FEMALE_COLORS[tissue]) : c.clone().offsetHSL(0, 0.02, 0.012)) : c;
  shade = shade.clone();
  if (p.variation) shade.offsetHSL(0, ((vid % 3) - 1) * 0.012, ((vid * 37) % 11 - 5) * 0.008);
  const mat = buildBase(tissue);
  mat.color.copy(shade);
  if (opts.sex === 'f' && p.femaleColor) mat.color.copy(new THREE.Color(p.femaleColor));
  variantCache.set(key, mat);
  return mat;
}

export function applyTissue(mesh, group) {
  const tissue = tissueFor(mesh.name || '', group);
  const sex = String(group || '').startsWith('female-') ? 'f' : 'm';
  const mat = tissueMaterial(tissue, { variation: TISSUES[tissue]?.variation ?? false, sex, name: mesh.name || '' });
  mesh.material = mat;
  mesh.userData.tissue = tissue;
  return mat;
}

/* ---- highlight utilities (subtle medical styling, no neon) ---- */
const HOVER_BOOST = 0x1a1510;
const SELECT_BOOST = 0x281804;

export function setHighlight(mesh, level) {
  if (!mesh || !mesh.material) return;
  const m = mesh.material.isMeshStandardMaterial ? mesh.material : null;
  if (!m) return;
  const base = mesh.userData.__baseEmissive;
  if (!base) return;
  m.emissive.setHex(base);
  if (level === 'hover') m.emissive.addScaledColor(new THREE.Color(HOVER_BOOST), 0.5);
  else if (level === 'select') m.emissive.addScaledColor(new THREE.Color(SELECT_BOOST), 1);
  m.emissiveIntensity = 0.85;
  m.needsUpdate = true;
}

export function storeBaseEmissive(mesh) {
  if (!mesh.material || mesh.userData.__baseEmissive) return;
  if (mesh.material.isMeshStandardMaterial) mesh.userData.__baseEmissive = mesh.material.emissive.getHex();
}