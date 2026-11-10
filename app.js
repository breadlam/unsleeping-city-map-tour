/* The Unsleeping City: interactive character route map. Needs Leaflet 1.9 and data.js (window.UC_DATA). */
(function () {
  'use strict';

  const D = window.UC_DATA;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ constants
  const MODES = {
    walk:   { label: 'Walking, running', note: 'routed along streets', z: 6, weight: 3.6, dash: '0.1 6.5', opacity: 0.95 },
    drive:  { label: 'Car, cab, bus or moped', note: 'routed on roads', z: 4, weight: 2.4, dash: null, opacity: 0.95 },
    subway: { label: 'Subway', note: 'follows the track', z: 5, weight: 4.4, dash: null, opacity: 0.85 },
    water:  { label: 'Ferry or swimming', note: 'ferries follow the ferry route', z: 3, weight: 2.6, dash: '10 5 2 5', opacity: 0.95 },
    fly:    { label: 'Flying', note: 'straight line', z: 2, weight: 2.4, dash: '9 6', opacity: 0.9 },
    magic:  { label: 'Magic', note: 'portals, teleports, falling asleep into Nod', z: 1, weight: 1.8, dash: '0.1 4.5', opacity: 0.8 },
  };
  const MODE_ORDER = ['walk', 'drive', 'subway', 'water', 'fly', 'magic'];
  const PLANES = {
    unseen: 'The Unseen', dream: 'Nod (the Dreaming)', fae: 'Faerie', infernal: 'Hell', celestial: 'Heaven',
    'chest-realm': "Inside Iga's chest", photograph: 'Inside a photograph', time: 'The time stream', liminal: 'A liminal space',
  };
  const QUALITY_NOTE = {
    borough: 'Only the borough is known; the pin is a placeholder.',
    guess: 'Position inferred from indirect clues.',
    symbolic: 'A dream place with no real-world twin; the pin is illustrative.',
    analog: 'A dream or fae place, pinned at the real place it mirrors.',
    anchored: 'An otherworld scene, pinned where the characters’ bodies (or the doorway) were.',
    neighborhood: 'The neighborhood is stated; the exact spot is approximate.',
    street: 'On a named street; accurate to a few blocks.',
  };
  const PIN_COLORS = { real: ['#ea4335', '#a50e0e'], approx: ['#9aa0a6', '#5f6368'], dream: ['#9c4dcc', '#5e2a84'] };
  const INITIALS = { Ricky: 'R', Sofia: 'S', Kingston: 'K', Misty: 'M', Kugrash: 'Ku', Pete: 'P', Iga: 'I', Cody: 'C' };
  const DARK_BASES = new Set(['Dark gray', 'Satellite']);
  const LABEL_ZOOM = 15;

  // ------------------------------------------------------------------ data prep
  function decode(str) {
    let i = 0, lat = 0, lng = 0;
    const out = [];
    while (i < str.length) {
      for (let k = 0; k < 2; k++) {
        let b, shift = 0, res = 0;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
        const d = (res & 1) ? ~(res >> 1) : (res >> 1);
        if (k === 0) lat += d; else lng += d;
      }
      out.push([lat / 1e5, lng / 1e5]);
    }
    return out;
  }

  const chars = D.chars;
  const charIdx = {};
  chars.forEach((c, i) => { charIdx[c.id] = i; });
  const events = D.events;
  const evById = {};
  events.forEach((e, i) => { e.i = i; e.day = e.dt.slice(0, 10); evById[e.id] = e; });
  const pins = D.pins;
  pins.forEach((p, i) => { p.i = i; p.events = []; });
  events.forEach((e) => { if (e.pin != null) pins[e.pin].events.push(e); });
  const legs = D.legs;
  const legsTo = {};
  const allParts = [];
  legs.forEach((l, i) => {
    l.i = i; l.to = evById[l.t]; l.from = evById[l.f];
    l.p.forEach((p) => { p.ll = decode(p.e); p.leg = l; allParts.push(p); });
    (legsTo[l.t] = legsTo[l.t] || []).push(l);
  });
  allParts.sort((a, b) => (MODES[a.m].z - MODES[b.m].z) || (charIdx[a.leg.c] - charIdx[b.leg.c]) || (a.leg.i - b.leg.i));
  const charEvents = {};
  chars.forEach((c) => { charEvents[c.id] = events.filter((e) => e.chars.includes(c.id)); });

  // ------------------------------------------------------------------ state
  const S = {
    chars: new Set(chars.map((c) => c.id)),
    chapter: 'all',
    show: 'all',
    modes: new Set(MODE_ORDER),
    inferred: true,
    cur: 0,
    playing: false,
    speed: 1,
    darkBase: false,
  };
  let list = [];          // events passing the character and chapter filters, story-world order
  let offsetUnits = {};   // character -> parallel offset slot

  const chapterOk = (e) => S.chapter === 'all' || String(e.ch) === S.chapter;
  const eventPasses = (e) => chapterOk(e) && e.chars.some((c) => S.chars.has(c));
  const curEv = () => list[S.cur];
  function timeOk(e) {
    const c = curEv();
    if (S.show === 'all' || !c) return true;
    if (S.show === 'upto') return e.i <= c.i;
    return e.day === c.day;
  }
  const charColor = (id) => (id === 'Cody' && S.darkBase) ? '#ececec' : chars[charIdx[id]].color;
  const charName = (id) => id === 'Misty' ? 'Misty / Rowan' : id;
  const uiColor = (id) => chars[charIdx[id]].color;
  const dotsHtml = (ids) => '<span class="dots">' + ids.filter((c) => c in charIdx).map((c) =>
    `<span class="dot" style="--c:${uiColor(c)}" title="${esc(charName(c))}"></span>`).join('') + '</span>';

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dateText(e) {
    const tl = e.tl ? ' · ' + e.tl : '';
    if (/^C\d/.test(e.sd)) {
      const m = +e.dt.slice(5, 7), d = +e.dt.slice(8, 10);
      const approx = e.ch === 2 && e.dt >= '2021-12-01' ? '≈' : '';
      return `${e.sd} · ${approx}${MON[m - 1]} ${d}${tl}`;
    }
    if (e.fb) return 'Flashback, summer 1994' + tl;
    const dl = e.dl ? e.dl.charAt(0).toUpperCase() + e.dl.slice(1) : e.sd;
    return dl + tl;
  }
  const epText = (e) => `Chapter ${e.ch}, Episode ${+e.ep.slice(3)}: ${e.et}`;

  // ------------------------------------------------------------------ offset polylines
  function spacing(z) { return z >= 15 ? 4 : z >= 14 ? 3.4 : z >= 13 ? 2.8 : z >= 12 ? 2.1 : 1.5; }
  function wscale(z) { return z >= 14 ? 1 : z >= 13 ? 0.85 : z >= 12 ? 0.75 : z >= 11 ? 0.65 : 0.55; }
  function offsetRing(P, off) {
    const pts = [];
    for (const p of P) if (!pts.length || Math.abs(p.x - pts[pts.length - 1].x) + Math.abs(p.y - pts[pts.length - 1].y) > 0.5) pts.push(p);
    const n = pts.length;
    if (n < 2) return P;
    const N = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y, l = Math.hypot(dx, dy);
      N.push([-dy / l, dx / l]);
    }
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      let nx, ny;
      if (i === 0) [nx, ny] = N[0];
      else if (i === n - 1) [nx, ny] = N[n - 2];
      else {
        let mx = N[i - 1][0] + N[i][0], my = N[i - 1][1] + N[i][1];
        const ml = Math.hypot(mx, my);
        if (ml < 1e-6) [nx, ny] = N[i];
        else {
          mx /= ml; my /= ml;
          const c = Math.max(0.5, mx * N[i][0] + my * N[i][1]);
          nx = mx / c; ny = my / c;
        }
      }
      out[i] = L.point(pts[i].x + nx * off, pts[i].y + ny * off);
    }
    return out;
  }
  const OffsetPolyline = L.Polyline.extend({
    _project: function () {
      L.Polyline.prototype._project.call(this);
      const off = (this.options.offset || 0) * spacing(this._map.getZoom());
      if (!off || !this._rings.length) return;
      const b = L.bounds([]);
      this._rings = this._rings.map((r) => { const o = offsetRing(r, off); o.forEach((p) => b.extend(p)); return o; });
      if (b.isValid()) { this._rawPxBounds = b; this._updateBounds(); }
    },
  });

  // ------------------------------------------------------------------ map
  const map = L.map('map', { zoomControl: false, minZoom: 9, maxZoom: 18, attributionControl: true });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.createPane('hlPane').style.zIndex = 450;
  map.createPane('haloPane').style.zIndex = 590;
  map.createPane('charPane').style.zIndex = 650;

  const esri = (svc, opts) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`, opts);
  const ESRI_ATTR = 'Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community';
  const ROUTE_ATTR = 'Routes: OSRM / FOSSGIS on &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; subway track: MTA via data.ny.gov';
  const bases = {
    'Streets': esri('World_Street_Map', { maxNativeZoom: 19, maxZoom: 18, className: 'tiles-muted', attribution: ESRI_ATTR }),
    'Light gray': L.layerGroup([
      esri('Canvas/World_Light_Gray_Base', { maxNativeZoom: 16, maxZoom: 18, attribution: ESRI_ATTR }),
      esri('Canvas/World_Light_Gray_Reference', { maxNativeZoom: 16, maxZoom: 18 }),
    ]),
    'Dark gray': L.layerGroup([
      esri('Canvas/World_Dark_Gray_Base', { maxNativeZoom: 16, maxZoom: 18, attribution: ESRI_ATTR }),
      esri('Canvas/World_Dark_Gray_Reference', { maxNativeZoom: 16, maxZoom: 18 }),
    ]),
    'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
    'Satellite': esri('World_Imagery', { maxNativeZoom: 19, maxZoom: 18, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS user community' }),
  };
  bases['Streets'].addTo(map);
  L.control.layers(bases, null, { position: 'topright' }).addTo(map);
  map.attributionControl.addAttribution(ROUTE_ATTR);
  map.on('baselayerchange', (ev) => {
    const dark = DARK_BASES.has(ev.name);
    if (dark !== S.darkBase) { S.darkBase = dark; restyleAll(); }
    setTimeout(placeBar, 0);
  });

  const FitControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      const div = L.DomUtil.create('div', 'leaflet-bar');
      const a = L.DomUtil.create('a', 'fit-btn', div);
      a.href = '#'; a.title = 'Zoom to everything shown'; a.setAttribute('role', 'button'); a.setAttribute('aria-label', a.title);
      a.innerHTML = '&#x2922;';
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); fitVisible(); });
      L.DomEvent.disableClickPropagation(div);
      return div;
    },
  });
  new FitControl().addTo(map);

  const routeRenderer = L.canvas({ padding: 0.4, tolerance: 6 });
  const hlRenderer = L.canvas({ padding: 0.4, pane: 'hlPane', tolerance: 3 });
  const routeGroup = L.layerGroup().addTo(map);
  const hlGroup = L.layerGroup().addTo(map);
  const pinGroup = L.layerGroup().addTo(map);
  const haloGroup = L.layerGroup().addTo(map);
  const charGroup = L.layerGroup().addTo(map);
  const popup = L.popup({ maxWidth: 320, autoPanPaddingTopLeft: [20, 60], autoPanPaddingBottomRight: [20, 20] });

  // padding that keeps things clear of the bottom bar
  function pads() {
    const bar = $('bar');
    const h = bar ? bar.offsetHeight : 0;
    return { paddingTopLeft: L.point(40, 60), paddingBottomRight: L.point(60, h + 40) };
  }

  // ------------------------------------------------------------------ routes
  function partStyle(p) {
    const m = MODES[p.m];
    return {
      color: charColor(p.leg.c), weight: m.weight * wscale(map.getZoom()), opacity: m.opacity * (p.leg.st ? 1 : 0.5),
      dashArray: m.dash, lineCap: 'round', lineJoin: 'round',
    };
  }
  function partLayer(p) {
    if (!p.layer) {
      p.layer = new OffsetPolyline(p.ll, Object.assign({ renderer: routeRenderer, offset: 0 }, partStyle(p)));
      p.layer.on('click', (e) => { L.DomEvent.stop(e); openLegPopup(p.leg, e.latlng); });
    }
    return p.layer;
  }
  function legVisible(l) {
    return S.chars.has(l.c) && chapterOk(l.to) && timeOk(l.to) && (l.st || S.inferred);
  }
  function computeOffsets() {
    const vis = chars.filter((c) => S.chars.has(c.id)).map((c) => c.id);
    offsetUnits = {};
    vis.forEach((c, i) => { offsetUnits[c] = vis.length > 1 ? i - (vis.length - 1) / 2 : 0; });
  }
  function renderRoutes() {
    routeGroup.clearLayers();
    for (const p of allParts) {
      if (!S.modes.has(p.m) || !legVisible(p.leg)) continue;
      const lay = partLayer(p);
      lay.options.offset = offsetUnits[p.leg.c] || 0;
      routeGroup.addLayer(lay);
    }
  }
  function restyleAll() {
    for (const p of allParts) if (p.layer) p.layer.setStyle(partStyle(p));
    renderAll();
  }

  function modeSummary(l) {
    const seq = [];
    l.p.forEach((p) => { if (seq[seq.length - 1] !== p.m) seq.push(p.m); });
    return seq.map((m) => MODES[m].label.split(',')[0]).join(' → ');
  }
  function openLegPopup(l, latlng) {
    const f = l.from, t = l.to;
    const html = `<div class="pp-leg">
      <div class="pp-title"><span class="dot" style="--c:${uiColor(l.c)}"></span> ${esc(charName(l.c))}: ${esc(modeSummary(l))}</div>
      <div class="pp-sub">${l.st ? 'How they travelled is stated in the episode' : 'Inferred: the episode doesn’t say how they got there'}</div>
      ${l.tx ? `<p class="pp-q">“${esc(l.tx)}”</p>` : ''}
      <p>From <a href="#" data-scene="${f.id}">${f.id}</a> ${esc(f.ln)}</p>
      <p>To <a href="#" data-scene="${t.id}">${t.id}</a> ${esc(t.ln)}</p>
    </div>`;
    popup.options.offset = L.point(0, 7);
    popup.setLatLng(latlng).setContent(html).openOn(map);
  }

  // ------------------------------------------------------------------ pins
  function pinSvg(cls, w, h) {
    const [fill, stroke] = PIN_COLORS[cls];
    return `<svg width="${w}" height="${h}" viewBox="0 0 24 34" aria-hidden="true">` +
      `<path d="M12 33C9 26 2.5 20.5 2.5 12a9.5 9.5 0 1 1 19 0c0 8.5-6.5 14-9.5 21z" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>` +
      `<circle cx="12" cy="12" r="3.6" fill="${stroke}"/></svg>`;
  }
  document.querySelectorAll('.pin-sw').forEach((el) => {
    el.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(pinSvg(el.dataset.cls, 24, 34).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}")`;
  });

  function pinEventsVisible(p) {
    return p.events.filter((e) => eventPasses(e) && timeOk(e));
  }
  function renderPins() {
    pinGroup.clearLayers();
    const labels = map.getZoom() >= LABEL_ZOOM;
    const cur = curEv();
    for (const p of pins) {
      const evs = pinEventsVisible(p);
      if (!evs.length) continue;
      const k = Math.min(1, Math.sqrt(evs.length - 1) / 4.5);
      const w = Math.round(20 + 10 * k), h = Math.round(w * 34 / 24);
      const icon = L.divIcon({ className: 'pin', html: pinSvg(p.cls, w, h), iconSize: [w, h], iconAnchor: [w / 2, h - 1], popupAnchor: [0, -h + 4] });
      const isCur = cur && cur.pin === p.i;
      const m = L.marker([p.lat, p.lon], { icon, zIndexOffset: isCur ? 1000 : evs.length, keyboard: true, title: '' });
      const name = shortName(p);
      m.bindTooltip(labels ? esc(name) : `${esc(name)} <span class="muted">(${evs.length} scene${evs.length > 1 ? 's' : ''})</span>`,
        labels ? { permanent: true, direction: 'right', offset: [w / 2 - 2, -h / 2], className: 'pin-label' }
               : { direction: 'top', offset: [0, -h + 2] });
      m.on('click', () => openPinPopup(p, m));
      pinGroup.addLayer(m);
    }
  }
  function shortName(p) {
    return p.name.replace(/\s*\((C\d[^)]*|approx\.?)\)\s*$/i, '');
  }
  function openPinPopup(p, marker) {
    const evs = pinEventsVisible(p);
    const qn = QUALITY_NOTE[p.quality] || '';
    const items = evs.map((e) => `<li><a href="#" data-scene="${e.id}">${e.id}</a> ${dotsHtml(e.chars)}<br>
      <span class="pp-sub">${esc(dateText(e))}</span><br>${esc(e.sum)}</li>`).join('');
    const html = `<div class="pp-title">${esc(p.name)}</div>
      <div class="pp-sub">${esc(p.borough)}${qn ? ' · ' + esc(qn) : ''}</div>
      <ul class="pp-list">${items}</ul>`;
    popup.setLatLng(marker.getLatLng()).setContent(html);
    popup.options.offset = L.point(0, -marker.options.icon.options.iconSize[1] + 4);
    popup.openOn(map);
  }

  // ------------------------------------------------------------------ current scene: highlight, halo, characters
  function currentLegs(ev) {
    return (legsTo[ev.id] || []).filter((l) => S.chars.has(l.c));
  }
  function renderHighlight(ev) {
    hlGroup.clearLayers();
    if (!ev) return;
    const casing = [], lines = [];
    const k = wscale(map.getZoom());
    for (const l of currentLegs(ev)) {
      for (const p of l.p) {
        const m = MODES[p.m];
        const off = offsetUnits[l.c] || 0;
        casing.push(new OffsetPolyline(p.ll, { renderer: hlRenderer, offset: off, color: '#ffffff', weight: m.weight * k + 5, opacity: 0.85, lineCap: 'round', lineJoin: 'round', interactive: false }));
        lines.push(new OffsetPolyline(p.ll, { renderer: hlRenderer, offset: off, color: charColor(l.c), weight: m.weight * k + 1.5, opacity: 1, dashArray: m.dash, lineCap: 'round', lineJoin: 'round', interactive: false }));
      }
    }
    casing.concat(lines).forEach((x) => hlGroup.addLayer(x));
  }
  function renderHalo(ev) {
    haloGroup.clearLayers();
    if (!ev || ev.lat == null) return;
    const ll = ev.pin != null ? [pins[ev.pin].lat, pins[ev.pin].lon] : [ev.lat, ev.lon];
    haloGroup.addLayer(L.marker(ll, { pane: 'haloPane', interactive: false, keyboard: false,
      icon: L.divIcon({ className: '', html: '<div class="halo"></div>', iconSize: [44, 44], iconAnchor: [22, 22] }) }));
  }

  const charMarkers = {};
  function ringOffset(id) {
    const a = (90 + (charIdx[id] - 3.5) * 40) * Math.PI / 180;
    return [Math.round(17 * Math.cos(a)), Math.round(17 * Math.sin(a))];
  }
  function charIcon(id, past) {
    const [dx, dy] = ringOffset(id);
    const light = id === 'Cody' && S.darkBase ? ' light' : '';
    return L.divIcon({
      className: '', iconSize: [20, 20], iconAnchor: [10 - dx, 10 - dy],
      html: `<div class="cm${past ? ' past' : ''}${light}" style="--c:${charColor(id)}">${INITIALS[id] || id[0]}</div>`,
    });
  }
  function lastSeen(id, ev) {
    const evs = charEvents[id];
    for (let k = evs.length - 1; k >= 0; k--) {
      const e = evs[k];
      if (e.i > ev.i || e.lat == null) continue;
      if (e.ch !== ev.ch || e.fb !== ev.fb) return null;
      return e;
    }
    return null;
  }
  function eventLatLng(e) {
    return e.pin != null ? [pins[e.pin].lat, pins[e.pin].lon] : [e.lat, e.lon];
  }
  function charPositions(ev) {
    const out = {};
    if (!ev) return out;
    for (const c of chars) {
      if (!S.chars.has(c.id)) continue;
      const here = ev.chars.includes(c.id);
      const e = here && ev.lat != null ? ev : lastSeen(c.id, ev);
      if (!e) continue;
      out[c.id] = { ll: eventLatLng(e), here, ev: e };
    }
    return out;
  }
  let anim = null;
  function renderChars(ev, animateFrom) {
    if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
    const pos = charPositions(ev);
    for (const id of Object.keys(charMarkers)) {
      if (!pos[id]) { charGroup.removeLayer(charMarkers[id]); }
    }
    const paths = {};
    for (const [id, p] of Object.entries(pos)) {
      let m = charMarkers[id];
      if (!m) {
        m = charMarkers[id] = L.marker(p.ll, { pane: 'charPane', keyboard: false });
        m.bindTooltip('', { direction: 'top', offset: [0, -12] });
        m.on('click', () => { const e = m._ucEvent; if (e) jumpTo(e.id, 'auto'); });
      }
      const past = !p.here || p.ev !== ev;
      m.setIcon(charIcon(id, past));
      m._ucEvent = p.ev;
      m.setTooltipContent(past
        ? `${esc(charName(id))}: last placed at ${esc(p.ev.ln)} (${p.ev.id})`
        : `${esc(charName(id))}: here in this scene`);
      if (!charGroup.hasLayer(m)) charGroup.addLayer(m);
      if (animateFrom && p.here && p.ev === ev) {
        const ls = (legsTo[ev.id] || []).filter((l) => l.c === id);
        const ll = [].concat(...ls.map((l) => [].concat(...l.p.map((q) => q.ll))));
        if (ll.length >= 2) paths[id] = measure(ll);
      }
      m.setLatLng(paths[id] ? paths[id].ll[0] : p.ll);
    }
    const ids = Object.keys(paths);
    if (!ids.length) return;
    const dur = 900 / S.speed;
    const t0 = performance.now();
    const ease = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    const step = (now) => {
      const f = Math.min(1, (now - t0) / dur);
      for (const id of ids) charMarkers[id].setLatLng(pointAlong(paths[id], ease(f)));
      if (f < 1) anim.raf = requestAnimationFrame(step); else anim = null;
    };
    anim = { raf: requestAnimationFrame(step) };
  }
  function measure(ll) {
    const cum = [0];
    for (let i = 1; i < ll.length; i++) {
      const k = Math.cos(ll[i][0] * Math.PI / 180);
      cum.push(cum[i - 1] + Math.hypot(ll[i][0] - ll[i - 1][0], (ll[i][1] - ll[i - 1][1]) * k));
    }
    return { ll, cum, total: cum[cum.length - 1] };
  }
  function pointAlong(path, f) {
    const d = f * path.total, c = path.cum;
    if (path.total === 0 || f >= 1) return path.ll[path.ll.length - 1];
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= d) lo = mid; else hi = mid; }
    const seg = c[hi] - c[lo] || 1, t = (d - c[lo]) / seg, a = path.ll[lo], b = path.ll[hi];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  // ------------------------------------------------------------------ card
  let cardCollapsed = window.matchMedia('(max-width: 760px)').matches;
  let cardMore = false;
  function renderCard(ev) {
    const card = $('card');
    $('bar').classList.toggle('collapsed', cardCollapsed);
    if (!ev) {
      card.innerHTML = '<div class="card-sum muted">No scenes match the current filters. Turn on a character or a chapter.</div>';
      return;
    }
    const planes = ev.plane.split('+').filter((p) => PLANES[p]).map((p) => `<span class="chip plane">${esc(PLANES[p])}</span>`).join('');
    const chips = ev.chars.map((c) => `<span class="chip"><span class="dot" style="--c:${uiColor(c)}"></span>${esc(charName(c))}</span>`).join('');
    const qn = ev.lat == null ? 'Not on the map: the episode never says where this happens.' : (QUALITY_NOTE[ev.cq] || '');
    const conf = { high: 'High', medium: 'Medium', low: 'Low' }[ev.conf] || ev.conf;
    card.innerHTML = `
      <div class="card-top">
        <div class="titles">
          <div class="card-ep"><b>${ev.id}</b> · ${esc(epText(ev))}</div>
          <div class="card-loc"><button type="button" id="card-focus" title="Show on the map">${esc(ev.ln)}</button></div>
          <div class="card-date">${esc(dateText(ev))}</div>
        </div>
        <button class="icon-btn collapse-btn" id="card-toggle" aria-label="${cardCollapsed ? 'Show scene details' : 'Hide scene details'}" aria-expanded="${!cardCollapsed}">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="card-body">
        <div class="chips">${chips}${planes}</div>
        <div class="card-sum">${esc(ev.sum)}</div>
        <button type="button" class="link more-btn" id="card-more-btn" aria-expanded="${cardMore}">${cardMore ? 'Hide details' : 'Details: quote, who else was there'}</button>
        <div class="card-more" ${cardMore ? '' : 'hidden'}>
          ${ev.ld ? `<p><b>Where:</b> ${esc(ev.ld)}</p>` : ''}
          ${ev.dep ? `<p><b>The photograph shows:</b> ${esc(ev.dep)}</p>` : ''}
          ${ev.q ? `<p><q>${esc(ev.q)}</q></p>` : ''}
          ${ev.trav ? `<p><b>Getting there:</b> ${esc(ev.trav)}</p>` : ''}
          ${ev.npcs ? `<p><b>Also present:</b> ${esc(ev.npcs)}</p>` : ''}
          <p>${qn ? esc(qn) + ' ' : ''}Confidence that they were here: ${esc(conf)}.</p>
        </div>
      </div>`;
    $('card-toggle').onclick = () => { cardCollapsed = !cardCollapsed; renderCard(curEv()); };
    $('card-more-btn').onclick = () => { cardMore = !cardMore; renderCard(curEv()); };
    $('card-focus').onclick = () => focusScene(curEv(), true);
  }

  // ------------------------------------------------------------------ scene list + scrubber
  function renderList() {
    const ol = $('scene-list');
    let html = '', lastEp = null;
    list.forEach((e, idx) => {
      if (e.ep !== lastEp) { html += `<li class="ep-head">${esc(epText(e))}</li>`; lastEp = e.ep; }
      html += `<li class="scene" data-idx="${idx}">
        <div class="s-top"><span class="s-id">${e.id}</span><span>${esc(dateText(e))}</span></div>
        <div class="s-loc">${esc(e.ln)}${e.lat == null ? ' <span class="nomap">(not on map)</span>' : ''}</div>
        <div class="s-sum">${dotsHtml(e.chars)} ${esc(e.sum)}</div></li>`;
    });
    ol.innerHTML = html || '<li class="muted">No scenes match.</li>';
    $('scene-count').textContent = `(${list.length})`;
  }
  function updateListActive(scroll) {
    const ol = $('scene-list');
    const prev = ol.querySelector('li.active');
    if (prev) prev.classList.remove('active');
    const li = ol.querySelector(`li.scene[data-idx="${S.cur}"]`);
    if (!li) return;
    li.classList.add('active');
    if (scroll) {
      const body = $('panel-body');
      const r = li.getBoundingClientRect(), br = body.getBoundingClientRect();
      if (r.top < br.top + 40 || r.bottom > br.bottom) body.scrollTop += r.top - br.top - br.height / 3;
    }
  }
  function renderScrub() {
    const segs = [];
    list.forEach((e, idx) => {
      const last = segs[segs.length - 1];
      if (last && last.ep === e.ep) last.n++;
      else segs.push({ ep: e.ep, start: idx, n: 1, e });
    });
    let alt = { 1: false, 2: false };
    $('scrub-segs').innerHTML = segs.map((s) => {
      const c = s.e.fb ? 'fb' : 'c' + s.e.ch;
      alt[s.e.ch] = !alt[s.e.ch];
      return `<div class="${c}${alt[s.e.ch] ? '' : ' alt'}" style="flex:${s.n}" data-start="${s.start}" data-end="${s.start + s.n - 1}" title="${esc(epText(s.e))}"></div>`;
    }).join('');
  }
  function updateScrub() {
    const n = list.length;
    $('playhead').style.left = n ? `${((S.cur + 0.5) / n) * 100}%` : '0';
    $('playhead').hidden = !n;
    $('pos').textContent = n ? `Scene ${S.cur + 1} of ${n}` : '';
    const sc = $('scrub');
    sc.setAttribute('aria-valuemin', 1); sc.setAttribute('aria-valuemax', n); sc.setAttribute('aria-valuenow', S.cur + 1);
    const e = curEv();
    sc.setAttribute('aria-valuetext', e ? `${e.id}, ${e.ln}` : '');
    $('scrub-segs').querySelectorAll('div').forEach((d) => {
      d.classList.toggle('cur', S.cur >= +d.dataset.start && S.cur <= +d.dataset.end);
    });
  }

  // ------------------------------------------------------------------ navigation
  function boundsFor(ev) {
    const b = L.latLngBounds([]);
    if (!ev) return b;
    if (ev.lat != null) b.extend(eventLatLng(ev));
    for (const l of currentLegs(ev)) for (const p of l.p) for (const ll of p.ll) b.extend(ll);
    return b;
  }
  function innerViewBounds() {
    const P = pads(), size = map.getSize();
    return L.latLngBounds(map.containerPointToLatLng(P.paddingTopLeft),
      map.containerPointToLatLng(size.subtract(P.paddingBottomRight)));
  }
  function focusScene(ev, zoomIn) {
    const b = boundsFor(ev);
    if (!b.isValid()) return;
    const z = map.getZoom();
    if (!zoomIn && innerViewBounds().contains(b)) return;
    const opts = Object.assign(pads(), { maxZoom: zoomIn ? Math.max(z, 15) : z, duration: 0.6 });
    map.flyToBounds(b, opts);
  }
  function fitVisible() {
    const b = L.latLngBounds([]);
    routeGroup.eachLayer((l) => b.extend(l.getBounds()));
    pinGroup.eachLayer((m) => b.extend(m.getLatLng()));
    if (b.isValid()) map.fitBounds(b, Object.assign(pads(), { maxZoom: 15 }));
  }

  function setCursor(idx, opts) {
    opts = opts || {};
    if (!list.length) { S.cur = 0; renderCursor(null); return; }
    idx = Math.max(0, Math.min(list.length - 1, idx));
    const changed = idx !== S.cur;
    S.cur = idx;
    if (S.show !== 'all' && (changed || opts.force)) { renderRoutes(); renderPins(); }
    else if (changed || opts.force) renderPins();
    renderCursor(curEv(), opts);
    if (opts.pan) focusScene(curEv(), opts.pan === 'zoom');
  }
  function renderCursor(ev, opts) {
    opts = opts || {};
    renderHighlight(ev);
    renderHalo(ev);
    renderChars(ev, opts.animate);
    renderCard(ev);
    updateScrub();
    updateListActive(opts.scrollList !== false);
    updateHash();
  }
  function jumpTo(id, pan) {
    const idx = list.findIndex((e) => e.id === id);
    if (idx >= 0) { stop(); setCursor(idx, { pan: pan || 'auto' }); }
  }

  // ------------------------------------------------------------------ playback
  let timer = null;
  function play() {
    if (!list.length) return;
    S.playing = true;
    $('bar').classList.add('playing');
    $('play').setAttribute('aria-label', 'Pause');
    if (S.cur >= list.length - 1) { setCursor(0, { pan: 'auto' }); tick(); }
    else advance();
  }
  function advance() {
    if (!S.playing) return;
    if (S.cur >= list.length - 1) { stop(); return; }
    setCursor(S.cur + 1, { animate: true, pan: 'auto' });
    tick();
  }
  function tick() {
    clearTimeout(timer);
    timer = setTimeout(advance, 1700 / S.speed);
  }
  function stop() {
    S.playing = false;
    clearTimeout(timer);
    $('bar').classList.remove('playing');
    $('play').setAttribute('aria-label', 'Play');
  }

  // ------------------------------------------------------------------ filters
  function rebuildList(keepId) {
    const old = keepId ? evById[keepId] : null;
    list = events.filter(eventPasses);
    let idx = 0;
    if (old) {
      idx = list.findIndex((e) => e.i >= old.i);
      if (idx < 0) idx = list.length - 1;
    }
    S.cur = Math.max(0, idx);
    computeOffsets();
    renderList();
    renderScrub();
  }
  function renderAll() {
    renderRoutes();
    renderPins();
    renderCursor(curEv(), { scrollList: false });
  }
  function filtersChanged() {
    const keep = curEv() ? curEv().id : null;
    rebuildList(keep);
    renderAll();
    syncControls();
  }

  function buildControls() {
    const cl = $('char-list');
    cl.innerHTML = chars.map((c) => `<li class="char-row">
      <label><input type="checkbox" data-char="${c.id}" checked>
        <span class="swatch" style="--c:${c.color}"></span>
        <span class="char-text"><span class="char-name">${esc(c.name)}</span><span class="char-note">${esc(c.note)}</span></span></label>
      <button class="only" data-only="${c.id}" title="Show only ${esc(c.name)}">only</button></li>`).join('');
    cl.addEventListener('change', (e) => {
      const id = e.target.dataset.char;
      if (!id) return;
      if (e.target.checked) S.chars.add(id); else S.chars.delete(id);
      filtersChanged();
    });
    cl.addEventListener('click', (e) => {
      const id = e.target.dataset && e.target.dataset.only;
      if (!id) return;
      S.chars = new Set([id]);
      filtersChanged();
    });
    $('chars-all').onclick = () => { S.chars = new Set(chars.map((c) => c.id)); filtersChanged(); };
    $('chars-none').onclick = () => { S.chars = new Set(); filtersChanged(); };

    const ml = $('mode-list');
    ml.innerHTML = MODE_ORDER.map((m) => {
      const s = MODES[m];
      const dash = s.dash ? `stroke-dasharray="${s.dash}"` : '';
      return `<li class="mode-row"><label><input type="checkbox" data-mode="${m}" checked>
        <svg width="40" height="12" aria-hidden="true"><line x1="4" y1="6" x2="36" y2="6" stroke="currentColor" stroke-width="${s.weight}" stroke-linecap="round" ${dash}/></svg>
        <span>${esc(s.label)} <span class="muted small">(${esc(s.note)})</span></span></label></li>`;
    }).join('');
    ml.addEventListener('change', (e) => {
      const m = e.target.dataset.mode;
      if (!m) return;
      if (e.target.checked) S.modes.add(m); else S.modes.delete(m);
      renderRoutes();
    });
    $('inferred').addEventListener('change', (e) => { S.inferred = e.target.checked; renderRoutes(); });

    segControl('chapter-seg', () => S.chapter, (v) => { S.chapter = v; filtersChanged(); });
    segControl('show-seg', () => S.show, (v) => { S.show = v; renderRoutes(); renderPins(); updateHash(); });

    $('prev').onclick = () => { stop(); setCursor(S.cur - 1, { pan: 'auto' }); };
    $('next').onclick = () => { stop(); setCursor(S.cur + 1, { animate: true, pan: 'auto' }); };
    $('play').onclick = () => (S.playing ? stop() : play());
    $('speed').onchange = (e) => { S.speed = +e.target.value; };

    $('scene-list').addEventListener('click', (e) => {
      const li = e.target.closest('li.scene');
      if (!li) return;
      stop();
      setCursor(+li.dataset.idx, { pan: 'zoom', scrollList: false });
      closePanel();
    });

    // scrubber
    const sc = $('scrub');
    let dragging = false;
    const idxAt = (x) => {
      const r = sc.getBoundingClientRect();
      return Math.floor(Math.max(0, Math.min(0.9999, (x - r.left) / r.width)) * list.length);
    };
    sc.addEventListener('pointerdown', (e) => {
      if (!list.length) return;
      dragging = true; stop(); sc.setPointerCapture(e.pointerId);
      setCursor(idxAt(e.clientX));
    });
    sc.addEventListener('pointermove', (e) => { if (dragging) setCursor(idxAt(e.clientX)); });
    const end = () => { if (dragging) { dragging = false; focusScene(curEv(), false); } };
    sc.addEventListener('pointerup', end);
    sc.addEventListener('pointercancel', end);
    sc.addEventListener('keydown', (e) => {
      const segs = [...$('scrub-segs').children];
      const curSeg = segs.findIndex((d) => S.cur >= +d.dataset.start && S.cur <= +d.dataset.end);
      let to = null;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') to = S.cur - 1;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') to = S.cur + 1;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = list.length - 1;
      else if (e.key === 'PageUp' && curSeg > 0) to = +segs[curSeg - 1].dataset.start;
      else if (e.key === 'PageDown' && curSeg < segs.length - 1) to = +segs[curSeg + 1].dataset.start;
      if (to == null) return;
      e.preventDefault(); e.stopPropagation(); stop();
      setCursor(to, { pan: 'auto', animate: to === S.cur + 1 });
    });

    // links inside popups
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('[data-scene]');
      if (!a) return;
      e.preventDefault();
      jumpTo(a.dataset.scene, 'auto');
    }, true);  // capture: Leaflet stops click propagation out of popups

    // keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t.closest && t.closest('input, select, textarea, button, [role="slider"], .leaflet-container')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); stop(); setCursor(S.cur + 1, { animate: true, pan: 'auto' }); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); setCursor(S.cur - 1, { pan: 'auto' }); }
      else if (e.key === ' ') { e.preventDefault(); S.playing ? stop() : play(); }
    });

    // mobile drawer
    $('panel-open').onclick = openPanel;
    $('panel-close').onclick = closePanel;
    $('backdrop').onclick = closePanel;
  }
  function segControl(id, get, set) {
    const el = $(id);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      set(b.dataset.v);
      syncControls();
    });
  }
  function syncControls() {
    for (const [id, v] of [['chapter-seg', S.chapter], ['show-seg', S.show]]) {
      $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
    }
    document.querySelectorAll('#char-list input[data-char]').forEach((i) => { i.checked = S.chars.has(i.dataset.char); });
  }
  function openPanel() { $('panel').classList.add('open'); $('backdrop').hidden = false; }
  function closePanel() { $('panel').classList.remove('open'); $('backdrop').hidden = true; }

  // ------------------------------------------------------------------ URL hash (shareable links)
  let hashTimer = null;
  function updateHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const p = new URLSearchParams();
      const e = curEv();
      if (e) p.set('scene', e.id);
      if (S.chars.size !== chars.length) p.set('chars', [...S.chars].join(','));
      if (S.chapter !== 'all') p.set('ch', S.chapter);
      if (S.show !== 'all') p.set('show', S.show);
      const h = '#' + p.toString().replace(/%2C/g, ',');
      if (h !== location.hash) { try { history.replaceState(null, '', h); } catch (err) { /* file:// in some browsers */ } }
    }, 250);
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    S.chars = new Set(chars.map((c) => c.id)); S.chapter = 'all'; S.show = 'all';
    if (p.get('chars') != null) S.chars = new Set(p.get('chars').split(',').filter((c) => c in charIdx));
    if (['1', '2'].includes(p.get('ch'))) S.chapter = p.get('ch');
    if (['upto', 'day'].includes(p.get('show'))) S.show = p.get('show');
    return p.get('scene');
  }

  // ------------------------------------------------------------------ zoom-dependent bits
  let lastLabels = null, lastScale = null;
  map.on('zoomend', () => {
    const z = map.getZoom();
    const labels = z >= LABEL_ZOOM;
    if (labels !== lastLabels) { lastLabels = labels; renderPins(); }
    if (wscale(z) !== lastScale) {
      lastScale = wscale(z);
      for (const p of allParts) if (p.layer) p.layer.setStyle({ weight: MODES[p.m].weight * lastScale });
      renderHighlight(curEv());
    }
  });

  window.addEventListener('hashchange', () => {
    const id = readHash();
    stop();
    rebuildList(id && evById[id] ? id : (curEv() ? curEv().id : null));
    renderAll();
    syncControls();
    updateListActive(true);
    focusScene(curEv(), true);
  });

  // keep the bottom bar clear of the map credits, which wrap on narrow screens
  function placeBar() {
    const a = document.querySelector('.leaflet-control-attribution');
    $('bar').style.bottom = ((a ? a.offsetHeight : 16) + 8) + 'px';
  }
  window.addEventListener('resize', placeBar);

  // ------------------------------------------------------------------ start
  buildControls();
  placeBar();
  const sceneFromHash = readHash();
  rebuildList(sceneFromHash && evById[sceneFromHash] ? sceneFromHash : null);
  syncControls();
  renderCard(curEv());
  map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lon])), pads());
  lastLabels = map.getZoom() >= LABEL_ZOOM;
  lastScale = wscale(map.getZoom());
  renderAll();
  if (sceneFromHash && evById[sceneFromHash]) { updateListActive(true); focusScene(curEv(), true); }
})();
