// Daylight / dark mode. Loaded in <head> so the saved theme is applied before the page paints.
// Default is dark (the brand look); the choice is remembered per browser.
const THEME = (() => {
  const KEY = 'tradev_theme';
  let theme = 'dark';
  try { theme = localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch {}
  document.documentElement.dataset.theme = theme;

  function paint() {
    document.documentElement.dataset.theme = theme;
    if (typeof paintAccent === 'function') paintAccent();
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = theme === 'light' ? '#f3f7f5' : '#061513';
    document.querySelectorAll('[data-theme-switch]').forEach((b) => {
      const next = theme === 'light' ? 'dark' : 'light';
      b.innerHTML = window.icon ? icon(theme === 'light' ? 'moon' : 'sun') : '';
      b.title = next === 'light' ? 'Daylight mode' : 'Dark mode';
      b.setAttribute('aria-label', b.title);
    });
  }

  function set(next) {
    theme = next === 'light' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, theme); } catch {}
    paint();
    window.dispatchEvent(new Event('tv:theme')); // charts re-read their colours
  }

  function mount() {
    document.querySelectorAll('[data-theme-switch]').forEach((b) => {
      if (b.dataset.ready) return;
      b.dataset.ready = '1';
      b.type = 'button';
      b.classList.add('btn', 'btn-icon', 'theme-btn');
      b.addEventListener('click', () => set(theme === 'light' ? 'dark' : 'light'));
    });
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  // ---- brand colour (admin: System settings → Theme colour) ----
  // From one hex colour derive: button fill, text/icon colour readable on the current background,
  // and dark or white text on buttons. Cached so the next page load paints it before the network answers.
  const ACCENT_KEY = 'tradev_accent';
  let accent = null;
  try { accent = localStorage.getItem(ACCENT_KEY); } catch {}
  const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const mix = (rgb, to, t) => rgb.map((v, i) => v + (to[i] - v) * t);
  function readableOn(rgb, bg) { // nudge toward white/black until text contrast >= 4.5
    const target = lum(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
    let c = rgb;
    for (let t = 0; t <= 1 && contrast(c, bg) < 4.5; t += 0.05) c = mix(rgb, target, t);
    return c;
  }
  function paintAccent() {
    const st = document.documentElement.style;
    if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) { ['--accent', '--accent-btn', '--on-accent', '--accent-rgb'].forEach((k) => st.removeProperty(k)); return; }
    const rgb = hexToRgb(accent);
    const bg = theme === 'light' ? [255, 255, 255] : [15, 37, 34];
    st.setProperty('--accent-btn', accent);
    st.setProperty('--accent-rgb', rgb.join(', '));
    st.setProperty('--accent', toHex(readableOn(rgb, bg)));
    st.setProperty('--on-accent', contrast(rgb, [255, 255, 255]) >= contrast(rgb, [2, 35, 19]) ? '#ffffff' : '#0b1a14');
  }
  function setAccent(hex) {
    accent = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex.toLowerCase() : null;
    try { if (accent) localStorage.setItem(ACCENT_KEY, accent); else localStorage.removeItem(ACCENT_KEY); } catch {}
    paintAccent();
    window.dispatchEvent(new Event('tv:theme'));
  }
  paintAccent();
  // Both apps pick up the admin's choice from the public settings.
  fetch('/api/settings').then((r) => r.json()).then((s) => { if (s && 'theme_color' in s && s.theme_color !== accent) setAccent(s.theme_color); }).catch(() => {});

  // Read a CSS custom property (used by the canvas chart).
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return { set, css, setAccent, get theme() { return theme; }, get accent() { return accent; } };
})();
window.THEME = THEME;
