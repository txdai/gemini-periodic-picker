// ==UserScript==
// @name         Gemini Periodic Table Model Picker
// @namespace    https://gemini.google.com/
// @version      1.0.1
// @description  Replaces Gemini's model dropdown with a tiny periodic table. Purely cosmetic: every pick is passed through to Gemini's own menu.
// @match        https://gemini.google.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

/*
 * How it works
 *  - Clicks on the model pill are intercepted, and our popover opens instead.
 *  - To read or change anything, the script opens Gemini's real menu invisibly
 *    (the overlay container is hidden for a moment), reads it or clicks the
 *    matching item, and lets Gemini close it. Gemini remains the source of truth,
 *    so the pill label, locks, upsells and thinking level all behave as usual.
 *  - Model options are discovered from the menu text ("4 Hydrogen" -> H). Any
 *    element the menu doesn't offer stays greyed out.
 */
(function () {
  'use strict';
  if (window.__periodicPicker) return;

  /* ---------- periodic table data ---------- */

  var NAMES = ('Hydrogen Helium Lithium Beryllium Boron Carbon Nitrogen Oxygen Fluorine Neon Sodium Magnesium ' +
    'Aluminium Silicon Phosphorus Sulfur Chlorine Argon Potassium Calcium Scandium Titanium Vanadium Chromium ' +
    'Manganese Iron Cobalt Nickel Copper Zinc Gallium Germanium Arsenic Selenium Bromine Krypton Rubidium ' +
    'Strontium Yttrium Zirconium Niobium Molybdenum Technetium Ruthenium Rhodium Palladium Silver Cadmium Indium ' +
    'Tin Antimony Tellurium Iodine Xenon Caesium Barium Lanthanum Cerium Praseodymium Neodymium Promethium ' +
    'Samarium Europium Gadolinium Terbium Dysprosium Holmium Erbium Thulium Ytterbium Lutetium Hafnium Tantalum ' +
    'Tungsten Rhenium Osmium Iridium Platinum Gold Mercury Thallium Lead Bismuth Polonium Astatine Radon Francium ' +
    'Radium Actinium Thorium Protactinium Uranium Neptunium Plutonium Americium Curium Berkelium Californium ' +
    'Einsteinium Fermium Mendelevium Nobelium Lawrencium Rutherfordium Dubnium Seaborgium Bohrium Hassium ' +
    'Meitnerium Darmstadtium Roentgenium Copernicium Nihonium Flerovium Moscovium Livermorium Tennessine Oganesson'
  ).split(' ');

  var SYMS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
    'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta ' +
    'W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt ' +
    'Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' ');

  var BY_NAME = {};
  NAMES.forEach(function (n, i) { BY_NAME[n.toLowerCase()] = i + 1; });
  BY_NAME.aluminum = 13; BY_NAME.cesium = 55; BY_NAME.sulphur = 16;

  function category(z) {
    if ([1, 6, 7, 8, 15, 16, 34].indexOf(z) > -1) return 'nonmetal';
    if ([9, 17, 35, 53, 85, 117].indexOf(z) > -1) return 'halogen';
    if ([2, 10, 18, 36, 54, 86, 118].indexOf(z) > -1) return 'noble';
    if ([3, 11, 19, 37, 55, 87].indexOf(z) > -1) return 'alkali';
    if ([4, 12, 20, 38, 56, 88].indexOf(z) > -1) return 'alkaline';
    if ([5, 14, 32, 33, 51, 52].indexOf(z) > -1) return 'metalloid';
    if (z >= 57 && z <= 71) return 'lanthanide';
    if (z >= 89 && z <= 103) return 'actinide';
    if ([13, 31, 49, 50, 81, 82, 83, 84, 113, 114, 115, 116].indexOf(z) > -1) return 'post';
    return 'transition';
  }

  /* [row, col]; rows 9-10 hold the f-block, row 8 is a thin spacer. */
  function pos(z) {
    if (z === 1) return [1, 1];
    if (z === 2) return [1, 18];
    if (z <= 4) return [2, z - 2];
    if (z <= 10) return [2, z + 8];
    if (z <= 12) return [3, z - 10];
    if (z <= 18) return [3, z];
    if (z <= 36) return [4, z - 18];
    if (z <= 54) return [5, z - 36];
    if (z <= 56) return [6, z - 54];
    if (z <= 71) return [9, z - 54];
    if (z <= 86) return [6, z - 68];
    if (z <= 88) return [7, z - 86];
    if (z <= 103) return [10, z - 86];
    return [7, z - 100];
  }

  /* [background, text] for light and dark themes */
  var CATS = {
    nonmetal:   ['#c8e6c9', '#1b5e20', '#1e3a24', '#a5d6a7'],
    noble:      ['#d1c4e9', '#311b92', '#2e2546', '#c5b3f0'],
    alkali:     ['#ffccbc', '#bf360c', '#43281f', '#ffab91'],
    alkaline:   ['#ffe0b2', '#e65100', '#45321a', '#ffcc80'],
    transition: ['#bbdefb', '#0d47a1', '#1c2e45', '#90caf9'],
    post:       ['#cfd8dc', '#263238', '#2c3336', '#b0bec5'],
    metalloid:  ['#d7ccc8', '#3e2723', '#352d2a', '#bcaaa4'],
    halogen:    ['#fff9c4', '#827717', '#3d3a1c', '#e6ee9c'],
    lanthanide: ['#b2ebf2', '#006064', '#173a3e', '#80deea'],
    actinide:   ['#f8bbd0', '#880e4f', '#40222e', '#f48fb1']
  };

  /* ---------- talking to Gemini's real menu ---------- */

  var PILL = '[data-test-id="bard-mode-menu-button"]';
  var MENU = '[data-test-id="gem-mode-menu"]';
  var bypass = false;          // lets our own synthetic pill clicks through
  var queue = Promise.resolve();
  var cache = null;            // last menu snapshot

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitFor(test, timeout) {
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        var v = test();
        if (v || Date.now() - t0 > timeout) return resolve(v);
        setTimeout(poll, 25);
      })();
    });
  }

  function realPillClick() {
    var p = document.querySelector(PILL);
    if (!p) return false;
    bypass = true;
    try { p.click(); } finally { bypass = false; }
    return true;
  }

  /* Run fn(menuEl) with Gemini's menu open but invisible. fn returns true if it closed the menu itself. */
  function withGhostMenu(fn) {
    var job = queue.then(async function () {
      var root = document.documentElement;
      root.classList.add('ptp-ghost');
      try {
        if (!document.querySelector(MENU) && !realPillClick()) return null;
        var menu = await waitFor(function () { return document.querySelector(MENU); }, 1500);
        if (!menu) return null;
        var result = await fn(menu);
        if (document.querySelector(MENU)) {
          realPillClick();
          await waitFor(function () { return !document.querySelector(MENU); }, 800);
        }
        var stuck = document.querySelector(MENU);
        if (stuck) {
          bypass = true;
          try {
            stuck.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
          } finally { bypass = false; }
          await waitFor(function () { return !document.querySelector(MENU); }, 500);
        }
        return result;
      } finally {
        await sleep(30);
        root.classList.remove('ptp-ghost');
      }
    });
    queue = job.catch(function () {});
    return job;
  }

  function text(el, sel) {
    var n = el.querySelector(sel);
    return n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function hasIcon(el, name) {
    return [].some.call(el.querySelectorAll('mat-icon,gem-icon'), function (i) {
      return (i.getAttribute('fonticon') || i.getAttribute('data-mat-icon-name') || '') === name;
    });
  }

  /* Snapshot of the menu: modes (Auto + models) and thinking levels. */
  function readMenu() {
    var modes = [], thinking = [];
    [].forEach.call(document.querySelectorAll('gem-menu-item[role="menuitemradio"]'), function (it) {
      var title = text(it, '.label') || it.textContent.trim();
      var sub = text(it, '.sub, .subtitle, .description, [class*="sub"]');
      var entry = {
        key: it.dataset.modeId || ('t:' + title),
        title: title,
        sub: sub,
        checked: it.getAttribute('aria-checked') === 'true',
        locked: hasIcon(it, 'lock'),
        z: null
      };
      if (it.dataset.modeId) {
        var m = (sub + ' ' + title).match(/\b([A-Z][a-z]+)\b/g) || [];
        for (var i = 0; i < m.length; i++) {
          var z = BY_NAME[m[i].toLowerCase()];
          if (z) { entry.z = z; break; }
        }
        modes.push(entry);
      } else {
        thinking.push(entry);
      }
    });
    return { modes: modes, thinking: thinking };
  }

  function findItem(key) {
    return [].find.call(document.querySelectorAll('gem-menu-item[role="menuitemradio"]'), function (it) {
      return (it.dataset.modeId || ('t:' + (text(it, '.label') || it.textContent.trim()))) === key;
    });
  }

  function refresh() {
    return withGhostMenu(function () { cache = readMenu(); return cache; });
  }

  function pass(key) {
    return withGhostMenu(async function () {
      var it = findItem(key);
      if (!it) return false;
      it.click();
      await waitFor(function () { return !document.querySelector(MENU); }, 800);
      return true;
    });
  }

  /* ---------- styles ---------- */

  var css = '' +
    /* While we drive Gemini's menu, hide it wherever it renders. It lives in its own pane outside
       .cdk-overlay-container, so target the menu and anything that wraps it. visibility also covers
       top-layer popovers, which ignore an ancestor's opacity. */
    'html.ptp-ghost .cdk-overlay-container,' +
    'html.ptp-ghost gem-menu,' +
    'html.ptp-ghost [data-test-id="bard-mode-desktop-gem-menu"],' +
    'html.ptp-ghost .popover-click-shield,' +
    'html.ptp-ghost .cdk-overlay-pane:has(gem-menu),' +
    'html.ptp-ghost .cdk-overlay-backdrop,' +
    'html.ptp-ghost [popover]:has(gem-menu)' +
    '{opacity:0!important;visibility:hidden!important;pointer-events:none!important;' +
    'animation:none!important;transition:none!important}' +
    'html.ptp-ghost [popover]:has(gem-menu)::backdrop{opacity:0!important}' +
    /* Gemini also tints the pill as "pressed" while its menu is open; suppress that during ghost ops. */
    'html.ptp-ghost [data-test-id="bard-mode-menu-button"]{background:transparent!important}' +
    'html.ptp-ghost [data-test-id="bard-mode-menu-button"] .mat-mdc-button-persistent-ripple,' +
    'html.ptp-ghost [data-test-id="bard-mode-menu-button"] .mat-ripple,' +
    'html.ptp-ghost [data-test-id="bard-mode-menu-button"] .mat-mdc-button-persistent-ripple::before' +
    '{opacity:0!important;transition:none!important}' +
    '.ptp-backdrop{position:fixed;inset:0;z-index:2147483000;background:transparent}' +
    '.ptp-pop{position:fixed;z-index:2147483001;box-sizing:border-box;width:max-content;padding:8px;border-radius:16px;' +
    '--bg:#fff;--fg:#1f1f1f;--mut:#5f6368;--line:#e1e3e6;--hov:rgba(60,64,67,.08);--acc:#0b57d0;--accbg:#d3e3fd;' +
    'background:var(--bg);color:var(--fg);box-shadow:0 2px 6px 2px rgba(60,64,67,.15),0 1px 2px rgba(60,64,67,.3);' +
    'font-family:"Google Sans Text","Google Sans",Roboto,Arial,sans-serif;animation:ptp-in .12s ease-out}' +
    '.ptp-pop.dark{--bg:#282a2c;--fg:#e3e3e3;--mut:#a8abaf;--line:#444746;--hov:rgba(255,255,255,.08);--acc:#a8c7fa;--accbg:#0842a0}' +
    '@keyframes ptp-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}' +
    '.ptp-row{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;border:0;background:transparent;' +
    'color:inherit;font:inherit;text-align:left;padding:6px 8px;border-radius:10px;cursor:pointer}' +
    '.ptp-row:hover,.ptp-row:focus-visible{background:var(--hov);outline:none}' +
    '.ptp-tick{width:16px;flex:none;font-size:14px;color:var(--acc);text-align:center}' +
    '.ptp-t{font-size:13px;line-height:16px}' +
    '.ptp-d{font-size:11.5px;line-height:15px;color:var(--mut)}' +
    '.ptp-grid{display:grid;grid-template-columns:repeat(18,21px);grid-template-rows:repeat(7,21px) 6px repeat(2,21px);' +
    'gap:2px;padding:6px 4px 0}' +
    '.ptp-cell{position:relative;box-sizing:border-box;border:0;border-radius:4px;padding:0;margin:0;font:inherit;' +
    'font-size:9.5px;font-weight:600;letter-spacing:-.2px;line-height:1;display:flex;align-items:center;justify-content:center;' +
    'cursor:default;opacity:.4;filter:saturate(.6)}' +
    '.ptp-cell.on{cursor:pointer;opacity:1;filter:none;font-size:11px;font-weight:700;z-index:1;' +
    'box-shadow:0 0 0 1.5px #4285f4;transition:transform .08s}' +
    '.ptp-cell.on:hover,.ptp-cell.on:focus-visible{transform:scale(1.22);z-index:3;outline:none;' +
    'box-shadow:0 0 0 2px #1a73e8,0 3px 8px rgba(26,115,232,.45)}' +
    '.ptp-cell.sel{box-shadow:0 0 0 2px #1a73e8,0 0 0 4px rgba(26,115,232,.28)}' +
    '.ptp-cell .ptp-lock{position:absolute;right:-3px;top:-4px;font-size:8px;line-height:1;filter:grayscale(1)}' +
    '.ptp-ph{border:1px dashed var(--line);border-radius:4px;font-size:10px;color:var(--mut);display:flex;' +
    'align-items:center;justify-content:center}' +
    '.ptp-info{margin:8px 4px 0;font-size:12px;line-height:16px;color:var(--mut);min-height:16px;white-space:nowrap;' +
    'overflow:hidden;text-overflow:ellipsis;max-width:410px}' +
    '.ptp-info b{font-weight:500;color:var(--fg)}' +
    '.ptp-think{display:flex;align-items:center;gap:8px;margin:8px 4px 0;padding-top:8px;border-top:1px solid var(--line)}' +
    '.ptp-think-l{font-size:12px;color:var(--mut);flex:none}' +
    '.ptp-seg{display:flex;flex:1;border:1px solid var(--line);border-radius:999px;overflow:hidden}' +
    '.ptp-seg button{flex:1;border:0;background:transparent;color:var(--fg);font:inherit;font-size:12px;padding:5px 6px;' +
    'cursor:pointer;border-left:1px solid var(--line)}' +
    '.ptp-seg button:first-child{border-left:0}' +
    '.ptp-seg button:hover,.ptp-seg button:focus-visible{background:var(--hov);outline:none}' +
    '.ptp-seg button[aria-checked="true"]{background:var(--accbg);color:var(--acc);font-weight:500}' +
    '.ptp-seg button[aria-checked="true"]::before{content:"\\2713\\00a0"}' +
    '.ptp-loading{font-size:12px;color:var(--mut);padding:8px}';

  function injectCss() {
    if (document.getElementById('ptp-css')) return;
    var s = document.createElement('style');
    s.id = 'ptp-css';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------- popover ---------- */

  var pop = null, backdrop = null, anchor = null;

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function isDark() { return document.body.classList.contains('dark-theme'); }

  function render(state) {
    if (!pop) return;
    pop.textContent = '';
    pop.classList.toggle('dark', isDark());
    if (!state || !state.modes.length) {
      pop.appendChild(el('div', 'ptp-loading', state ? 'Couldn’t read Gemini’s menu.' : 'Loading…'));
      return place();
    }

    var byZ = {}, current = null, others = [];
    state.modes.forEach(function (m) {
      if (m.z) byZ[m.z] = m; else others.push(m);
      if (m.checked) current = m;
    });

    var info = el('div', 'ptp-info');
    function setInfo(m, fallback) {
      info.textContent = '';
      if (!m) { info.textContent = fallback || ''; return; }
      info.appendChild(el('b', null, m.sub || m.title));
      info.appendChild(document.createTextNode(' · ' + (m.sub ? m.title : '') + (m.locked ? ' · locked' : '')));
    }
    function resetInfo() { setInfo(current, ''); if (current) info.appendChild(document.createTextNode('  (current)')); }

    /* Non-element modes (Auto, and anything Gemini adds later) as plain rows. */
    others.forEach(function (m) {
      var b = el('button', 'ptp-row');
      b.type = 'button';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(m.checked));
      b.appendChild(el('span', 'ptp-tick', m.checked ? '✓' : (m.locked ? '🔒' : '')));
      var t = el('span');
      t.appendChild(el('div', 'ptp-t', m.title));
      if (m.sub) t.appendChild(el('div', 'ptp-d', m.sub));
      b.appendChild(t);
      b.addEventListener('click', function () { choose(m.key, true); });
      pop.appendChild(b);
    });

    var grid = el('div', 'ptp-grid');
    grid.addEventListener('mouseleave', resetInfo);
    for (var z = 1; z <= 118; z++) {
      (function (z) {
        var m = byZ[z], p = pos(z), c = CATS[category(z)], dark = isDark();
        var b = el('button', 'ptp-cell' + (m ? ' on' : '') + (m && m.checked ? ' sel' : ''), SYMS[z - 1]);
        b.type = 'button';
        b.style.gridRow = p[0];
        b.style.gridColumn = p[1];
        b.style.background = dark ? c[2] : c[0];
        b.style.color = dark ? c[3] : c[1];
        b.setAttribute('role', 'menuitemradio');
        if (m) {
          b.setAttribute('aria-checked', String(m.checked));
          b.setAttribute('aria-label', m.title + ', ' + (m.sub || NAMES[z - 1]) + (m.locked ? ', locked' : ''));
          if (m.locked) b.appendChild(el('span', 'ptp-lock', '🔒'));
          b.addEventListener('click', function () { choose(m.key, true); });
          b.addEventListener('mouseenter', function () { setInfo(m); });
          b.addEventListener('focus', function () { setInfo(m); });
        } else {
          b.tabIndex = -1;
          b.setAttribute('aria-disabled', 'true');
          b.setAttribute('aria-label', NAMES[z - 1] + ', unavailable');
          b.addEventListener('mouseenter', function () { setInfo(null, NAMES[z - 1] + ' · not synthesised yet'); });
        }
        grid.appendChild(b);
      })(z);
    }
    var ph1 = el('div', 'ptp-ph', '*'); ph1.style.gridRow = 6; ph1.style.gridColumn = 3; ph1.title = 'Lanthanides (57–71)';
    var ph2 = el('div', 'ptp-ph', '**'); ph2.style.gridRow = 7; ph2.style.gridColumn = 3; ph2.title = 'Actinides (89–103)';
    grid.appendChild(ph1);
    grid.appendChild(ph2);
    pop.appendChild(grid);

    resetInfo();
    pop.appendChild(info);

    /* Thinking depth, passed straight through to Gemini's submenu. */
    if (state.thinking.length) {
      var row = el('div', 'ptp-think');
      row.appendChild(el('span', 'ptp-think-l', 'Thinking'));
      var seg = el('div', 'ptp-seg');
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', 'Thinking level');
      state.thinking.forEach(function (t) {
        var b = el('button', null, t.title);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(t.checked));
        if (t.sub) b.title = t.sub;
        b.addEventListener('mouseenter', function () { setInfo({ title: t.sub, sub: 'Thinking: ' + t.title }); });
        b.addEventListener('mouseleave', resetInfo);
        b.addEventListener('click', function () { choose(t.key, false); });
        seg.appendChild(b);
      });
      row.appendChild(seg);
      pop.appendChild(row);
    }

    place();
  }

  function place() {
    if (!pop || !anchor) return;
    var r = anchor.getBoundingClientRect();
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    var left = Math.min(Math.max(8, r.right - w + 8), vw - w - 8);
    var top = r.bottom + 6;
    if (top + h > vh - 8) top = r.top - h - 6;
    pop.style.left = left + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }

  function open(trigger) {
    if (pop) return;
    injectCss();
    anchor = trigger;
    backdrop = el('div', 'ptp-backdrop');
    backdrop.addEventListener('mousedown', function (e) { e.preventDefault(); close(); });
    pop = el('div', 'ptp-pop');
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', 'Select model');
    document.body.appendChild(backdrop);
    document.body.appendChild(pop);
    render(cache);
    refresh().then(function (s) {
      if (!pop) return;
      render(s || cache);
      var f = pop.querySelector('.ptp-cell.sel') || pop.querySelector('.ptp-cell.on') || pop.querySelector('button');
      if (f) f.focus({ preventScroll: true });
    });
  }

  function close() {
    if (!pop) return;
    pop.remove();
    backdrop.remove();
    pop = backdrop = null;
    if (anchor && document.contains(anchor)) anchor.focus({ preventScroll: true });
  }

  /* Model picks close the popover; thinking picks keep it open and refresh. */
  function choose(key, closeAfter) {
    if (closeAfter) close();
    pass(key).then(function () {
      if (!closeAfter && pop) return refresh().then(render);
    });
  }

  /* ---------- wiring ---------- */

  document.addEventListener('click', function (e) {
    if (bypass) return;
    var t = e.target && e.target.closest && e.target.closest(PILL);
    if (!t) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (pop) close(); else open(t);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!pop || bypass) return;
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
  }, true);

  window.addEventListener('resize', place);

  /* Have the hiding rules in place before the first ghost open. */
  injectCss();

  window.__periodicPicker = { open: function () { var p = document.querySelector(PILL); if (p) open(p); }, close: close, refresh: refresh };
})();
