/* global window, document */
(function(){
  // ===== Styles for palette & highlight =====
  const CSS = `
  .lsrch-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(3px);
    display:none;align-items:flex-start;justify-content:center;z-index:9999}
  .lsrch-backdrop.show{display:flex}
  .lsrch-modal{margin-top:8vh;width:min(900px,94vw);background:rgba(18,22,30,.98);
    border:1px solid rgba(255,255,255,.08);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.5);overflow:hidden}
  .lsrch-head{display:flex;align-items:center;gap:10px;padding:12px 12px 10px;border-bottom:1px solid rgba(255,255,255,.08)}
  .lsrch-input{flex:1;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.10);
    background:rgba(255,255,255,.04);color:inherit;font-size:1rem;outline:none}
  .lsrch-body{max-height:60vh;overflow:auto}
  .lsrch-item{display:grid;grid-template-columns:120px 1fr;gap:12px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.06);
    cursor:pointer}
  .lsrch-item:hover{background:rgba(255,255,255,.03)}
  .lsrch-sec{color:#c8a743;font-weight:800;font-size:.9rem}
  .lsrch-title{font-weight:800}
  .lsrch-desc{color:#9aa3b2}
  .lsrch-score{color:#9aa3b2;font-size:.85rem}
  .lsrch-kbd{font:12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.12);opacity:.8}
  .search-jump{outline:2px solid rgba(240,185,11,.45); box-shadow:0 0 0 4px rgba(240,185,11,.12), 0 10px 30px rgba(0,0,0,.4); border-radius:12px; transition:box-shadow .3s}
  mark.lsrch{background: rgba(240,185,11,.22); border-radius:.25em; padding:0 .2em;}
  `;

  // Inject CSS once
  let _styleInjected = false;
  function injectStyle(){
    if (_styleInjected) return;
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    _styleInjected = true;
  }

  // Debounce
  function debounce(fn, ms=160){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms);} }

  async function search(query, topK=20){
    const q = String(query||'').trim();
    if (!q) return [];
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      const results = await res.json();
      // The backend now returns items with a `similarity` score.
      // We can rename it to `score` for consistency with the old UI code.
      return results.map(item => ({ ...item, score: item.similarity, tab: item.type, id: item.title, section: item.type, detail: item.excerpt || item.category }));
    } catch (e) {
      console.error("Search failed:", e);
      return [];
    }
  }

  // -------- Palette UI --------
  let UI = null;
  function attachUI(){
    if (UI) return;
    injectStyle();
    const wrap = document.createElement('div');
    wrap.id = 'lsrch';
    wrap.className = 'lsrch-backdrop';
    wrap.innerHTML = `
      <div class="lsrch-modal" role="dialog" aria-modal="true" aria-label="Search">
        <div class="lsrch-head">
          <input id="lsrch-input" class="lsrch-input" placeholder="Search your site (Cmd/Ctrl K)">
          <span class="lsrch-kbd">Esc</span>
        </div>
        <div class="lsrch-body" id="lsrch-results" role="listbox" aria-label="Search results"></div>
      </div>
    `;
    document.body.appendChild(wrap);
    UI = {
      root: wrap,
      input: wrap.querySelector('#lsrch-input'),
      list: wrap.querySelector('#lsrch-results'),
      show(){ wrap.classList.add('show'); this.input.focus(); this.input.select(); },
      hide(){ wrap.classList.remove('show'); this.input.value=''; this.list.innerHTML=''; },
      render(items, query){
        if (!items.length){
          this.list.innerHTML = `<div class="lsrch-item"><div class="lsrch-sec">Search</div><div class="lsrch-desc">No matches</div></div>`;
          return;
        }
        const esc = (s)=>String(s||'').replace(/[&<>]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[m]));
        const mark = (t)=> {
          const q = String(query||'').trim();
          if (!q) return esc(t);
          const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\$&')})`,'ig');
          return esc(t).replace(re,'<mark class="lsrch">$1</mark>');
        };
        this.list.innerHTML = items.map(it => `
          <div class="lsrch-item" role="option" data-id="${esc(it.id)}" data-tab="${esc(it.tab)}">
            <div class="lsrch-sec">${esc(it.section)}</div>
            <div>
              <div class="lsrch-title">${mark(it.title)}</div>
              ${it.detail ? `<div class="lsrch-desc">${mark(it.detail)}</div>` : ``}
              <div class="lsrch-score">Score: ${it.score.toFixed(3)} ${it.period?` · ${esc(it.period)}`:''}</div>
            </div>
          </div>
        `).join('');
      }
    };

    // Interactions
    const doSearch = debounce(async ()=>{
      const q = UI.input.value.trim();
      if (!q){ UI.list.innerHTML=''; return; }
      const items = await search(q, 20);
      UI.render(items, q);
    }, 120);

    UI.input.addEventListener('input', doSearch);
    UI.input.addEventListener('keydown', (e)=>{ if (e.key==='Escape'){ UI.hide(); } });

    UI.list.addEventListener('click', (e)=>{
      const row = e.target.closest('.lsrch-item[data-id]');
      if (!row) return;
      const hit = {
        id: row.getAttribute('data-id'),
        tab: row.getAttribute('data-tab')
      };
      UI.hide();
      window.navigateToSearchHit && window.navigateToSearchHit(hit);
    });

    // Global shortcuts
    window.addEventListener('keydown', (e)=>{
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase()==='k'){
        e.preventDefault();
        if (wrap.classList.contains('show')) UI.hide(); else UI.show();
      }
      if (e.key==='Escape' && wrap.classList.contains('show')) UI.hide();
    });
  }

  // Public API
  window.LeumasSearch = {
    search,
    attachUI
  };
})();