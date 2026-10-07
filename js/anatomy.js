import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const P = (x, y, z) => [x, y, z];

// ---------------------------------------------------------------- noise fns
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}
function smoother(t) { return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = smoother(xf), v = smoother(yf), w = smoother(zf);
  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  const a = lerp(lerp(c000, c100, u), lerp(c010, c110, u), v);
  const b = lerp(lerp(c001, c101, u), lerp(c011, c111, u), v);
  return lerp(a, b, w);
}
function fbm(x, y, z) {
  let a = 0.55, f = 1.0, sum = 0;
  for (let i = 0; i < 4; i++) { sum += a * vnoise(x * f, y * f, z * f); f *= 2.06; a *= 0.5; }
  return sum;
}
function brainNoise(geo) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = fbm(x * 5.5, y * 5.5, z * 5.5) + 0.5 * fbm(x * 16, y * 16, z * 16);
    const r = 1 + (n - 1.15) * 0.075;
    pos.setXYZ(i, x * r, y * r, z * r);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- textures
const _bumpCache = {};
function bumpTile(kind) {
  if (_bumpCache[kind]) return _bumpCache[kind];
  const W = 128;
  const data = new Uint8Array(W * W * 4);
  if (kind === 'striate') {
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const n = vnoise(x * 0.18, y * 0.35, 0);
        const bands = Math.sin((y + n * 14) * 0.42) * 0.5 + 0.5;
        const v = Math.max(0, Math.min(1, bands * 0.85 + n * 0.3));
        const o = (y * W + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = Math.floor(v * 255);
        data[o + 3] = 255;
      }
    }
  } else {
    for (let i = 0; i < W * W; i++) {
      const x = i % W, y = Math.floor(i / W);
      const n = vnoise(x * 0.3, y * 0.3, 3.1) * 0.6 + vnoise(x * 1.4, y * 1.4, 7.7) * 0.4;
      const v = Math.max(0, Math.min(1, n));
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.floor(v * 255);
      data[i * 4 + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, W, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return (_bumpCache[kind] = t);
}

function flowTexture(bands) {
  const W = 256;
  const data = new Uint8Array(W * 4);
  const bandW = W / bands;
  for (let i = 0; i < W; i++) {
    const pos = (i % bandW) / bandW;         // 0..1 inside a band
    const pp = Math.abs(pos - 0.5) * 2;       // 0 center .. 1 edge
    const s = Math.max(0, 1 - pp);
    const v = Math.pow(s, 12);                // sharp travelling bead
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.floor(v * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(bands, 1);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

// ================================================================ builder
export function buildAnatomy() {
  const body = new THREE.Group();
  const meshList = [];
  const layers = { skeleton: [], muscles: [], organs: [], nervous: [], vessels: [], skin: [] };
  const anim = { hearts: [], lungs: [], diaphragm: null, flows: [] };

  function tag(mesh, layer, system, label) {
    mesh.userData.layer = layer;
    mesh.userData.system = system;
    mesh.userData.label = label;
    mesh.castShadow = true;
    layers[layer].push(mesh);
    meshList.push(mesh);
    body.add(mesh);
    return mesh;
  }

  function mat(color, opts = {}) {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.72,
      metalness: opts.metalness ?? 0.04,
      envMapIntensity: 0.5,
    });
    if (opts.opacity != null) { m.transparent = true; m.opacity = opts.opacity; }
    if (opts.bump) { m.bumpMap = bumpTile(opts.bump); m.bumpScale = opts.bumpScale ?? 0.04; }
    m.emissive = new THREE.Color(0x000000);
    m.emissiveIntensity = 0;
    m.fog = false;
    return m;
  }

  function flowMat(hex, bands, speed, intensity = 1.6) {
    const tex = flowTexture(bands);
    const m = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 0.42,
      metalness: 0.08,
      envMapIntensity: 0.3,
      emissive: hex,
      emissiveMap: tex,
      emissiveIntensity: intensity,
    });
    m.fog = false;
    anim.flows.push({ tex, speed });
    return m;
  }

  function addSphere(m, pos, r, scale, layer, system, label) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), m);
    if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.position.set(pos[0], pos[1], pos[2]);
    return tag(mesh, layer, system, label);
  }

  function addCapsule(m, p1, p2, r, layer, system, label) {
    const a = new THREE.Vector3(p1[0], p1[1], p1[2]);
    const b = new THREE.Vector3(p2[0], p2[1], p2[2]);
    const d = b.clone().sub(a);
    const len = d.length();
    const cyl = Math.max(len - 2 * r, 0.0001);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, cyl, 6, 12), m);
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, d.clone().normalize());
    return tag(mesh, layer, system, label);
  }

  function addBox(m, pos, size, layer, system, label, rot) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), m);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    return tag(mesh, layer, system, label);
  }

  function addTube(m, pts, r, layer, system, label, segs = 40) {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, r, 10, false), m);
    return tag(mesh, layer, system, label);
  }

  function both(fn) {
    fn(1);
    fn(-1);
  }

  // ============================================================ SKELETON
  const bone0 = mat(0xece7da, { roughness: 0.55, bump: 'speckle', bumpScale: 0.02 });
  const bone1 = mat(0xdfd5bd, { roughness: 0.58, bump: 'speckle', bumpScale: 0.02 });
  const cut = mat(0xece7da, { roughness: 0.55, opacity: 0.88, bump: 'speckle', bumpScale: 0.015 });

  addSphere(cut, P(0, 1.63, 0.01), 0.1, [0.92, 1.02, 0.95], 'skeleton', 'skeletal', 'Skull');
  addSphere(cut, P(0, 1.545, 0.045), 0.04, [0.78, 0.62, 0.7], 'skeleton', 'skeletal', 'Mandible');
  both(s => addSphere(bone1, P(s * 0.078, 1.615, 0.055), 0.019, [1.1, 0.6, 0.5], 'skeleton', 'skeletal', 'Zygomatic bone'));
  addBox(bone0, P(0, 1.68, 0.035), [0.09, 0.014, 0.03], 'skeleton', 'skeletal', 'Frontal bone', [-0.18, 0, 0]);
  // teeth
  for (let i = -2; i <= 2; i++) {
    addBox(bone1, P(i * 0.016, 1.575, 0.05), [0.012, 0.02, 0.012], 'skeleton', 'skeletal', 'Tooth', [-0.3, 0, 0]);
    addBox(bone1, P(i * 0.016, 1.545, 0.05), [0.012, 0.02, 0.012], 'skeleton', 'skeletal', 'Tooth', [0.3, 0, 0]);
  }

  const spine = [
    [0.985, -0.02], [1.02, -0.03], [1.06, -0.045], [1.10, -0.055],
    [1.14, -0.062], [1.18, -0.067], [1.22, -0.07], [1.26, -0.072],
    [1.30, -0.072], [1.34, -0.068], [1.38, -0.06], [1.42, -0.045],
    [1.46, -0.02], [1.50, 0.012], [1.535, 0.032],
  ];
  for (let i = 0; i < spine.length - 1; i++) {
    addCapsule(bone0, P(0, spine[i][0], spine[i][1]), P(0, spine[i + 1][0], spine[i + 1][1]), 0.021, 'skeleton', 'skeletal', 'Vertebra');
  }
  addCapsule(bone0, P(0, 1.0, -0.02), P(0, 0.965, -0.02), 0.03, 'skeleton', 'skeletal', 'Sacrum');

  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const y = 1.12 + t * 0.28;
    const rx = 0.145 + 0.058 * Math.sin(Math.PI * t);
    const rz = rx * 0.62;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rx, 0.011, 8, 48), bone0);
    ring.position.set(0, y, 0);
    ring.rotation.x = Math.PI / 2;
    ring.scale.z = rz / rx;
    tag(ring, 'skeleton', 'skeletal', 'Rib');
  }

  addBox(bone0, P(0, 1.28, 0.128), [0.03, 0.26, 0.022], 'skeleton', 'skeletal', 'Sternum', [0.05, 0, 0]);
  addCapsule(bone0, P(0, 1.44, 0.115), P(0.165, 1.443, 0.055), 0.013, 'skeleton', 'skeletal', 'Clavicle');
  addCapsule(bone0, P(0, 1.44, 0.115), P(-0.165, 1.443, 0.055), 0.013, 'skeleton', 'skeletal', 'Clavicle');
  both(s => addSphere(bone1, P(s * 0.165, 1.335, -0.055), 0.075, [0.7, 0.95, 0.24], 'skeleton', 'skeletal', 'Scapula'));

  addSphere(bone0, P(0, 1.0, -0.055), 0.05, [0.85, 1.0, 0.6], 'skeleton', 'skeletal', 'Sacrum');
  both(s => addSphere(bone0, P(s * 0.105, 1.02, -0.005), 0.085, [1.35, 1.15, 0.95], 'skeleton', 'skeletal', 'Pelvis'));
  addBox(bone0, P(0, 0.92, 0.02), [0.13, 0.03, 0.07], 'skeleton', 'skeletal', 'Pubis');

  const SX = 0.17, EX = 0.215, WX = 0.235;
  both(s => {
    addSphere(bone1, P(s * SX, 1.44, 0.04), 0.02, null, 'skeleton', 'skeletal', 'Shoulder joint');
    addCapsule(bone0, P(s * SX, 1.42, 0.035), P(s * EX, 1.15, 0.0), 0.017, 'skeleton', 'skeletal', 'Humerus');
    addCapsule(bone1, P(s * EX, 1.14, 0.0), P(s * WX, 0.92, 0.005), 0.012, 'skeleton', 'skeletal', 'Radius');
    addCapsule(bone1, P(s * EX, 1.14, -0.008), P(s * WX, 0.92, -0.005), 0.011, 'skeleton', 'skeletal', 'Ulna');
    addSphere(bone1, P(s * WX, 0.885, 0.005), 0.03, [1.15, 0.72, 0.6], 'skeleton', 'skeletal', 'Carpals');
    addCapsule(bone1, P(s * WX, 0.855, 0.01), P(s * WX, 0.775, 0.01), 0.0085, 'skeleton', 'skeletal', 'Phalanx');
    addCapsule(bone1, P(s * WX, 0.775, 0.01), P(s * WX, 0.715, 0.01), 0.0075, 'skeleton', 'skeletal', 'Phalanx');
    addCapsule(bone1, P(s * WX, 0.855, 0.022), P(s * WX, 0.78, 0.022), 0.008, 'skeleton', 'skeletal', 'Phalanx');
    addCapsule(bone1, P(s * WX, 0.855, 0.034), P(s * WX, 0.79, 0.034), 0.0075, 'skeleton', 'skeletal', 'Phalanx');
    addCapsule(bone1, P(s * (WX + 0.012), 0.85, 0.042), P(s * (WX + 0.015), 0.79, 0.045), 0.007, 'skeleton', 'skeletal', 'Phalanx');
    addCapsule(bone1, P(s * WX, 0.86, 0.02), P(s * (WX - 0.028), 0.84, 0.03), 0.008, 'skeleton', 'skeletal', 'Thumb');
  });

  const HX = 0.085, KX = 0.09, AX = 0.085;
  both(s => {
    addSphere(bone1, P(s * HX, 0.87, 0.0), 0.022, null, 'skeleton', 'skeletal', 'Femur head');
    addCapsule(bone0, P(s * HX, 0.87, 0.0), P(s * KX, 0.44, 0.0), 0.021, 'skeleton', 'skeletal', 'Femur');
    addSphere(bone1, P(s * KX, 0.44, 0.035), 0.018, null, 'skeleton', 'skeletal', 'Patella');
    addCapsule(bone0, P(s * KX, 0.43, 0.0), P(s * AX, 0.08, 0.0), 0.016, 'skeleton', 'skeletal', 'Tibia');
    addCapsule(bone1, P(s * KX, 0.42, -0.014), P(s * AX, 0.1, -0.012), 0.008, 'skeleton', 'skeletal', 'Fibula');
    addSphere(bone1, P(s * AX, 0.042, -0.02), 0.03, null, 'skeleton', 'skeletal', 'Heel');
    addBox(bone0, P(s * AX, 0.032, 0.055), [0.075, 0.028, 0.19], 'skeleton', 'skeletal', 'Foot');
    addCapsule(bone1, P(s * AX, 0.035, 0.105), P(s * AX, 0.02, 0.15), 0.013, 'skeleton', 'skeletal', 'Toe');
    addCapsule(bone1, P(s * (AX + 0.014), 0.035, 0.105), P(s * (AX + 0.016), 0.02, 0.15), 0.011, 'skeleton', 'skeletal', 'Toe');
    addCapsule(bone1, P(s * (AX - 0.014), 0.035, 0.105), P(s * (AX - 0.016), 0.02, 0.15), 0.011, 'skeleton', 'skeletal', 'Toe');
  });

  // ============================================================ MUSCLES
  const musc0 = mat(0xa4504b, { roughness: 0.8, bump: 'striate', bumpScale: 0.05 });
  const musc1 = mat(0x98453f, { roughness: 0.82, bump: 'striate', bumpScale: 0.05 });
  const musc2 = mat(0xb15a53, { roughness: 0.78, bump: 'striate', bumpScale: 0.05 });

  addSphere(musc2, P(0, 1.47, 0.02), 0.06, [1.55, 0.7, 0.62], 'muscles', 'muscular', 'Trapezius');
  addCapsule(musc1, P(0, 1.52, 0.01), P(0, 1.46, 0.03), 0.03, 'muscles', 'muscular', 'Neck muscles');

  both(s => {
    addSphere(musc1, P(s * 0.175, 1.44, 0.035), 0.052, [1.0, 1.2, 1.05], 'muscles', 'muscular', 'Deltoid');
    addSphere(musc0, P(s * 0.095, 1.315, 0.095), 0.084, [1.18, 0.95, 0.4], 'muscles', 'muscular', 'Pectoralis');
    addSphere(musc1, P(s * 0.16, 1.14, 0.02), 0.05, [0.4, 1.25, 1.35], 'muscles', 'muscular', 'Obliques');
    addSphere(musc1, P(s * 0.115, 1.3, -0.09), 0.06, [1.15, 1.6, 0.32], 'muscles', 'muscular', 'Latissimus dorsi');
    addSphere(musc2, P(s * 0.1, 0.98, -0.06), 0.072, [1.3, 1.15, 1.2], 'muscles', 'muscular', 'Gluteus maximus');
    // intercostals between ribs
    for (let j = 0; j < 3; j++) {
      addSphere(musc1, P(s * 0.13, 1.17 + j * 0.06, 0.005), 0.026, [0.45, 0.85, 1.9], 'muscles', 'muscular', 'Intercostal muscle');
    }
  });

  for (let i = 0; i < 5; i++) {
    addBox(musc0, P(0, 1.07 + i * 0.048, 0.13 - i * 0.004), [0.052, 0.04, 0.02], 'muscles', 'muscular', 'Abdominals', [0.06, 0, 0]);
  }

  both(s => {
    addCapsule(musc0, P(s * 0.085, 0.86, 0.0), P(s * 0.09, 0.46, 0.005), 0.052, 'muscles', 'muscular', 'Quadriceps');
    addCapsule(musc1, P(s * 0.085, 0.85, -0.02), P(s * 0.09, 0.47, -0.015), 0.046, 'muscles', 'muscular', 'Hamstrings');
    addCapsule(musc1, P(s * 0.085, 0.86, 0.012), P(s * 0.09, 0.42, 0.02), 0.02, 'muscles', 'muscular', 'Adductors');
    addCapsule(musc2, P(s * 0.09, 0.41, 0.005), P(s * 0.085, 0.13, 0.005), 0.034, 'muscles', 'muscular', 'Gastrocnemius');
    addCapsule(musc1, P(s * 0.09, 0.38, -0.01), P(s * 0.085, 0.12, -0.008), 0.023, 'muscles', 'muscular', 'Soleus');
    addCapsule(musc1, P(s * 0.185, 1.36, 0.02), P(s * 0.21, 1.17, 0.0), 0.027, 'muscles', 'muscular', 'Biceps brachii');
    addCapsule(musc2, P(s * 0.185, 1.38, -0.01), P(s * 0.21, 1.16, -0.01), 0.028, 'muscles', 'muscular', 'Triceps');
    addCapsule(musc0, P(s * 0.21, 1.15, 0.0), P(s * 0.23, 0.94, 0.0), 0.022, 'muscles', 'muscular', 'Forearm flexors');
  });

  // ============================================================ ORGANS
  const lungMat = mat(0xf0a5b5, { roughness: 0.58, bump: 'speckle', bumpScale: 0.015 });
  const liverMat = mat(0x87342a, { roughness: 0.55, metalness: 0.05, bump: 'speckle', bumpScale: 0.02 });
  const stomMat = mat(0xd08a8a, { roughness: 0.65 });
  const gutMat = mat(0xc99e70, { roughness: 0.65 });
  const kidMat = mat(0xa35f38, { roughness: 0.65 });
  const bladMat = mat(0xe3c17f, { roughness: 0.6 });
  const spleMat = mat(0x9a3a3f, { roughness: 0.55 });
  const pancMat = mat(0xd9a974, { roughness: 0.65 });
  const cartMat = mat(0xe6dcd0, { roughness: 0.5 });
  const ureterMat = mat(0xe8c9a3, { roughness: 0.6 });

  // heart with chambers + coronaries (beats)
  const heartMat = mat(0xc2353a, { roughness: 0.42, bump: 'speckle', bumpScale: 0.025 });
  function addHeartMesh(r, scale, pos, rot, label, delay) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), heartMat);
    m.scale.set(scale[0], scale[1], scale[2]);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) { m.rotation.z = rot[0] || 0; m.rotation.x = rot[1] || 0; }
    tag(m, 'organs', 'cardiovascular', label);
    anim.hearts.push({ mesh: m, base: m.scale.clone(), delay: delay || 0 });
    return m;
  }
  addHeartMesh(0.052, [0.92, 1.2, 0.82], [0.02, 1.155, 0.075], [0.3, -0.2], 'Heart', 0);        // left ventricle
  addHeartMesh(0.045, [1.05, 1.05, 0.8], [-0.035, 1.13, 0.075], [0.35, -0.15], 'Right ventricle', 0.03);
  addHeartMesh(0.026, [0.9, 1.15, 0.8], [0.0, 1.113, 0.075], [0.3, -0.2], 'Heart apex', 0.06);
  addHeartMesh(0.024, [0.9, 0.7, 0.7], [-0.012, 1.205, 0.062], null, 'Right atrium', 0.01);
  addHeartMesh(0.025, [0.9, 0.72, 0.72], [0.052, 1.206, 0.06], null, 'Left atrium', 0.0);

  const coronaryMat = flowMat(0xe86050, 2, 0.16, 1.0);
  both(s => addTube(coronaryMat, [P(s * 0.012, 1.18, 0.085), P(s * 0.02, 1.12, 0.09), P(s * 0.03, 1.08, 0.085)], 0.0045, 'vessels', 'cardiovascular', 'Coronary artery', 18));

  // lungs (breathe) + lobed structure
  function addLungMesh(scale, pos, label) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 28, 20), lungMat);
    m.scale.set(scale[0], scale[1], scale[2]);
    m.position.set(pos[0], pos[1], pos[2]);
    tag(m, 'organs', 'respiratory', label);
    anim.lungs.push({ mesh: m, base: m.scale.clone() });
    return m;
  }
  addLungMesh([1.5, 1.55, 0.85], [0.09, 1.28, 0.045], 'Right upper lobe');
  addLungMesh([1.35, 1.45, 0.85], [0.10, 1.195, 0.05], 'Right middle lobe');
  addLungMesh([1.6, 1.5, 0.85], [0.095, 1.10, 0.05], 'Right lower lobe');
  addLungMesh([1.5, 1.5, 0.85], [-0.075, 1.245, 0.05], 'Left upper lobe');
  addLungMesh([1.55, 1.5, 0.85], [-0.075, 1.115, 0.05], 'Left lower lobe');

  addTube(cartMat, [P(0, 1.47, 0.02), P(0, 1.38, 0.012), P(0, 1.315, 0.005)], 0.012, 'organs', 'respiratory', 'Trachea');
  addTube(cartMat, [P(0, 1.315, 0.0), P(0.045, 1.24, 0.03), P(0.08, 1.19, 0.045)], 0.0085, 'organs', 'respiratory', 'Bronchus');
  addTube(cartMat, [P(0, 1.315, 0.0), P(-0.04, 1.25, 0.03), P(-0.07, 1.2, 0.045)], 0.0085, 'organs', 'respiratory', 'Bronchus');
  addTube(cartMat, [P(0.088, 1.185, 0.05), P(0.10, 1.14, 0.05)], 0.005, 'organs', 'respiratory', 'Bronchiole');
  addTube(cartMat, [P(-0.08, 1.19, 0.05), P(-0.09, 1.14, 0.05)], 0.005, 'organs', 'respiratory', 'Bronchiole');

  // diaphragm (breathes)
  const diaMesh = new THREE.Mesh(new THREE.SphereGeometry(0.21, 32, 24), mat(0xb45a50, { roughness: 0.7, bump: 'striate', bumpScale: 0.04 }));
  diaMesh.scale.set(0.92, 0.28, 0.66);
  diaMesh.position.set(0, 1.065, 0.035);
  tag(diaMesh, 'organs', 'respiratory', 'Diaphragm');
  anim.diaphragm = { mesh: diaMesh, baseY: diaMesh.position.y };

  addTube(stomMat, [P(0, 1.44, -0.005), P(0.01, 1.28, 0.01), P(0.03, 1.13, 0.045)], 0.0075, 'organs', 'digestive', 'Esophagus');
  addSphere(stomMat, P(0.045, 1.10, 0.06), 0.05, [1.15, 1.4, 0.85], 'organs', 'digestive', 'Stomach');
  addSphere(stomMat, P(0.07, 1.16, 0.05), 0.042, [0.9, 1.6, 0.85], 'organs', 'digestive', 'Stomach fundus');
  addSphere(liverMat, P(0.12, 1.15, 0.055), 0.095, [1.25, 0.62, 0.78], 'organs', 'digestive', 'Liver');
  addSphere(liverMat, P(0.16, 1.08, 0.05), 0.045, [1.0, 0.9, 0.8], 'organs', 'digestive', 'Liver lobe');
  addSphere(bladMat, P(0.165, 1.055, 0.07), 0.02, null, 'organs', 'digestive', 'Gallbladder');
  addSphere(spleMat, P(-0.09, 1.16, 0.01), 0.05, [0.7, 1.0, 0.5], 'organs', 'digestive', 'Spleen');
  addSphere(pancMat, P(0.0, 1.15, 0.005), 0.035, [2.2, 0.6, 0.6], 'organs', 'digestive', 'Pancreas');

  for (let i = 0; i < 6; i++) {
    const y = 1.045 + Math.floor(i / 2) * 0.04 + (i % 2) * 0.02;
    const r = 0.034 + (i % 3) * 0.005;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.013, 8, 24), gutMat);
    ring.position.set(0.0, y, 0.06);
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(i % 2 ? 1.25 : 1.0, 1, i % 2 ? 0.9 : 1.1);
    tag(ring, 'organs', 'digestive', 'Small intestine');
  }
  addTube(gutMat, [
    P(0.105, 1.12, 0.045), P(0.12, 1.05, 0.06), P(0.11, 0.99, 0.05),
    P(0.06, 0.985, 0.055), P(0.0, 1.0, 0.06), P(-0.06, 1.015, 0.055),
    P(-0.10, 1.06, 0.04),
  ], 0.014, 'organs', 'digestive', 'Large intestine');

  both(s => {
    addSphere(kidMat, P(s * 0.075, 1.10, -0.03), 0.045, [1.15, 1.5, 0.75], 'organs', 'urinary', 'Kidney');
    addSphere(kidMat, P(s * 0.09, 1.10, -0.032), 0.02, null, 'organs', 'urinary', 'Kidney');
  });
  addSphere(bladMat, P(0, 0.945, 0.035), 0.028, [1.05, 1.1, 1.0], 'organs', 'urinary', 'Bladder');

  // ============================================================ NERVOUS
  const brainMat = mat(0xe8a9bd, { roughness: 0.5, bump: 'speckle', bumpScale: 0.03 });
  const nerveMat = mat(0xf2c14e, { roughness: 0.55 });
  const nerveFlow = flowMat(0xffd75e, 2, 0.34, 1.1);

  const hemiGeo = brainNoise(new THREE.IcosahedronGeometry(1, 5));
  both(s => {
    const g = hemiGeo.clone();
    const m = new THREE.Mesh(g, brainMat);
    m.scale.set(0.086, 0.096, 0.082);
    m.position.set(0.052 * s, 1.605, 0.0);
    tag(m, 'nervous', 'nervous', 'Brain');
  });
  addSphere(brainMat, P(0, 1.578, -0.03), 0.047, [1.0, 0.8, 0.75], 'nervous', 'nervous', 'Cerebellum');
  addCapsule(brainMat, P(0, 1.515, 0.01), P(0, 1.572, 0.015), 0.016, 'nervous', 'nervous', 'Brain stem');

  const cordPts = [P(0, 1.515, 0.01), ...spine.slice(0, 13).map(([y, z]) => P(0, y, z - 0.003))];
  const cord = addTube(nerveFlow, cordPts, 0.016, 'nervous', 'nervous', 'Spinal cord');

  both(s => {
    addTube(nerveFlow, [P(0, 1.475, 0.02), P(s * 0.14, 1.44, 0.03), P(s * 0.2, 1.2, 0.0), P(s * 0.225, 0.95, 0.0)], 0.0065, 'nervous', 'nervous', 'Brachial plexus');
    addTube(nerveFlow, [P(0, 1.1, -0.02), P(s * 0.06, 1.0, -0.02), P(s * 0.085, 0.6, 0.0), P(s * 0.085, 0.18, 0.0)], 0.007, 'nervous', 'nervous', 'Sciatic nerve');
    addTube(nerveMat, [P(0, 1.42, 0.005), P(s * 0.09, 1.3, -0.02), P(s * 0.14, 1.16, -0.03)], 0.0045, 'nervous', 'nervous', 'Intercostal nerve');
    addTube(nerveFlow, [P(0, 1.6, 0.02), P(s * 0.045, 1.615, 0.03)], 0.0045, 'nervous', 'nervous', 'Facial nerve');
  });

  // ============================================================ VESSELS (fluid flow)
  const artMat = flowMat(0xe64a3a, 3, -0.12, 1.15);
  const artThin = mat(0xe05a4a, { roughness: 0.5 });
  const veinMat = flowMat(0x3f5fd0, 3, 0.1, 1.05);
  const veinThin = mat(0x4a68c8, { roughness: 0.5 });

  addTube(artMat, [
    P(0.02, 1.26, 0.085), P(0.005, 1.36, 0.07), P(-0.01, 1.415, 0.02),
    P(0.0, 1.38, -0.03), P(0.04, 1.22, -0.05), P(0.02, 1.05, -0.07),
    P(0.06, 0.98, -0.04), P(0.0, 0.97, -0.045),
  ], 0.016, 'vessels', 'cardiovascular', 'Aorta');
  addTube(artMat, [P(0.0, 1.38, -0.03), P(0.1, 1.36, -0.03), P(0.17, 1.26, -0.03)], 0.011, 'vessels', 'cardiovascular', 'Aortic arch');
  both(s => addTube(artMat, [P(s * 0.01, 1.42, 0.01), P(s * 0.03, 1.48, 0.0), P(s * 0.045, 1.58, 0.02)], 0.006, 'vessels', 'cardiovascular', 'Carotid artery'));
  both(s => addTube(artMat, [P(s * 0.02, 1.39, 0.0), P(s * 0.14, 1.42, -0.005), P(s * 0.2, 1.3, -0.01), P(s * 0.22, 0.96, -0.005)], 0.0075, 'vessels', 'cardiovascular', 'Subclavian artery'));
  both(s => addTube(artMat, [P(s * 0.045, 0.98, -0.03), P(s * 0.085, 0.85, -0.01), P(s * 0.09, 0.5, 0.0), P(s * 0.09, 0.15, 0.0)], 0.007, 'vessels', 'cardiovascular', 'Femoral artery'));
  addTube(artThin, [P(0.02, 1.26, 0.1), P(0.06, 1.24, 0.09), P(0.095, 1.21, 0.07)], 0.01, 'vessels', 'cardiovascular', 'Pulmonary artery');
  addTube(veinThin, [P(0.03, 1.24, 0.12), P(0.01, 1.38, 0.1), P(0.0, 1.5, 0.05)], 0.013, 'vessels', 'cardiovascular', 'Superior vena cava');
  addTube(veinThin, [P(0.03, 1.22, 0.11), P(0.02, 1.05, 0.04), P(0.01, 0.97, 0.0)], 0.012, 'vessels', 'cardiovascular', 'Inferior vena cava');
  both(s => addTube(veinMat, [P(s * 0.005, 1.52, 0.04), P(s * 0.035, 1.5, 0.03), P(s * 0.05, 1.42, 0.025)], 0.0055, 'vessels', 'cardiovascular', 'Jugular vein'));
  both(s => addTube(veinMat, [P(s * 0.02, 1.4, 0.02), P(s * 0.15, 1.38, 0.01), P(s * 0.2, 1.15, 0.0), P(s * 0.215, 0.95, 0.0)], 0.0065, 'vessels', 'cardiovascular', 'Cephalic vein'));
  both(s => addTube(veinMat, [P(s * 0.01, 0.97, 0.0), P(s * 0.085, 0.84, 0.0), P(s * 0.088, 0.4, 0.0), P(s * 0.086, 0.12, 0.0)], 0.0065, 'vessels', 'cardiovascular', 'Femoral vein'));

  // ============================================================ EXTRAS (density)
  // eyes (special senses)
  const eyeWhite = mat(0xf2efe8, { roughness: 0.22 });
  const irisMat = mat(0x5a8fd0, { roughness: 0.5 });
  const pupilMat = mat(0x171a22, { roughness: 0.25 });
  both(s => {
    addSphere(eyeWhite, P(s * 0.032, 1.648, 0.078), 0.026, [1, 1.05, 1.02], 'organs', 'nervous', 'Eye');
    addSphere(irisMat, P(s * 0.032, 1.648, 0.09), 0.0125, [1, 1, 0.42], 'organs', 'nervous', 'Iris');
    addSphere(pupilMat, P(s * 0.032, 1.648, 0.098), 0.005, null, 'organs', 'nervous', 'Pupil');
  });

  // kidneys: adrenals + ureters + bladder outlet
  both(s => {
    addSphere(kidMat, P(s * 0.075, 1.165, -0.032), 0.014, [1, 1.3, 1], 'organs', 'urinary', 'Adrenal gland');
    addTube(ureterMat, [P(s * 0.075, 1.02, -0.025), P(s * 0.05, 0.99, -0.005), P(s * 0.018, 0.968, 0.02)], 0.0045, 'organs', 'urinary', 'Ureter');
    addTube(artThin, [P(0.02, 1.07, -0.06), P(s * 0.06, 1.085, -0.04), P(s * 0.074, 1.095, -0.03)], 0.004, 'vessels', 'cardiovascular', 'Renal artery');
    addTube(veinThin, [P(0.045, 1.06, -0.065), P(s * 0.05, 1.0, -0.05), P(s * 0.072, 0.975, -0.035)], 0.0045, 'vessels', 'cardiovascular', 'Renal vein');
  });
  addTube(ureterMat, [P(0, 0.94, 0.035), P(0, 0.9, 0.028), P(0, 0.845, 0.025)], 0.004, 'organs', 'urinary', 'Urethra');

  // more intestinal coils + sigmoid colon
  for (let i = 0; i < 4; i++) {
    const y = 0.975 - i * 0.022;
    const r = 0.028 + (i % 2) * 0.005;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.011, 8, 24), gutMat);
    ring.position.set(0.035, y, 0.07);
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(1.2 + (i % 2) * 0.15, 1, 1.05);
    tag(ring, 'organs', 'digestive', 'Small intestine');
  }
  addTube(gutMat, [
    P(0.105, 0.99, 0.05), P(0.125, 0.93, 0.055), P(0.10, 0.895, 0.08),
    P(0.05, 0.885, 0.095), P(0.0, 0.905, 0.10), P(-0.035, 0.93, 0.09),
  ], 0.012, 'organs', 'digestive', 'Sigmoid colon');
  addSphere(gutMat, P(0, 0.9, 0.11), 0.016, [1.4, 1, 0.8], 'organs', 'digestive', 'Rectum');

  // pulmonary veins draining into the left atrium
  both(s => {
    addTube(veinThin, [P(s * 0.082, 1.235, 0.07), P(s * 0.055, 1.225, 0.07), P(s * 0.04, 1.212, 0.068)], 0.005, 'vessels', 'cardiovascular', 'Pulmonary vein');
    addTube(veinThin, [P(s * 0.072, 1.17, 0.08), P(s * 0.042, 1.19, 0.075), P(s * 0.035, 1.198, 0.07)], 0.0045, 'vessels', 'cardiovascular', 'Pulmonary vein');
  });

  return { body, meshList, layers, anim };
}