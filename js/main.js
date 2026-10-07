import { init } from './app.js';

const boot = {
  show(err) {
    const wrap = document.getElementById('boot-error');
    const msg = document.getElementById('boot-msg');
    const bar = document.getElementById('load-bar');
    const text = document.getElementById('load-text');
    if (wrap) { wrap.classList.remove('hidden'); if (msg) msg.textContent = (err && (err.message || err.stack || String(err))) || 'Unknown error'; }
    if (bar) bar.style.width = '100%';
    if (text) text.textContent = 'startup failed';
  },
};

window.addEventListener('error', (e) => boot.show(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => boot.show(e.reason));

document.addEventListener('DOMContentLoaded', () => {
  try { init(document.body); }
  catch (err) { boot.show(err); }
});