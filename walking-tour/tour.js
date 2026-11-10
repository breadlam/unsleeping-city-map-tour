/* Unsleeping City walking tours. Needs Leaflet 1.9 and tour_data.js (window.TOUR_DATA). */
(function () {
  'use strict';
  const D = window.TOUR_DATA;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DARK = new Set(D.darkTextLines);
  const ACCENT = '#c2185b';
  const WALK = '#2b2d31';
  const FERRY = '#1e88e5';

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
  const bullet = (r, lg) => `<span class="bullet${DARK.has(r) ? ' dark' : ''}${lg ? ' lg' : ''}" style="--c:${D.lineColors[r] || '#808183'}" aria-label="${esc(r)} train">${esc(r)}</span>`;
  const bullets = (rs, lg) => `<span class="bullets">${rs.map((r) => bullet(r, lg)).join('')}</span>`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function hours(h) {
    const whole = Math.floor(h), half = h - whole >= 0.5;
    return half ? `${whole}½ hours` : `${whole} hours`;
  }

  // ------------------------------------------------------------------ state
  const S = { ch: 0, day: 0, stop: null, extras: true };
  const tour = () => D.tours[S.ch];
  const day = () => tour().days[S.day];

  // ------------------------------------------------------------------ map
  const map = L.map('map', { zoomControl: false, minZoom: 10, maxZoom: 18 });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.control.zoom({ position: 'topright' }).addTo(map);
  const esri = (svc, opts) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`, opts);
  const ESRI_ATTR = 'Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community';
  const bases = {
    'Streets': esri('World_Street_Map', { maxNativeZoom: 19, maxZoom: 18, className: 'tiles-muted', attribution: ESRI_ATTR }),
    'Light gray': L.layerGroup([
      esri('Canvas/World_Light_Gray_Base', { maxNativeZoom: 16, maxZoom: 18, attribution: ESRI_ATTR }),
      esri('Canvas/World_Light_Gray_Reference', { maxNativeZoom: 16, maxZoom: 18 }),
    ]),
    'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }),
  };
  bases['Streets'].addTo(map);
  L.control.layers(bases, null, { position: 'topright' }).addTo(map);
  map.attributionControl.addAttribution('Routes: OSRM / FOSSGIS; subway: MTA via data.ny.gov');

  const Legend = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function () {
      const d = L.DomUtil.create('div', 'legend');
      d.innerHTML =
        `<div><svg width="34" height="10"><line x1="3" y1="5" x2="31" y2="5" stroke="${WALK}" stroke-width="4" stroke-linecap="round" stroke-dasharray="0.1 7"/></svg>Walk</div>` +
        `<div><svg width="34" height="10"><line x1="3" y1="5" x2="31" y2="5" stroke="#00933C" stroke-width="5" stroke-linecap="round"/></svg>Subway (in the line's color)</div>` +
        `<div><svg width="34" height="10"><line x1="3" y1="5" x2="31" y2="5" stroke="${FERRY}" stroke-width="3.5" stroke-dasharray="8 5"/></svg>Ferry</div>` +
        `<div><svg width="34" height="16"><circle cx="17" cy="8" r="6" fill="#fff" stroke="${ACCENT}" stroke-width="3"/></svg>More places (optional)</div>`;
      return d;
    },
  });
  new Legend().addTo(map);

  const routeLayer = L.layerGroup().addTo(map);
  const otherLayer = L.layerGroup().addTo(map);
  const extrasLayer = L.layerGroup().addTo(map);
  const stopLayer = L.layerGroup().addTo(map);
  const stopMarkers = {};
  const svg = L.svg({ padding: 0.5 });

  function drawParts(parts, opts) {
    const bounds = L.latLngBounds([]);
    const casing = [], top = [], labels = [];
    for (const p of parts) {
      const ll = decode(p.e);
      ll.forEach((x) => bounds.extend(x));
      if (p.mode === 'walk') {
        casing.push(L.polyline(ll, { renderer: svg, color: '#fff', weight: 7, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }));
        top.push(L.polyline(ll, { renderer: svg, color: WALK, weight: 4, opacity: 0.95, dashArray: '0.1 7', lineCap: 'round', lineJoin: 'round', interactive: false }));
      } else if (p.mode === 'subway') {
        casing.push(L.polyline(ll, { renderer: svg, color: '#fff', weight: 9, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }));
        const line = L.polyline(ll, { renderer: svg, color: p.color, weight: 5.5, opacity: 1, lineCap: 'round', lineJoin: 'round' });
        line.bindTooltip(`${bullets(p.lines)} <span>${esc(p.direction)} from ${esc(p.from)} to ${esc(p.to)}</span>`, { sticky: true });
        top.push(line);
        const mid = ll[Math.floor(ll.length / 2)];
        labels.push(L.marker(mid, { interactive: false, keyboard: false,
          icon: L.divIcon({ className: '', html: `<span class="bullets" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">${p.lines.map((r) => bullet(r, true)).join('')}</span>`,
            iconSize: [24 * p.lines.length, 22], iconAnchor: [12 * p.lines.length, 11] }) }));
      } else {
        top.push(L.polyline(ll, { renderer: svg, color: FERRY, weight: 3.5, opacity: 0.95, dashArray: '9 6', lineCap: 'round', interactive: !!opts.label }));
        if (opts.label) top[top.length - 1].bindTooltip(esc(opts.label), { sticky: true, className: 'ferry-label' });
      }
    }
    casing.concat(top, labels).forEach((l) => routeLayer.addLayer(l));
    return bounds;
  }

  function stopIcon(n, cls) {
    const big = cls !== 'other';
    const s = big ? 30 : 22;
    return L.divIcon({ className: '', html: `<div class="stop-pin ${cls || ''}">${n}</div>`, iconSize: [s, s], iconAnchor: [s / 2, s / 2], popupAnchor: [0, -s / 2] });
  }

  function renderMap(fit) {
    routeLayer.clearLayers(); otherLayer.clearLayers(); extrasLayer.clearLayers(); stopLayer.clearLayers();
    const d = day();
    const bounds = L.latLngBounds([]);
    for (const s of d.stops) if (s.excursion) drawParts([{ mode: 'ferry', e: s.excursion.e }], { label: s.excursion.label });  // not in the fit: it runs far out to Staten Island
    for (const leg of d.legs) bounds.extend(drawParts(leg.parts, {}));
    tour().days.forEach((od, di) => {
      if (di === S.day) return;
      for (const s of od.stops) {
        const m = L.marker([s.lat, s.lon], { icon: stopIcon(s.n, 'other'), title: `${od.title.split(':')[0]}, stop ${s.n}: ${s.name}`, zIndexOffset: -100 });
        m.on('click', () => { S.day = di; S.stop = s.n; render(true); });
        otherLayer.addLayer(m);
      }
    });
    if (S.extras) {
      for (const x of tour().extras) {
        const m = L.marker([x.lat, x.lon], { icon: L.divIcon({ className: '', html: '<div class="extra-pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), title: x.name });
        m.bindPopup(`<div class="pp-title">${esc(x.name)}</div><div>${esc(x.story)}</div><a class="pp-more" href="#${x.id}" data-extra="${x.id}">More</a>`, { maxWidth: 300 });
        extrasLayer.addLayer(m);
      }
    }
    for (const s of d.stops) {
      bounds.extend([s.lat, s.lon]);
      const m = L.marker([s.lat, s.lon], { icon: stopIcon(s.n, S.stop === s.n ? 'active' : ''), title: `${s.n}. ${s.name}`, zIndexOffset: 1000 - s.n,
        riseOnHover: true });
      m.bindPopup(`<div class="pp-title"><span class="n">${s.n}</span>${esc(s.name)}</div><div>${esc(firstSentence(s.story))}</div>` +
        `<a class="pp-more" href="#" data-stop="${s.n}">Read more</a>`, { maxWidth: 300 });
      m.on('click', () => selectStop(s.n, false));
      stopMarkers[s.n] = m;
      stopLayer.addLayer(m);
    }
    if (fit) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }
  function firstSentence(t) {
    // drop "(Ep. 7)"-style references, then take sentences until there's something to read
    const text = t.replace(/\s*\((?:Eps?\.|the theater)[^)]*\)/g, '');
    const re = /[.!?]\s+(?=[A-Z'])/g;  // no lookbehind: older Safari can't parse it
    let m;
    while ((m = re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 3), m.index);
      if (/(St|Dr)$/.test(before)) continue;  // "St. Owen's" is not a sentence end
      if (m.index + 1 >= 60) return text.slice(0, m.index + 1);
    }
    return text;
  }

  // ------------------------------------------------------------------ itinerary
  function stationsHtml(sts) {
    if (!sts || !sts.length) return '';
    return '<span class="stations">' + sts.map((st) =>
      `<span class="station">${bullets(st.routes)} ${esc(st.name)}${st.accessible === 'yes' ? ' <span class="acc" title="Step-free access (ADA accessible)">accessible</span>' : ''} <span class="muted">(${st.walk_m} m)</span></span>`).join('') + '</span>';
  }
  function scenesHtml(scenes) {
    return '<div class="scenes">' + scenes.map((x) =>
      `<a class="scene" href="${esc(D.storyMapUrl)}#scene=${x.id}" target="_blank" rel="noopener" title="${esc(x.title)}: ${esc(x.sum)}">${x.id}</a>`).join('') + '</div>';
  }
  const gmaps = (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`;

  function legHtml(leg) {
    const sub = leg.parts.find((p) => p.mode === 'subway');
    const cls = leg.type === 'subway' ? 'subway' : leg.type === 'ferry' ? 'ferry' : '';
    const style = sub ? ` style="--c:${sub.color}"` : '';
    let body;
    if (leg.type === 'walk') {
      body = `<span class="t">${esc(leg.steps[0])}</span>`;
    } else {
      const items = leg.steps.map((st) => {
        if (typeof st === 'string') return `<li>${esc(st)}</li>`;
        const stops = st.lines.length === 1 && st.stops ? `, ${plural(st.stops, 'stop')}` : '';
        return `<li>${bullets(st.lines)} <span class="t">${esc(st.text)}</span> <span>(about ${st.minutes} min${stops})</span></li>`;
      }).join('');
      body = `<span class="t">About ${leg.minutes} min</span><ol>${items}</ol>${leg.note ? `<div class="note">${esc(leg.note)}</div>` : ''}`;
    }
    return `<li class="leg ${cls}"${style}>${body}</li>`;
  }

  function renderList() {
    const t = tour(), d = day();
    const tot = d.totals;
    let html = `<section class="intro"><p class="tagline">${esc(t.tagline)}</p><p class="season">${esc(t.season)}</p></section>
      <nav class="days" role="tablist" aria-label="Day">${t.days.map((x, i) =>
        `<button role="tab" data-day="${i}" aria-selected="${i === S.day}">${esc(x.title.split(':')[0])}</button>`).join('')}</nav>
      <section class="day-head"><h2>${esc(d.title)}</h2><p>${esc(d.intro)}</p>
        <ul class="totals"><li>${plural(tot.stops, 'stop')}</li><li>${tot.walk_km} km on foot</li>
          <li>${tot.rides ? plural(tot.rides, 'subway ride') : 'no subway needed'}</li><li>about ${hours(tot.hours)} with visits</li></ul></section>
      <ol class="stops">`;
    d.stops.forEach((s, i) => {
      html += `<li class="stop${S.stop === s.n ? ' active' : ''}" id="stop-${s.n}">
        <button class="num" data-stop="${s.n}" aria-label="Show stop ${s.n} on the map">${s.n}</button>
        <h3><button data-stop="${s.n}">${esc(s.name)}</button></h3>
        <p>${esc(s.story)}</p>
        <p class="visit"><b>Visiting:</b> ${esc(s.visit)}</p>
        ${s.excursion ? `<p class="muted"><b>Side trip:</b> ${esc(s.excursion.label)}</p>` : ''}
        <div class="meta">${stationsHtml(s.stations)}</div>
        <div class="meta"><span>Allow about ${s.dwell} min</span><a class="dir" href="${gmaps(s.lat, s.lon)}" target="_blank" rel="noopener">Directions in Google Maps</a></div>
        ${scenesHtml(s.scenes)}
      </li>`;
      if (i < d.legs.length) html += legHtml(d.legs[i]);
    });
    html += `</ol>
      <section class="extras"><h2>More places from Chapter ${t.chapter}</h2>
        <p>Off the main route, for a longer weekend.</p>
        <label class="check"><input type="checkbox" id="show-extras"${S.extras ? ' checked' : ''}> Show them on the map</label>
        ${t.extras.map((x) => `<div class="extra" id="${x.id}"><span class="dot"></span>
          <h3><button data-extra="${x.id}">${esc(x.name)}</button></h3><p>${esc(x.story)}</p>
          <p class="muted">${esc(x.visit)}</p><div class="meta">${stationsHtml(x.stations)}</div>${scenesHtml(x.scenes)}</div>`).join('')}
      </section>`;
    $('itinerary').innerHTML = html;
    $('kml-link').href = `tour_chapter${t.chapter}.kml`;
    $('print-link').href = `maps/tour_chapter${t.chapter}_day${S.day + 1}.jpg`;
    document.querySelectorAll('#chapter-seg button').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.ch === S.ch)));
  }

  // ------------------------------------------------------------------ interaction
  function render(fit) {
    renderList();
    renderMap(fit);
    updateHash();
    if (S.stop) scrollToStop(S.stop);
  }
  function scrollToStop(n) {
    const el = $(`stop-${n}`);
    if (!el) return;
    const narrow = window.matchMedia('(max-width: 800px)').matches;
    if (narrow) {
      const top = el.getBoundingClientRect().top + window.scrollY - $('mapwrap').offsetHeight - 60;
      window.scrollTo({ top, behavior: 'smooth' });
    } else {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  function selectStop(n, fly) {
    S.stop = n;
    document.querySelectorAll('.stop.active').forEach((e) => e.classList.remove('active'));
    const el = $(`stop-${n}`);
    if (el) el.classList.add('active');
    for (const [k, m] of Object.entries(stopMarkers)) m.setIcon(stopIcon(+k, +k === n ? 'active' : ''));
    const s = day().stops[n - 1];
    if (fly && s) {
      map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 15), { duration: 0.6 });
      stopMarkers[n].openPopup();
    }
    if (!fly) scrollToStop(n);
    updateHash();
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('[data-stop],[data-day],[data-ch],[data-extra]') : null;
    if (!t) return;
    if (t.dataset.ch != null) { S.ch = +t.dataset.ch; S.day = 0; S.stop = null; render(true); return; }
    if (t.dataset.day != null) { S.day = +t.dataset.day; S.stop = null; render(true); return; }
    if (t.dataset.stop != null) {
      e.preventDefault();
      const n = +t.dataset.stop;
      const inPopup = !!t.closest('.leaflet-popup');
      if (inPopup) { map.closePopup(); selectStop(n, false); } else selectStop(n, true);
      return;
    }
    if (t.dataset.extra != null) {
      e.preventDefault();
      const x = tour().extras.find((y) => y.id === t.dataset.extra);
      if (!x) return;
      if (t.closest('.leaflet-popup')) { map.closePopup(); $(x.id).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      if (!S.extras) { S.extras = true; renderMap(false); $('show-extras').checked = true; }
      map.flyTo([x.lat, x.lon], Math.max(map.getZoom(), 14), { duration: 0.6 });
      extrasLayer.eachLayer((m) => { if (m.getLatLng().lat === x.lat && m.getLatLng().lng === x.lon) setTimeout(() => m.openPopup(), 650); });
    }
  }, true);
  document.addEventListener('change', (e) => {
    if (e.target.id === 'show-extras') { S.extras = e.target.checked; renderMap(false); }
  });

  // ------------------------------------------------------------------ URL hash
  function updateHash() {
    const p = new URLSearchParams();
    p.set('chapter', S.ch + 1); p.set('day', S.day + 1);
    if (S.stop) p.set('stop', S.stop);
    const h = '#' + p.toString();
    if (h !== location.hash) { try { history.replaceState(null, '', h); } catch (err) { /* file:// */ } }
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const ch = +p.get('chapter'), d = +p.get('day'), st = +p.get('stop');
    if (ch >= 1 && ch <= D.tours.length) S.ch = ch - 1;
    if (d >= 1 && d <= tour().days.length) S.day = d - 1;
    S.stop = st >= 1 && st <= day().stops.length ? st : null;
  }
  window.addEventListener('hashchange', () => { readHash(); render(true); if (S.stop) selectStop(S.stop, true); });

  readHash();
  render(true);
  if (S.stop) selectStop(S.stop, true);
})();
