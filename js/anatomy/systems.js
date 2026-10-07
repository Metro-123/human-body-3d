/* Anatomical system + layer definitions, isolation modes, X-ray & transparency semantics. DOM-free. */

import { classifySystem as _classify } from './anatomy.js';

export const GROUPS = {
  skin: { label: 'Integumentary', color: '#e8b08a', group: 'zskin.glb', alias: 'skin' },
  skeleton: { label: 'Skeletal', color: '#e6dcc3', group: ['zskeleton.p1.glb', 'zskeleton.p2.glb', 'zskeleton.p3.glb', 'zskeleton.p4.glb'], alias: 'skeleton' },
  joints: { label: 'Joints & Cartilage', color: '#cfc6ff', group: 'zjoints.glb', alias: 'joints' },
  muscles: { label: 'Muscular', color: '#c0553a', group: ['zmuscles.p1.glb', 'zmuscles.p2.glb', 'zmuscles.p3.glb', 'zmuscles.p4.glb'], alias: 'muscles' },
  organs: { label: 'Visceral (Organs)', color: '#b07b9e', group: ['zviscera.p1.glb', 'zviscera.p2.glb'], alias: 'organs' },
  vessels: { label: 'Cardiovascular', color: '#a02c2c', group: ['zcardio.p1.glb', 'zcardio.p2.glb', 'zcardio.p3.glb', 'zcardio.p4.glb'], alias: 'vessels' },
  nervous: { label: 'Nervous', color: '#cfb787', group: ['znervous.p1.glb', 'znervous.p2.glb', 'znervous.p3.glb', 'znervous.p4.glb', 'znervous.p5.glb'], alias: 'nervous' },
  lymphatic: { label: 'Lymphatic', color: '#8fb08f', group: 'zlymphoid.glb', alias: 'lymphatic' },
  'female-skin': { label: 'Integumentary (F)', color: '#e8b08a', group: 'female-skin.glb', alias: 'female-skin' },
  'female-skeleton': { label: 'Skeletal (F)', color: '#e6dcc3', group: 'female-skeleton.glb', alias: 'female-skeleton' },
  'female-organs': { label: 'Visceral (F)', color: '#b07b9e', group: ['female-organs.p1.glb', 'female-organs.p2.glb'], alias: 'female-organs' },
  'female-vessels': { label: 'Cardiovascular (F)', color: '#a04a4a', group: 'female-vessels.glb', alias: 'female-vessels' },
  'female-nervous': { label: 'Nervous (F)', color: '#cfb787', group: 'female-nervous.glb', alias: 'female-nervous' },
};

/* System definition (extends model groups with anatomical sub-systems) */
export const SYSTEMS = [
  { id: 'skeletal', name: 'Skeletal', icon: '🦴', desc: 'Bones, joints and cartilage.', violet: '#e6dcc3', groups: ['skeleton', 'joints'] },
  { id: 'muscular', name: 'Muscular', icon: '💪', desc: 'Skeletal muscles and tendons.', violet: '#c0553a', groups: ['muscles'] },
  { id: 'cardiovascular', name: 'Cardiovascular', icon: '🫀', desc: 'Heart, arteries and veins.', violet: '#c33a3a', groups: ['vessels'] },
  { id: 'nervous', name: 'Nervous', icon: '🧠', desc: 'Brain, spinal cord and peripheral nerves.', violet: '#cfb787', groups: ['nervous'] },
  { id: 'respiratory', name: 'Respiratory', icon: '🫁', desc: 'Lungs, trachea and bronchi.', violet: '#c77c9a', groups: ['organs'] },
  { id: 'digestive', name: 'Digestive', icon: '🌿', desc: 'Esophagus, stomach, intestines, liver, pancreas, gallbladder.', violet: '#8f9a5a', groups: ['organs'] },
  { id: 'urinary', name: 'Urinary', icon: '🫘', desc: 'Kidneys, ureters and bladder.', violet: '#b0743a', groups: ['organs'] },
  { id: 'reproductive', name: 'Reproductive', icon: '🔴', desc: 'Reproductive organs.', violet: '#a06a80', groups: ['organs'] },
  { id: 'endocrine', name: 'Endocrine', icon: '🔬', desc: 'Glands that produce hormones.', violet: '#c99b57', groups: ['organs', 'nervous'] },
  { id: 'lymphatic', name: 'Lymphatic', icon: '🩶', desc: 'Lymph nodes and vessels.', violet: '#8fb08f', groups: ['lymphatic'] },
  { id: 'integumentary', name: 'Integumentary', icon: '🧑', desc: 'Skin and body surface.', violet: '#e8b08a', groups: ['skin'] },
];

