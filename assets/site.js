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

  // Two separate reading controls. On wide screens they hide/show fixed sidebars;
  // on tablets and phones they open accessible navigation drawers.
  const rails = {
    left: document.querySelector('.left-rail, .collection-rail'),
    right: document.querySelector('.right-rail')
  };
  const toggles = {
    left: document.querySelector('[data-rail-toggle="left"]'),
    right: document.querySelector('[data-rail-toggle="right"]')
  };
  for (const kind of ['left','right']) {
    if (rails[kind] && toggles[kind]) {
      toggles[kind].classList.add('enabled');
      // This section never needs to be reached through a visible file tree.
      if (!rails[kind].id) rails[kind].id = kind + '-navigation';
    }
  }
  const tablet = window.matchMedia('(max-width: 1199px)');
  const closeDrawers = () => {
    Object.values(rails).forEach(r => r?.classList.remove('open'));
    document.body.classList.remove('drawer-open');
    Object.values(toggles).forEach(b => b?.setAttribute('aria-expanded','false'));
  };
  const updateDesktopButtons = () => {
    if (tablet.matches) {closeDrawers(); return;}
    closeDrawers();
    for(const kind of ['left','right']) {
      if (rails[kind] && toggles[kind])
        toggles[kind].setAttribute('aria-expanded',String(!document.body.classList.contains('rail-'+kind+'-hidden')));
    }
  };
  for(const kind of ['left','right']) {
    toggles[kind]?.addEventListener('click', () => {
      if (tablet.matches) {
        const wasOpen=rails[kind]?.classList.contains('open');
        closeDrawers();
        if (!wasOpen && rails[kind]) {
          rails[kind].classList.add('open');
          document.body.classList.add('drawer-open');
          toggles[kind].setAttribute('aria-expanded','true');
        }
      } else {
        const cls='rail-'+kind+'-hidden';
        document.body.classList.toggle(cls);
        try {localStorage.setItem('ml-'+cls, document.body.classList.contains(cls)?'1':'0');} catch(_) {}
        updateDesktopButtons();
      }
    });
  }
  for (const kind of ['left','right']) {
    try {if (localStorage.getItem('ml-rail-'+kind+'-hidden')==='1')document.body.classList.add('rail-'+kind+'-hidden');} catch(_) {}
  }
  document.querySelector('[data-rail-dismiss]')?.addEventListener('click',closeDrawers);
  Object.values(rails).forEach(r=>r?.addEventListener('click',e=>{if(e.target.closest('a'))closeDrawers();}));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawers();});
  tablet.addEventListener?.('change',updateDesktopButtons);
  updateDesktopButtons();

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
