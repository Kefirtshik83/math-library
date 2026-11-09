(function () {
  const root = document.documentElement;
  const key = 'mathematical-library-theme';
  try { const saved = localStorage.getItem(key); if (saved === 'dark' || saved === 'light') root.dataset.theme = saved; } catch(_) {}
  const themeBtn = document.querySelector('[data-theme-toggle]');
  const updateThemeButton = () => { if (themeBtn) { const dark = root.dataset.theme === 'dark'; themeBtn.textContent = dark ? '☀' : '☾'; themeBtn.setAttribute('aria-label', dark ? 'Светлая тема' : 'Тёмная тема'); themeBtn.title = dark ? 'Светлая тема' : 'Тёмная тема'; } };
  updateThemeButton();
  if (themeBtn) themeBtn.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(key, root.dataset.theme); } catch(_) {}
    updateThemeButton();
  });

  const navButton = document.querySelector('[data-nav-toggle]');
  const leftRail = document.querySelector('.left-rail');
  if (navButton && leftRail) navButton.addEventListener('click', () => {
    const open = leftRail.classList.toggle('open');
    navButton.setAttribute('aria-expanded', String(open));
  });

  const progress = document.querySelector('.progress');
  if (progress) {
    let scheduled = false;
    const update = () => {
      const height = document.documentElement.scrollHeight - innerHeight;
      const amount = height > 0 ? Math.min(1, Math.max(0, scrollY / height)) : 0;
      progress.style.transform = `scaleX(${amount})`;
      scheduled = false;
    };
    window.addEventListener('scroll', () => { if (!scheduled) { requestAnimationFrame(update); scheduled = true; } }, {passive:true});
    window.addEventListener('resize', update);
    update();
  }
  // Direct links and TOC navigation must reveal headings inside folded proofs.
  const revealProof = (hash) => {
    if (!hash || hash === '#') return;
    let id;
    try { id = decodeURIComponent(hash.slice(1)); } catch (_) { return; }
    const target = document.getElementById(id);
    if (!target) return;
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      if (parent.matches('details.proof-fold')) parent.open = true;
    }
  };
  revealProof(window.location.hash);
  window.addEventListener('hashchange', () => revealProof(window.location.hash));
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', () => revealProof(anchor.hash));
  });
  const tocAnchors = [...document.querySelectorAll('.right-toc a[href^="#"]')];
  const headings = tocAnchors.map(a => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean);
  if (headings.length) {
    const mark = () => {
      let current = headings[0].id;
      for (const h of headings) if (h.getBoundingClientRect().top < 160) current = h.id;
      for (const a of tocAnchors) a.classList.toggle('toc-current', a.hash === '#' + current);
    };
    window.addEventListener('scroll', mark, {passive:true}); mark();
  }
})();