export const GROUP_BY_ALIAS = {};
for (const [k, v] of Object.entries(GROUPS)) GROUP_BY_ALIAS[v.alias] = k;

/* Structure -> system (best-effort; fallback from structure.system) */
export function systemGroupsFor(systemId) {
  const sys = SYSTEMS.find((s) => s.id === systemId);
  return sys ? sys.groups : [];
}

/* Authoritative system for each GLB group (the Z-Anatomy file separation is trusted).
 * 'organs'/'female-organs' is heterogeneous -> keyword classification refines; may still be 'unknown'. */
export function hintForGroup(group) {
  return {
    skin: 'integumentary',
    skeleton: 'skeletal',
    joints: 'skeletal',
    muscles: 'muscular',
    vessels: 'cardiovascular',
    nervous: 'nervous',
    lymphatic: 'lymphatic',
    'female-skin': 'integumentary',
    'female-skeleton': 'skeletal',
    'female-vessels': 'cardiovascular',
    'female-nervous': 'nervous',
    organs: null,
    'female-organs': null,
  }[group] || null;
}

/* Which body a group belongs to, and each body's group set. */
export const BODY_OF = {};
export const BODIES = {
  male: ['skin', 'skeleton', 'joints', 'muscles', 'organs', 'vessels', 'nervous', 'lymphatic'],
  female: ['female-skin', 'female-skeleton', 'female-organs', 'female-vessels', 'female-nervous'],
};
for (const [b, keys] of Object.entries(BODIES)) for (const k of keys) BODY_OF[k] = b;

/* Body-aware system membership: on the female body, muscle/lymphatic are genuinely absent
 * (the open Visible-Human female model has no muscle or lymph layer), so those systems isolate to nothing. */
export function systemGroupsForBody(body, systemId) {
  const sys = SYSTEMS.find((s) => s.id === systemId);
  if (body === 'female') {
    if (systemId === 'muscular' || systemId === 'lymphatic') return [];
    if (systemId === 'skeletal') return ['female-skeleton'];
    if (systemId === 'cardiovascular') return ['female-vessels'];
    if (systemId === 'nervous') return ['female-nervous'];
    if (systemId === 'integumentary') return ['female-skin'];
    if (sys && ['respiratory', 'digestive', 'urinary', 'reproductive', 'endocrine'].includes(systemId)) return ['female-organs'];
    return [];
  }
  return sys ? sys.groups : [];
}

/* Dissection layers, surface (index 0) to deep (last). */
export const LAYERS = [
  { id: 'surface', label: 'Surface', groups: ['skin', 'female-skin'] },
  { id: 'superficial', label: 'Superficial', groups: ['muscles'] },
  { id: 'intermediate', label: 'Intermediate', groups: ['vessels', 'lymphatic', 'female-vessels'] },
  { id: 'deep', label: 'Deep', groups: ['organs', 'female-organs'] },
  { id: 'internal', label: 'Internal', groups: ['nervous', 'skeleton', 'joints', 'female-nervous', 'female-skeleton'] },
];

/* Opacity presets (transparency engine) */
export const OPACITY_STEPS = [1, 0.75, 0.5, 0.25, 0.1, 0];
export function opacityStepLabel(v) {
  return v === 1 ? 'Opaque' : v === 0 ? 'Hidden' : Math.round(v * 100) + '%';
}

/* X-ray targets: outer tissues fade, deep stays visible */
export const XRAY_GROUP_OPACITY = {
  skin: 0.06,
  muscles: 0.1,
  organs: 0.32,
  vessels: 0.9,
  nervous: 0.9,
  skeleton: 1,
  joints: 1,
  lymphatic: 0.9,
  'female-skin': 0.06,
  'female-organs': 0.32,
  'female-vessels': 0.9,
  'female-nervous': 0.9,
  'female-skeleton': 1,
};