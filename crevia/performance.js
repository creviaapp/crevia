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

  document.querySelectorAll('img:not([loading])').forEach((image) => {
    const inViewport = image.getBoundingClientRect().top < window.innerHeight * 1.25;
    if (!inViewport) image.loading = 'lazy';
    image.decoding = 'async';
  });

  if (!reduceMotion) {
    document.documentElement.classList.add('performance-ready');
  }
})();
