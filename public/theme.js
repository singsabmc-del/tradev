// Daylight / dark mode. Loaded in <head> so the saved theme is applied before the page paints.
// Default is dark (the brand look); the choice is remembered per browser.
const THEME = (() => {
  const KEY = 'tradev_theme';
  let theme = 'dark';
  try { theme = localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch {}
  document.documentElement.dataset.theme = theme;

  function paint() {
    document.documentElement.dataset.theme = theme;
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

  // Read a CSS custom property (used by the canvas chart).
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return { set, css, get theme() { return theme; } };
})();
window.THEME = THEME;
