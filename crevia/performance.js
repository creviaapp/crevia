(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const prefetched = new Set();

  const prefetch = (href) => {
    if (!href || prefetched.has(href) || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    prefetched.add(href);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'document';
    link.href = url.href;
    document.head.appendChild(link);
  };

  document.querySelectorAll('a[href]').forEach((link) => {
    link.addEventListener('pointerenter', () => prefetch(link.href), { passive: true, once: true });
    link.addEventListener('focus', () => prefetch(link.href), { passive: true, once: true });
  });

  const connection = navigator.connection;
  const saveData = Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType || '');

  document.querySelectorAll('img').forEach((image, index) => {
    const inViewport = image.getBoundingClientRect().top < window.innerHeight * 1.25;
    if (!image.hasAttribute('loading') && (!inViewport || index > 1)) image.loading = 'lazy';
    image.decoding = 'async';
    if (saveData && !inViewport) image.fetchPriority = 'low';
  });

  if (!reduceMotion) document.documentElement.classList.add('performance-ready');
  document.documentElement.classList.toggle('save-data', saveData);

  const polishStyles = document.createElement('style');
  polishStyles.textContent = `
    :focus-visible { outline: 2px solid #f0782f; outline-offset: 4px; }
    html { text-rendering: optimizeLegibility; }
    img { max-width: 100%; }
    @media (hover: none) { :where(a, button):hover { transform: none !important; } }
    @media (max-width: 767px) { :where(h1, h2, h3) { text-wrap: balance; } body { overflow-x: hidden; } }
  `;
  document.head.appendChild(polishStyles);
})();
