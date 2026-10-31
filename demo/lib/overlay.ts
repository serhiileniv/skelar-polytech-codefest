// Injected into every page: a visible cursor, a click ripple, and a body zoom helper.
// The cursor lives on <html>, outside <body>, so zooming <body> never scales or shifts it.
export const OVERLAY_SCRIPT = String.raw`(() => {
  if (window.__demo) return;
  const ARROW = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2.5 L4 19.5 L8.6 15.3 L11.6 22 L14.5 20.7 L11.6 14.2 L18 14.2 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const css = document.createElement('style');
  css.textContent = [
    '#__demo_cursor{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);filter:drop-shadow(0 3px 6px rgba(0,0,0,.35));transition:opacity .2s}',
    '.__demo_ripple{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;z-index:2147483646;pointer-events:none;background:rgba(99,102,241,.35);border:2px solid rgba(99,102,241,.9);animation:__demo_rip .55s ease-out forwards}',
    '@keyframes __demo_rip{from{transform:scale(.6);opacity:1}to{transform:scale(4.2);opacity:0}}',
    'body.__demo_zooming{transition:transform .9s cubic-bezier(.65,0,.35,1);will-change:transform}',
    'html{scroll-behavior:auto}',
    'nextjs-portal{display:none!important}',
  ].join('\n');
  const cursor = document.createElement('div');
  cursor.id = '__demo_cursor';
  cursor.innerHTML = ARROW;
  const mount = () => {
    if (!css.isConnected) document.documentElement.appendChild(css);
    if (!cursor.isConnected) document.documentElement.appendChild(cursor);
  };
  setInterval(mount, 250);
  document.addEventListener('DOMContentLoaded', mount);
  window.addEventListener('mousemove', (e) => {
    cursor.style.transform = 'translate(' + (e.clientX - 4) + 'px,' + (e.clientY - 2) + 'px)';
  }, true);
  window.addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.className = '__demo_ripple';
    r.style.left = e.clientX + 'px';
    r.style.top = e.clientY + 'px';
    document.documentElement.appendChild(r);
    setTimeout(() => r.remove(), 700);
  }, true);
  window.__demo = {
    // Zoom <body> so that rect (viewport coords) is centred, clamped to page edges.
    zoom(rect, scale) {
      const b = document.body, W = innerWidth, H = innerHeight;
      const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
      const tx = Math.min(0, Math.max(W - scale * W, W / 2 - scale * cx));
      const ty = Math.min(0, Math.max(H - scale * H, H / 2 - scale * cy));
      b.classList.add('__demo_zooming');
      b.style.transformOrigin = '0 0';
      b.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    },
    unzoom() {
      const b = document.body;
      b.style.transform = 'translate(0px,0px) scale(1)';
      setTimeout(() => { b.style.transform = ''; b.classList.remove('__demo_zooming'); }, 950);
    },
  };
})();`;
