/*! Nusantara Flight Monitor — © 2026 M. Naufal Zamani. All rights reserved. Dilarang menyalin tanpa izin. */
/* =========================================================
   Nusantara Flight Monitor — app.js
   Library: PapaParse (CSV), Leaflet (peta), Chart.js (grafik)
   ========================================================= */
'use strict';

/* ---------- Konfigurasi ---------- */
const CFG = {
  dataPath: '',   // folder CSV
  otpLimit: 15,        // menit; standar OTP (≤ 15 menit = tepat waktu)
  mapTopN: 40,         // jumlah rute yang digambar di peta
  hotN: 5,             // rute tersibuk yang diberi animasi
  otpTarget: 85,       // target OTP (%) untuk insight & garis target
};

const S = {
  raw: {}, airlines: [], airports: [], flights: [],
  alIndex: {}, apIndex: {},
  period: 'all', airport: 'all', mapAirline: 'all', selAirline: null,
};
const charts = {};
let map, tiles, routeLayer, apLayer;

/* ---------- Helper ---------- */
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('id-ID');
const f1 = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compact = (v) => v >= 1e6 ? f1(v / 1e6) + ' jt' : v >= 1e4 ? f1(v / 1e3) + ' rb' : nf.format(Math.round(v));
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const theme = () => document.documentElement.dataset.theme;
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const monthLabel = (m) => `${BULAN[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const dayLabel = (d) => `${+d.slice(8, 10)} ${BLN[+d.slice(5, 7) - 1]}`;
const city = (c) => (S.apIndex[c] ? S.apIndex[c].city : c);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const PALETTE = ['#0a2a5e', '#00a3c7', '#1450b8', '#e39a0b', '#d64545', '#0f9d6b', '#7c3aed', '#db2777', '#0891b2', '#65a30d'];
const alColor = (code, i = 0) => (S.alIndex[code] && S.alIndex[code].color) || PALETTE[i % PALETTE.length];

/* ---------- Kolom wajib ---------- */
const REQ = {
  airlines: ['airline_code', 'airline_name'],
  airports: ['iata', 'lat', 'lon'],
  flights: ['date', 'airline_code', 'origin', 'destination', 'delay_min'],
};

/* Nama kolom alternatif yang otomatis dikenali (huruf kecil, spasi → _).
   Jadi CSV dengan "latitude", "origin_airport", "Departure_Delay_Minutes", dll. tetap terbaca. */
const ALIAS = {
  airlines: {
    airline_code: ['code', 'carrier', 'carrier_code', 'iata_code', 'kode', 'kode_maskapai'],
    airline_name: ['name', 'airline', 'maskapai', 'nama', 'nama_maskapai'],
    type: ['service_type', 'tipe', 'jenis', 'kategori'],
    fleet_active: ['fleet', 'fleet_size', 'armada', 'jumlah_armada'],
    logo: ['logo_url', 'logo_path'],
  },
  airports: {
    iata: ['code', 'airport_code', 'iata_code', 'kode', 'kode_bandara'],
    airport_name: ['name', 'airport', 'bandara', 'nama_bandara'],
    city: ['kota', 'kabupaten_kota'],
    province: ['provinsi', 'state', 'region'],
    lat: ['latitude', 'lintang'],
    lon: ['lng', 'long', 'longitude', 'bujur'],
    is_hub: ['hub'],
  },
  flights: {
    date: ['flight_date', 'fl_date', 'tanggal', 'tgl'],
    airline_code: ['airline', 'carrier', 'op_carrier', 'maskapai', 'airline_name'],
    origin: ['origin_airport', 'from', 'asal', 'dep_airport', 'bandara_asal'],
    destination: ['destination_airport', 'dest', 'to', 'tujuan', 'arr_airport', 'bandara_tujuan'],
    sched_dep: ['scheduled_departure', 'std', 'crs_dep_time', 'jadwal', 'jam_jadwal'],
    actual_dep: ['actual_departure', 'atd', 'dep_time', 'jam_realisasi'],
    delay_min: ['departure_delay_minutes', 'dep_delay', 'departure_delay', 'delay', 'menit_delay'],
    pax: ['passenger_count', 'passengers', 'penumpang', 'jumlah_penumpang'],
    status: ['flight_status'],
    delay_cause: ['delay_reason', 'cause', 'penyebab', 'penyebab_delay'],
    season: ['musim', 'periode_musim'],
    seats: ['capacity', 'kapasitas', 'seat', 'kursi'],
    flight_no: ['flight_number', 'flight_id', 'no_penerbangan'],
  },
};

function applyAliases(rows, kind) {
  if (!rows || !rows.length) return rows;
  const cols = Object.keys(rows[0]);
  const map = {};
  for (const [canon, alts] of Object.entries(ALIAS[kind])) {
    if (cols.includes(canon)) continue;
    const hit = alts.find((a) => cols.includes(a));
    if (hit) map[canon] = hit;
  }
  if (!Object.keys(map).length) return rows;
  return rows.map((r) => { const o = { ...r }; for (const [c, a] of Object.entries(map)) o[c] = r[a]; return o; });
}

// terima YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY (juga yang ada jamnya)
function normDate(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

function parseHour(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[:.](\d{2})/);
  if (m) return +m[1] < 24 ? +m[1] : null;
  const n = +s;
  if (!Number.isFinite(n)) return null;
  const h = n >= 100 ? Math.floor(n / 100) : Math.floor(n);   // 1345 → 13 (format HHMM)
  return h >= 0 && h < 24 ? h : null;
}
function parseMin(v) {
  if (v == null || v === '') return null;
  const m = String(v).trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (m) return +m[1] * 60 + +m[2];
  const n = +v;
  return Number.isFinite(n) ? (n >= 100 ? Math.floor(n / 100) * 60 + (n % 100) : n * 60) : null;
}
const _dowCache = {};
function dowOf(date) {   // Senin = 0 … Minggu = 6
  if (!(date in _dowCache)) _dowCache[date] = (new Date(date + 'T00:00:00').getDay() + 6) % 7;
  return _dowCache[date];
}

/* Logo maskapai: kolom "logo" di airlines.csv, atau otomatis assets/logos/<KODE>.png.
   Kalau file gambar tidak ada, tampil badge kode berwarna. */
const LOGO_DIR = '';
const LOGO_EXT = ['png', 'svg', 'webp', 'jpg', 'jpeg'];
S.logoOverride = {};
try { S.logoOverride = JSON.parse(localStorage.getItem('nfm-logos') || '{}') || {}; } catch (e) { S.logoOverride = {}; }

function logoSrc(code) {
  if (S.logoOverride[code]) return S.logoOverride[code];
  const a = S.alIndex[code];
  return (a && a.logo) ? String(a.logo) : `${LOGO_DIR}${code}.${LOGO_EXT[0]}`;
}
function logoImg(code, alt = '') {
  const custom = !!(S.logoOverride[code] || (S.alIndex[code] && S.alIndex[code].logo));
  return `<img src="${esc(logoSrc(code))}" alt="${esc(alt)}" data-code="${esc(code)}"${custom ? ' data-custom="1"' : ''} onerror="nextLogo(this)">`;
}
// coba ekstensi lain (GA.png → GA.svg → GA.webp → GA.jpg); kalau semua gagal, tampil badge kode
window.nextLogo = function (img) {
  const i = +(img.dataset.i || 0) + 1;
  if (img.dataset.custom || i >= LOGO_EXT.length) { img.remove(); return; }
  img.dataset.i = i;
  img.src = `${LOGO_DIR}${img.dataset.code}.${LOGO_EXT[i]}`;
};
function logoHTML(code, i = 0, cls = '') {
  return `<span class="al-badge ${cls}" style="--c:${alColor(code, i)}">${esc(code)}${logoImg(code)}</span>`;
}

// cocokkan nama file logo yang diunduh ke maskapai: "GA.png", "garuda-indonesia-logo.svg", "Lion_Air.png", ...
function matchLogoFile(fname) {
  const n = fname.toLowerCase().replace(/\.[^.]+$/, '');
  if (S.alIndex[n.toUpperCase()]) return n.toUpperCase();
  const flat = n.replace(/[^a-z0-9]/g, '');
  for (const a of S.airlines) if (flat.includes(a.airline_name.toLowerCase().replace(/[^a-z0-9]/g, ''))) return a.airline_code;
  for (const a of S.airlines) {
    const words = a.airline_name.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !['indonesia'].includes(w));
    if (words.some((w) => flat.includes(w))) return a.airline_code;
  }
  return null;
}
async function loadLogoFiles(files) {
  const ok = [], miss = [];
  for (const file of files) {
    const code = matchLogoFile(file.name);
    if (!code) { miss.push(file.name); continue; }
    S.logoOverride[code] = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
    });
    ok.push(code);
  }
  try { localStorage.setItem('nfm-logos', JSON.stringify(S.logoOverride)); } catch (e) { toast('Logo terpasang, tapi terlalu besar untuk disimpan permanen di browser.', true); }
  if (S.flights.length) renderAll({ skipMap: true });
  toast(`${ok.length ? `Logo terpasang: ${ok.join(', ')}` : 'Tidak ada logo yang cocok'}${miss.length ? ` · tidak dikenali: ${miss.join(', ')} (ganti nama jadi kode, mis. GA.png)` : ''}`, !ok.length);
}

/* =========================================================
   1. LOAD DATA
   ========================================================= */
const parseCSV = (text) => Papa.parse(text, {
  header: true, dynamicTyping: true, skipEmptyLines: true,
  transformHeader: (h) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/[\s\-]+/g, '_'),
}).data;

async function loadFromServer() {
  const names = ['airlines', 'airports', 'flights'];
  const texts = await Promise.all(names.map((n) =>
    fetch(CFG.dataPath + n + '.csv').then((r) => { if (!r.ok) throw new Error(n + '.csv ' + r.status); return r.text(); })));
  const out = Object.fromEntries(names.map((n, i) => [n, parseCSV(texts[i])]));
  // file hasil notebook ML (opsional)
  const opt = async (file, parse) => { try { const r = await fetch(CFG.dataPath + file); return r.ok ? parse(await r.text()) : null; } catch (e) { return null; } };
  out.delay_risk = await opt('delay_risk.csv', parseCSV);
  out.feature_importance = await opt('feature_importance.csv', parseCSV);
  out.model_metrics = await opt('model_metrics.json', JSON.parse);
  out.forecast = await opt('forecast.csv', parseCSV);
  out.forecast_history = await opt('forecast_history.csv', parseCSV);
  out.stat_models = await opt('stat_models.json', JSON.parse);
  return out;
}

async function readFiles(fileList) {
  const d = {};
  for (const file of fileList) {
    const n = file.name.toLowerCase();
    if (/model_metrics|stat_models/.test(n)) { try { d[/stat_models/.test(n) ? 'stat_models' : 'model_metrics'] = JSON.parse(await file.text()); } catch (e) { /* abaikan */ } continue; }
    if (/forecast_history/.test(n)) { d.forecast_history = parseCSV(await file.text()); continue; }
    if (/forecast/.test(n)) { d.forecast = parseCSV(await file.text()); continue; }
    const key = /delay_risk/.test(n) ? 'delay_risk'
      : /feature_importance/.test(n) ? 'feature_importance'
      : /airline|maskapai/.test(n) ? 'airlines'
      : /airport|bandara/.test(n) ? 'airports'
      : /flight|penerbangan/.test(n) ? 'flights' : null;
    if (key) d[key] = parseCSV(await file.text());
  }
  if (!Object.keys(d).length) throw new Error('Nama file harus mengandung "airlines", "airports", atau "flights".');
  return d;
}

function ingest(raw) {
  const d = {};
  for (const k of Object.keys(REQ)) {
    if (!raw[k] || !raw[k].length) throw new Error(`File ${k}.csv belum ada atau kosong.`);
    d[k] = applyAliases(raw[k], k);
    const miss = REQ[k].filter((c) => !(c in d[k][0]));
    if (miss.length) throw new Error(`Kolom wajib hilang di ${k}.csv: ${miss.join(', ')}. Kolom yang ada: ${Object.keys(raw[k][0]).join(', ')}`);
  }
  S.airlines = d.airlines.map((a) => ({
    ...a, airline_code: String(a.airline_code).trim(), airline_name: String(a.airline_name).trim(),
    type: a.type || '', group: a.group || '', fleet_active: +a.fleet_active || 0,
  }));
  S.airports = d.airports.map((a) => ({
    ...a, iata: String(a.iata).trim().toUpperCase(), lat: +a.lat, lon: +a.lon,
    airport_name: a.airport_name || a.iata, city: a.city || a.iata, province: a.province || '',
    is_hub: a.is_hub === true || /^(true|1|ya|yes)$/i.test(String(a.is_hub)),
  })).filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon));
  S.alIndex = Object.fromEntries(S.airlines.map((a) => [a.airline_code, a]));
  S.apIndex = Object.fromEntries(S.airports.map((a) => [a.iata, a]));
  // flights boleh menulis nama maskapai ("Garuda Indonesia") — dipetakan ke kodenya
  const byName = Object.fromEntries(S.airlines.map((a) => [a.airline_name.toLowerCase(), a.airline_code]));

  S.flights = d.flights.map((f) => {
    const status = String(f.status || '').trim();
    const cancelled = /cancel|batal/i.test(status) || f.cancelled === 1 || f.cancelled === true;
    const delay = cancelled ? 0 : Math.max(0, +f.delay_min || 0);
    const date = normDate(f.date);
    const hour = parseHour(f.sched_dep) ?? parseHour(String(f.date || '').split(/[ T]/)[1]);
    const sm = parseMin(f.sched_dep);
    const o = String(f.origin || '').trim().toUpperCase();
    const de = String(f.destination || '').trim().toUpperCase();
    const alRaw = String(f.airline_code || '').trim();
    const al = S.alIndex[alRaw] ? alRaw : (byName[alRaw.toLowerCase()] || alRaw);
    return {
      date, month: date.slice(0, 7), al, o, d: de, hour, dow: dowOf(date), sm,
      no: f.flight_no ? String(f.flight_no) : al,
      route: o < de ? `${o}|${de}` : `${de}|${o}`,
      delay, pax: cancelled ? 0 : (+f.pax || 0), cancelled,
      onTime: !cancelled && delay <= CFG.otpLimit,
      cause: f.delay_cause ? String(f.delay_cause).trim() : '',
      season: f.season ? String(f.season).trim() : '',
      seats: cancelled ? 0 : (+f.seats || 0),
    };
  }).filter((f) => f.date && f.o && f.d);

  if (!S.flights.length) throw new Error('flights.csv tidak punya baris valid (cek format tanggal: YYYY-MM-DD atau DD/MM/YYYY).');
}

/* =========================================================
   2. AGREGASI
   ========================================================= */
function stats(rows) {
  let ops = 0, ontime = 0, pax = 0, dSum = 0, dN = 0, allDelay = 0;
  for (const f of rows) {
    if (f.cancelled) continue;
    ops++; pax += f.pax; allDelay += f.delay;
    if (f.onTime) ontime++; else { dSum += f.delay; dN++; }
  }
  return {
    n: rows.length, ops, pax, delayed: dN,
    otp: ops ? (ontime / ops) * 100 : 0,
    avgDelay: dN ? dSum / dN : 0,            // rata-rata dari penerbangan yang delay
    avgDelayAll: ops ? allDelay / ops : 0,   // rata-rata semua penerbangan
    cancelRate: rows.length ? ((rows.length - ops) / rows.length) * 100 : 0,
  };
}

S.season = 'all';
function filterRows(period = S.period, airport = S.airport) {
  return S.flights.filter((f) =>
    (period === 'all' || f.month === period) &&
    (S.season === 'all' || f.season === S.season) &&
    (airport === 'all' || f.o === airport || f.d === airport));
}

function prevMonth(m) {
  let y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1;
  if (mo === 0) { mo = 12; y--; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

function groupRoutes(rows) {
  const g = new Map();
  for (const f of rows) {
    let r = g.get(f.route);
    if (!r) { const [a, b] = f.route.split('|'); r = { a, b, n: 0, ops: 0, ontime: 0, pax: 0, dSum: 0, dN: 0, al: {} }; g.set(f.route, r); }
    r.n++; r.al[f.al] = (r.al[f.al] || 0) + 1;
    if (!f.cancelled) { r.ops++; r.pax += f.pax; if (f.onTime) r.ontime++; else { r.dSum += f.delay; r.dN++; } }
  }
  return [...g.values()].map((r) => ({
    ...r, otp: r.ops ? (r.ontime / r.ops) * 100 : 0, avgDelay: r.dN ? r.dSum / r.dN : 0,
    topAl: Object.entries(r.al).sort((x, y) => y[1] - x[1])[0][0],
  })).sort((x, y) => y.n - x.n);
}

function byKey(rows, keyFn) {
  const g = new Map();
  for (const f of rows) { const k = keyFn(f); if (!g.has(k)) g.set(k, []); g.get(k).push(f); }
  return g;
}

function airlineRanking(rows) {
  return [...byKey(rows, (f) => f.al)].map(([code, r]) => ({ code, ...stats(r) }))
    .filter((x) => x.ops > 0).sort((a, b) => b.otp - a.otp);
}

/* =========================================================
   3. FILTER UI
   ========================================================= */
function buildFilters() {
  const months = [...new Set(S.flights.map((f) => f.month))].sort();
  if (S.period !== 'all' && !months.includes(S.period)) S.period = 'all';
  if (S.period === 'all' && !buildFilters.done) S.period = months[months.length - 1]; // default: bulan terbaru
  $('fPeriod').innerHTML = `<option value="all">Semua periode</option>` +
    months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  $('fPeriod').value = S.period;

  const used = new Set(S.flights.flatMap((f) => [f.o, f.d]));
  const aps = S.airports.filter((a) => used.has(a.iata))
    .sort((a, b) => (b.is_hub - a.is_hub) || a.city.localeCompare(b.city));
  $('fAirport').innerHTML = `<option value="all">Semua bandara</option>` +
    aps.map((a) => `<option value="${a.iata}">${a.iata} — ${esc(a.city)}${a.is_hub ? ' ★' : ''}</option>`).join('');
  if (S.airport !== 'all' && !used.has(S.airport)) S.airport = 'all';
  $('fAirport').value = S.airport;

  const seasons = [...new Set(S.flights.map((f) => f.season).filter(Boolean))];
  const ORDER = ['Reguler', 'Libur Sekolah', 'Nataru', 'Lebaran'];
  seasons.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  $('fSeasonWrap').hidden = !seasons.length;
  $('fSeason').innerHTML = `<option value="all">Semua musim</option>` + seasons.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  if (S.season !== 'all' && !seasons.includes(S.season)) S.season = 'all';
  $('fSeason').value = S.season;

  $('fMapAirline').innerHTML = `<option value="all">Semua maskapai</option>` +
    S.airlines.map((a) => `<option value="${a.airline_code}">${esc(a.airline_name)}</option>`).join('');
  $('fMapAirline').value = S.alIndex[S.mapAirline] ? S.mapAirline : 'all';
  S.mapAirline = $('fMapAirline').value;
  buildFilters.done = true;
}

/* =========================================================
   4. KPI
   ========================================================= */
function countUp(el, to, fmt, dur = 750) {
  const from = +el.dataset.v || 0; el.dataset.v = to;
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function delta(cur, prev, { goodUp = true, pts = false } = {}) {
  if (prev == null) return '';
  const diff = pts ? cur - prev : (prev ? ((cur - prev) / prev) * 100 : 0);
  const up = diff >= 0;
  return `<span class="delta ${up === goodUp ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${f1(Math.abs(diff))}${pts ? ' pp' : '%'}</span> vs bulan lalu · `;
}

function renderKPIs(rows) {
  const st = stats(rows);
  let pv = null;
  if (S.period !== 'all') {
    const pr = filterRows(prevMonth(S.period));
    if (pr.length) pv = stats(pr);
  }
  const days = new Set(rows.map((f) => f.date)).size || 1;

  countUp($('kFlights'), st.n, (v) => nf.format(Math.round(v)));
  $('kFlightsSub').innerHTML = delta(st.n, pv && pv.n) + `≈ ${nf.format(Math.round(st.n / days))}/hari · ${f1(st.cancelRate)}% batal`;

  countUp($('kOtp'), st.otp, f1);
  $('kOtpSub').innerHTML = delta(st.otp, pv && pv.otp, { pts: true }) + `batas ≤ ${CFG.otpLimit} menit`;

  countUp($('kPax'), st.pax, (v) => nf.format(Math.round(v)));
  const seats = rows.reduce((x, f) => x + f.seats, 0);
  $('kPaxSub').innerHTML = delta(st.pax, pv && pv.pax) + (seats ? `load factor <b>${f1(pct(st.pax, seats))}%</b>` : `rata-rata ${nf.format(Math.round(st.ops ? st.pax / st.ops : 0))} pax/penerbangan`);

  countUp($('kDelay'), st.avgDelay, f1);
  $('kDelaySub').innerHTML = delta(st.avgDelay, pv && pv.avgDelay, { goodUp: false }) + `dari ${nf.format(st.delayed)} penerbangan delay`;
}

/* =========================================================
   5. PETA NUSANTARA (rute + pesawat bergerak)
   ========================================================= */
let planeLayer, planeRAF = null, planeLastT = 0;
const PLANE_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>';
S.planes = [];
S.planesOn = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

function initMap() {
  // di HP: geser satu jari = scroll halaman, dua jari = geser/zoom peta
  map = L.map('map', { scrollWheelZoom: false, minZoom: 3.5, maxZoom: 12, zoomSnap: 0.25, dragging: !L.Browser.mobile, tap: !L.Browser.mobile })
    .fitBounds([[6.5, 94.5], [-11.2, 141.2]]);
  routeLayer = L.layerGroup().addTo(map);
  apLayer = L.layerGroup().addTo(map);
  planeLayer = L.layerGroup().addTo(map);
  setTiles();
  map.on('click', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());
  map.on('zoomend', () => placePlanes(0));
}

/* Basemap tanpa API key: Esri (abu-abu terang / gelap / satelit).
   Kalau Esri gagal dimuat, otomatis pindah ke OpenStreetMap. */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const BASEMAPS = {
  light: { url: ESRI + 'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors', maxNativeZoom: 16 },
  dark: { url: ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors', maxNativeZoom: 16 },
  sat: { url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics', maxNativeZoom: 18 },
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxNativeZoom: 19 },
};
S.base = 'sat';      // 'map' | 'sat' — default satelit biar megah
S.useOsm = false;    // true jika Esri gagal

function setTiles() {
  if (tiles) map.removeLayer(tiles);
  const key = S.base === 'sat' ? 'sat' : (S.useOsm ? 'osm' : (theme() === 'dark' ? 'dark' : 'light'));
  const b = BASEMAPS[key];
  const darkOsm = key === 'osm' && theme() === 'dark';
  tiles = L.tileLayer(b.url, {
    maxZoom: 12, maxNativeZoom: b.maxNativeZoom, attribution: b.attr,
    className: darkOsm ? 'osm-dark' : '',
  });
  let errors = 0;
  tiles.on('tileerror', () => {
    if (++errors === 4 && key !== 'osm') {
      console.warn('Basemap Esri gagal, beralih ke OpenStreetMap.');
      S.useOsm = true; if (S.base === 'sat') S.base = 'map'; syncBaseButtons(); setTiles();
    }
  });
  tiles.addTo(map).bringToBack();
  document.getElementById('map').classList.toggle('sat', S.base === 'sat');
}
function syncBaseButtons() {
  document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x.dataset.base === S.base));
}

// garis lengkung (kurva Bezier kuadratik) antar bandara
function arc(a, b, n = 48) {
  const [y1, x1] = a, [y2, x2] = b;
  const dx = x2 - x1, dy = y2 - y1, k = 0.2;
  const cx = (x1 + x2) / 2 - dy * k, cy = (y1 + y2) / 2 + dx * k;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([u * u * y1 + 2 * u * t * cy + t * t * y2, u * u * x1 + 2 * u * t * cx + t * t * x2]);
  }
  return pts;
}

function renderMap(rows) {
  const r = S.mapAirline === 'all' ? rows : rows.filter((f) => f.al === S.mapAirline);
  routeLayer.clearLayers(); apLayer.clearLayers();
  const all = groupRoutes(r);
  const agg = all.slice(0, CFG.mapTopN);
  $('mapNote').textContent = `${agg.length} rute teratas dari ${all.length}`;
  renderTopRoutes(all);
  renderMapInterp(r, all);
  if (!agg.length) { spawnPlanes([]); return; }

  const max = agg[0].n;
  const sat = S.base === 'sat';
  const base = sat ? '#8fbaff' : css('--route'), hot = sat ? '#67e8f9' : css('--route-hot');
  const planeRoutes = [];
  // gambar dari yang paling tipis agar rute tebal di atas
  agg.map((rt, i) => ({ rt, i })).reverse().forEach(({ rt, i }) => {
    const A = S.apIndex[rt.a], B = S.apIndex[rt.b];
    if (!A || !B) return;
    const pts = arc([A.lat, A.lon], [B.lat, B.lon]);
    if (i < 14) planeRoutes[i] = { pts, i, len: Math.hypot(A.lat - B.lat, A.lon - B.lon) };
    const isHot = i < CFG.hotN, ratio = rt.n / max;
    const op = isHot ? 0.95 : 0.25 + 0.5 * ratio;
    const line = L.polyline(pts, {
      color: isHot ? hot : base, weight: 1.2 + 6 * Math.sqrt(ratio), opacity: op,
      className: isHot ? 'route-hot' : 'route', lineCap: 'round',
    }).bindTooltip(
      `<b>${rt.a} ⇄ ${rt.b}</b><br>${esc(city(rt.a))} – ${esc(city(rt.b))}<br>` +
      `${nf.format(rt.n)} penerbangan · ${nf.format(rt.pax)} pax<br>OTP ${f1(rt.otp)}% · dominan ${esc(rt.topAl)}`,
      { sticky: true, className: 'map-tip' });
    const w = line.options.weight;
    line.on('mouseover', () => line.setStyle({ weight: w + 3, opacity: 1 }));
    line.on('mouseout', () => line.setStyle({ weight: w, opacity: op }));
    line.addTo(routeLayer);
  });

  // bandara: ukuran lingkaran = jumlah pergerakan
  const mv = {};
  r.forEach((f) => { mv[f.o] = (mv[f.o] || 0) + 1; mv[f.d] = (mv[f.d] || 0) + 1; });
  const sorted = Object.entries(mv).sort((a, b) => b[1] - a[1]);
  const maxM = sorted.length ? sorted[0][1] : 1;
  const labelSet = new Set(sorted.slice(0, 12).map((x) => x[0]));
  sorted.forEach(([code, m]) => {
    const ap = S.apIndex[code]; if (!ap) return;
    L.circleMarker([ap.lat, ap.lon], {
      radius: 3 + 11 * Math.sqrt(m / maxM), weight: 1.5,
      color: sat ? '#ffffff' : css('--ap-stroke'), fillColor: ap.is_hub ? css('--cyan') : css('--ap-fill'), fillOpacity: 0.92,
      className: ap.is_hub ? 'ap-hub' : '',
    }).bindTooltip(`<b>${code}</b> ${esc(ap.airport_name)}<br>${esc(ap.city)}, ${esc(ap.province)}<br>${nf.format(m)} pergerakan`,
      { className: 'map-tip' }).addTo(apLayer);
    if (labelSet.has(code)) {
      L.marker([ap.lat, ap.lon], {
        interactive: false,
        icon: L.divIcon({ className: 'ap-label', html: code, iconSize: null, iconAnchor: [-9, 7] }),
      }).addTo(apLayer);
    }
  });
  spawnPlanes(planeRoutes.filter(Boolean));
}

/* ---------- Pesawat animasi ---------- */
function spawnPlanes(routes) {
  planeLayer.clearLayers(); S.planes = [];
  routes.sort((a, b) => a.i - b.i).forEach((r) => {
    const count = r.i < CFG.hotN ? 2 : 1; // rute tersibuk dapat 2 pesawat (dua arah)
    for (let j = 0; j < count; j++) {
      const icon = L.divIcon({
        className: 'plane-icon' + (r.i < CFG.hotN ? ' hot' : ''),
        html: `<span>${PLANE_SVG}</span>`, iconSize: [22, 22], iconAnchor: [11, 11],
      });
      const m = L.marker(r.pts[0], { icon, interactive: false, keyboard: false, zIndexOffset: 800 }).addTo(planeLayer);
      S.planes.push({
        m, pts: r.pts, dir: (r.i + j) % 2 ? -1 : 1,
        t: (j * 0.5 + ((r.i * 0.37) % 1)) % 1,
        speed: 0.9 / (r.len + 4),   // fraksi lintasan per detik (rute jauh = lebih lama)
      });
    }
  });
  placePlanes(0);
  if (S.planesOn && !planeRAF) planeRAF = requestAnimationFrame(tickPlanes);
}

function posAt(pts, t) {
  const f = t * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f)), u = f - i;
  const a = pts[i], b = pts[i + 1];
  return { ll: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], a, b };
}

function placePlanes(dt) {
  if (!map) return;
  for (const p of S.planes) {
    p.t = (p.t + p.speed * dt) % 1;
    const tt = p.dir > 0 ? p.t : 1 - p.t;
    const { ll, a, b } = posAt(p.pts, tt);
    p.m.setLatLng(ll);
    const pa = map.latLngToLayerPoint(p.dir > 0 ? a : b), pb = map.latLngToLayerPoint(p.dir > 0 ? b : a);
    const ang = Math.atan2(pb.x - pa.x, -(pb.y - pa.y)) * 180 / Math.PI;
    const el = p.m.getElement();
    if (el) {
      if (el.firstChild) el.firstChild.style.transform = `rotate(${ang.toFixed(1)}deg)`;
      el.style.opacity = Math.min(1, Math.min(tt, 1 - tt) * 14).toFixed(2); // muncul/hilang halus dekat bandara
    }
  }
}

function tickPlanes(t) {
  const dt = planeLastT ? Math.min(0.1, (t - planeLastT) / 1000) : 0;
  planeLastT = t;
  if (!document.hidden) placePlanes(dt);
  if (S.planesOn) planeRAF = requestAnimationFrame(tickPlanes);
  else { planeRAF = null; planeLastT = 0; }
}

function renderTopRoutes(all) {
  const top = all.slice(0, 8);
  const max = top.length ? top[0].n : 1;
  $('topRoutes').innerHTML = top.map((rt, i) => `
    <li><span class="rk">${i + 1}</span>
      <div class="rl">
        <div class="rl-top"><b>${rt.a} ⇄ ${rt.b}</b><span>${nf.format(rt.n)}</span></div>
        <div class="rl-sub">${esc(city(rt.a))} – ${esc(city(rt.b))} · OTP ${f1(rt.otp)}% · ${compact(rt.pax)} pax</div>
        <div class="bar"><i style="width:${(rt.n / max) * 100}%"></i></div>
      </div></li>`).join('') || '<li class="rl-sub">Tidak ada data.</li>';
}

function renderMapInterp(r, all) {
  if (!r.length) { $('iMap').innerHTML = ''; return; }
  const viaCGK = r.filter((f) => f.o === 'CGK' || f.d === 'CGK').length;
  const top3 = all.slice(0, 3).reduce((s, x) => s + x.n, 0);
  const east = r.filter((f) => [f.o, f.d].some((c) => S.apIndex[c] && S.apIndex[c].lon >= 125)).length;
  const t = all[0];
  setInterp('iMap', [
    `Jaringan berpola <b>hub-and-spoke</b>: <b>${f1(pct(viaCGK, r.length))}%</b> penerbangan berangkat atau mendarat di CGK, sehingga gangguan di Soekarno-Hatta berisiko merambat ke seluruh jaringan.`,
    t ? `Tiga rute tersibuk (dipimpin <b>${t.a} ⇄ ${t.b}</b>) menyumbang <b>${f1(pct(top3, r.length))}%</b> dari total penerbangan.` : '',
    `Penerbangan yang menyentuh Indonesia Timur (Maluku–Papua, bujur ≥ 125°) sebesar <b>${f1(pct(east, r.length))}%</b> trafik${pct(east, r.length) < 20 ? ' — masih kecil, sehingga menjadi peluang pengembangan rute' : ''}.`,
  ]);
}

/* =========================================================
   6. PROFIL MASKAPAI
   ========================================================= */
function renderAirline(rows, A) {
  const counts = {};
  rows.forEach((f) => { counts[f.al] = (counts[f.al] || 0) + 1; });
  const list = S.airlines.slice().sort((a, b) => (counts[b.airline_code] || 0) - (counts[a.airline_code] || 0));
  if (!S.selAirline || !S.alIndex[S.selAirline]) S.selAirline = list[0] && list[0].airline_code;

  $('airlineChips').innerHTML = list.map((a, i) => `
    <button class="chip ${a.airline_code === S.selAirline ? 'on' : ''}" data-code="${esc(a.airline_code)}" role="tab">
      ${logoHTML(a.airline_code, i)}<span class="chip-txt"><b>${esc(a.airline_name)}</b><small>${nf.format(counts[a.airline_code] || 0)} penerbangan</small></span>
    </button>`).join('');

  const al = S.alIndex[S.selAirline]; if (!al) return;
  const ar = rows.filter((f) => f.al === al.airline_code);
  const st = stats(ar);
  const rank = A.rank;
  const pos = rank.findIndex((x) => x.code === al.airline_code) + 1;
  const routes = groupRoutes(ar);

  $('gauge').style.setProperty('--p', st.otp.toFixed(1));
  countUp($('gVal'), st.otp, (v) => f1(v) + '%');
  $('alName').textContent = al.airline_name;
  const lg = $('alLogo');
  lg.style.setProperty('--c', alColor(al.airline_code));
  lg.innerHTML = `${esc(al.airline_code)}${logoImg(al.airline_code, 'Logo ' + al.airline_name)}`;
  $('alTags').innerHTML = [al.type, al.group].filter(Boolean)
    .map((t, i) => `<span class="tag ${i ? 'alt' : ''}">${esc(t)}</span>`).join('');

  $('alStats').innerHTML = `
    <div class="stat"><span>Armada Aktif</span><b>${nf.format(al.fleet_active)}</b><small>pesawat</small></div>
    <div class="stat"><span>Penerbangan</span><b>${nf.format(st.n)}</b><small>${f1(pct(st.n, rows.length))}% pangsa</small></div>
    <div class="stat"><span>Penumpang</span><b>${compact(st.pax)}</b><small>pax diangkut</small></div>
    <div class="stat"><span>Avg Delay</span><b>${f1(st.avgDelay)}</b><small>menit (saat delay)</small></div>
    <div class="stat"><span>Pembatalan</span><b>${f1(st.cancelRate)}%</b><small>${nf.format(st.n - st.ops)} penerbangan</small></div>
    <div class="stat"><span>Peringkat OTP</span><b>#${pos || '–'}</b><small>dari ${rank.length} maskapai</small></div>
    <div class="stat wide"><span>Rute terbanyak</span><b>${routes[0] ? `${routes[0].a} ⇄ ${routes[0].b} · ${nf.format(routes[0].n)} penerbangan` : '–'}</b></div>`;

  const top = routes.slice(0, 5), mx = top.length ? top[0].n : 1;
  $('alRoutes').innerHTML = top.map((rt) => `
    <li><div class="row"><span><b>${rt.a} ⇄ ${rt.b}</b> ${esc(city(rt.a))}–${esc(city(rt.b))}</span><b>${nf.format(rt.n)}</b></div>
    <div class="bar"><i style="width:${(rt.n / mx) * 100}%"></i></div></li>`).join('') || '<li>Tidak ada penerbangan.</li>';

  // OTP harian (rata-rata bergerak 7 hari) maskapai vs nasional
  const dates = [...new Set(rows.map((f) => f.date))].sort();
  const nat = byKey(rows, (f) => f.date), mine = byKey(ar, (f) => f.date);
  const natS = movAvg(dates.map((d) => stats(nat.get(d)).otp), 7);
  const mineS = movAvg(dates.map((d) => (mine.has(d) ? stats(mine.get(d)).otp : null)), 7);
  mk('cSpark', {
    type: 'line',
    data: {
      labels: dates.map(dayLabel),
      datasets: [
        { label: al.airline_name, data: mineS, borderColor: css('--cyan'), backgroundColor: vGrad(css('--cyan'), 0.35), fill: true, borderWidth: 2.5, pointRadius: 0, tension: 0.4, spanGaps: true },
        { label: 'Nasional', data: natS, borderColor: css('--muted'), borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.4 },
      ],
    },
    options: opts({
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${f1(c.parsed.y)}%` } } },
      scales: { x: { display: false }, y: { ticks: { callback: (v) => v + '%', maxTicksLimit: 4 }, grid: { color: css('--grid') } } },
    }),
  });

  // interpretasi
  const diff = st.otp - A.st.otp;
  const weak = routes.filter((x) => x.ops >= 30).sort((a, b) => a.otp - b.otp)[0];
  const strong = routes.filter((x) => x.ops >= 30).sort((a, b) => b.otp - a.otp)[0];
  setInterp('iAirline', [
    `<b>${esc(al.airline_name)}</b> mencatat OTP <b>${f1(st.otp)}%</b>, ${diff >= 0 ? 'di atas' : 'di bawah'} rata-rata nasional sebesar <b>${f1(Math.abs(diff))} poin persen</b> dan berada di peringkat <b>#${pos}</b> dari ${rank.length} maskapai.`,
    weak && strong && weak !== strong ? `Rute paling rawan delay: <b>${weak.a} ⇄ ${weak.b}</b> (OTP ${f1(weak.otp)}%), sedangkan yang paling disiplin <b>${strong.a} ⇄ ${strong.b}</b> (OTP ${f1(strong.otp)}%).` : '',
    st.ops ? `Saat terlambat, rata-rata tundaannya <b>${f1(st.avgDelay)} menit</b>; tingkat pembatalan ${f1(st.cancelRate)}%.` : '',
  ]);
}

/* =========================================================
   7. GRAFIK ANALITIK + INTERPRETASI
   ========================================================= */
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const HR = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const hh = (h) => `${String(h).padStart(2, '0')}.00`;

function setInterp(id, lines) {
  const el = $(id); if (!el) return;
  const body = lines.filter(Boolean).map((l) => `<li>${l}</li>`).join('');
  el.innerHTML = body ? `<div class="interp-head"><svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M9 21h6v-1H9zm3-19a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z"/></svg>Interpretasi</div><ul>${body}</ul>` : '';
}

function movAvg(arr, k) {
  return arr.map((_, i) => {
    const w = arr.slice(Math.max(0, i - k + 1), i + 1).filter((v) => v != null && Number.isFinite(v));
    return w.length ? +(w.reduce((s, v) => s + v, 0) / w.length).toFixed(2) : null;
  });
}
function median(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
const strength = (r) => { const a = Math.abs(r); return a < 0.1 ? 'hampir tidak ada' : a < 0.3 ? 'lemah' : a < 0.6 ? 'sedang' : 'kuat'; };

// gradien warna untuk batang/area (scriptable Chart.js)
function hexA(c, a) {
  if (c.startsWith('#')) { const n = parseInt(c.slice(1).length === 3 ? c.slice(1).replace(/./g, '$&$&') : c.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
  return c;
}
function vGrad(c, top = 0.9, bottom = 0.05) {
  return (ctx) => {
    const { chart } = ctx, a = chart.chartArea; if (!a) return hexA(c, top);
    const g = chart.ctx.createLinearGradient(0, a.bottom, 0, a.top);
    g.addColorStop(0, hexA(c, bottom)); g.addColorStop(1, hexA(c, top)); return g;
  };
}
// warna per-batang yang boleh berupa fungsi gradien (Chart.js tidak me-resolve fungsi di dalam array)
const perIndex = (arr) => (ctx) => { const v = arr[ctx.dataIndex]; return typeof v === 'function' ? v(ctx) : v; };
function hGrad(c1, c2) {
  return (ctx) => {
    const { chart } = ctx, a = chart.chartArea; if (!a) return c2;
    const g = chart.ctx.createLinearGradient(a.left, 0, a.right, 0);
    g.addColorStop(0, c1); g.addColorStop(1, c2); return g;
  };
}

/* Plugin kecil: label nilai di ujung batang & teks tengah donut */
const ValueLabels = {
  id: 'valueLabels',
  afterDatasetsDraw(chart, _a, o) {
    if (!o || !o.enabled) return;
    const { ctx } = chart; ctx.save();
    ctx.font = "700 11px 'Manrope', sans-serif"; ctx.fillStyle = o.color || Chart.defaults.color;
    const horiz = chart.options.indexAxis === 'y';
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden || (o.datasets && !o.datasets.includes(di)) || meta.type === 'line') return;
      meta.data.forEach((el, i) => {
        const v = ds.data[i]; if (v == null) return;
        const txt = o.fmt ? o.fmt(v, i, ds) : v;
        if (chart.config.type === 'bubble') { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = o.color; ctx.fillText(txt, el.x, el.y); }
        else if (horiz) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, el.x + 6, el.y); }
        else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(txt, el.x, el.y - 4); }
      });
    });
    ctx.restore();
  },
};
const CenterText = {
  id: 'centerText',
  afterDraw(chart, _a, o) {
    if (!o || !o.text) return;
    const meta = chart.getDatasetMeta(0); const el = meta && meta.data && meta.data[0]; if (!el) return;
    const { ctx } = chart; ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = o.color; ctx.font = "800 24px 'Manrope', sans-serif"; ctx.fillText(o.text, el.x, el.y - 6);
    ctx.fillStyle = o.sub; ctx.font = "700 11px 'Manrope', sans-serif"; ctx.fillText(o.label, el.x, el.y + 16);
    ctx.restore();
  },
};
if (window.Chart && Chart.register) Chart.register(ValueLabels, CenterText);

function opts(extra = {}) {
  const base = {
    responsive: true, maintainAspectRatio: false, animation: S.noAnim ? false : { duration: 700, easing: 'easeOutQuart' },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 16, font: { weight: 600 } } },
      tooltip: {
        backgroundColor: css('--tip-bg'), titleColor: css('--tip-text'), bodyColor: css('--tip-text'),
        borderColor: css('--border'), borderWidth: 1, padding: 12, cornerRadius: 10, boxPadding: 4,
        titleFont: { weight: 700 }, bodyFont: { family: "'Manrope', sans-serif" },
      },
    },
  };
  return deepMerge(base, extra);
}
function deepMerge(a, b) {
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && typeof b[k] !== 'function') a[k] = deepMerge(a[k] || {}, b[k]);
    else a[k] = b[k];
  }
  return a;
}
function mk(id, cfg) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), cfg);
}
function chartDefaults() {
  Chart.defaults.font.family = "'Manrope', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--grid');
}

/* ---------- Analisis gabungan (dipakai grafik, insight, rekomendasi) ---------- */
function analyze(rows) {
  const st = stats(rows);
  const rank = airlineRanking(rows);
  const routes = groupRoutes(rows);
  const hour = Array.from({ length: 24 }, () => ({ n: 0, ops: 0, late: 0 }));
  const dow = Array.from({ length: 7 }, () => ({ n: 0, ops: 0, late: 0 }));
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ ops: 0, late: 0 })));
  const ap = {}, causes = {}, types = {}, lateDelays = [];
  for (const f of rows) {
    const late = !f.cancelled && !f.onTime;
    if (f.hour != null) { hour[f.hour].n++; if (!f.cancelled) { hour[f.hour].ops++; if (late) hour[f.hour].late++; } }
    dow[f.dow].n++; if (!f.cancelled) { dow[f.dow].ops++; if (late) dow[f.dow].late++; }
    if (f.hour != null && !f.cancelled) { const c = heat[f.dow][f.hour]; c.ops++; if (late) c.late++; }
    for (const c of [f.o, f.d]) {
      const x = ap[c] || (ap[c] = { code: c, mv: 0, ops: 0, ontime: 0, pax: 0 });
      x.mv++; if (!f.cancelled) { x.ops++; x.pax += f.pax; if (f.onTime) x.ontime++; }
    }
    if (late) { causes[f.cause || 'Tidak tercatat'] = (causes[f.cause || 'Tidak tercatat'] || 0) + 1; lateDelays.push(f.delay); }
    const t = (S.alIndex[f.al] && S.alIndex[f.al].type) || 'Lainnya';
    const tt = types[t] || (types[t] = { ops: 0, ontime: 0 });
    if (!f.cancelled) { tt.ops++; if (f.onTime) tt.ontime++; }
  }
  const airports = Object.values(ap).map((x) => ({ ...x, otp: pct(x.ontime, x.ops) })).sort((a, b) => b.mv - a.mv);
  const causeList = Object.entries(causes).sort((a, b) => b[1] - a[1]);
  return { st, rank, routes, hour, dow, heat, airports, causeList, types, lateDelays, hasHour: hour.some((h) => h.n) };
}

const BUCKETS = ['≤ 15 mnt', '15–30 mnt', '30–60 mnt', '> 60 mnt'];
function buckets(rows) {
  const c = [0, 0, 0, 0]; let ops = 0;
  for (const f of rows) {
    if (f.cancelled) continue; ops++;
    c[f.delay <= 15 ? 0 : f.delay <= 30 ? 1 : f.delay <= 60 ? 2 : 3]++;
  }
  return { c, pct: c.map((v) => pct(v, ops)) };
}

function renderHistogram(rows, A) {
  const nat = buckets(rows);
  const al = S.alIndex[S.selAirline];
  const mine = al ? buckets(rows.filter((f) => f.al === al.airline_code)) : null;
  $('histNote').textContent = `${f1(nat.pct[0])}% berangkat tepat waktu · ${f1(nat.pct[3])}% terlambat > 1 jam`;
  const datasets = [{ label: 'Nasional', data: nat.pct.map((v) => +v.toFixed(1)), counts: nat.c, backgroundColor: vGrad(css('--blue'), 1, 0.55), borderRadius: 8, maxBarThickness: 52 }];
  if (mine) datasets.push({ label: al.airline_name, data: mine.pct.map((v) => +v.toFixed(1)), counts: mine.c, backgroundColor: vGrad(css('--cyan'), 1, 0.55), borderRadius: 8, maxBarThickness: 52 });
  mk('cHist', {
    type: 'bar',
    data: { labels: BUCKETS, datasets },
    options: opts({
      layout: { padding: { top: 18 } },
      plugins: {
        valueLabels: { enabled: true, color: css('--text'), fmt: (v) => f1(v) + '%' },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${f1(c.parsed.y)}% (${nf.format(c.dataset.counts[c.dataIndex])} penerbangan)` } },
      },
      scales: { y: { beginAtZero: true, grace: '8%', ticks: { callback: (v) => v + '%' } }, x: { grid: { display: false } } },
    }),
  });

  const med = median(A.lateDelays), avg = A.st.avgDelay;
  setInterp('iHist', [
    `<b>${f1(nat.pct[0])}%</b> penerbangan berangkat tepat waktu (≤ 15 menit). Kelompok paling kritis adalah delay <b>> 60 menit (${f1(nat.pct[3])}%)</b> karena memicu missed connection dan kewajiban kompensasi penumpang.`,
    A.lateDelays.length ? `Median durasi keterlambatan <b>${f1(med)} menit</b>, lebih kecil dari rata-ratanya (<b>${f1(avg)} menit</b>) → distribusi <b>menceng ke kanan</b>: sebagian kecil delay yang sangat panjang menarik rata-rata ke atas, jadi median lebih mewakili kondisi umum.` : '',
    mine ? `${esc(al.airline_name)}: porsi delay > 60 menit <b>${f1(mine.pct[3])}%</b>, ${mine.pct[3] > nat.pct[3] ? 'lebih buruk' : 'lebih baik'} dari nasional (${f1(nat.pct[3])}%).` : '',
  ]);
}

function renderOtpRanking(rows, A) {
  const rank = A.rank;
  if (!rank.length) return;
  const best = rank[0], worst = rank[rank.length - 1];
  const nm = (c) => (S.alIndex[c] ? S.alIndex[c].airline_name : c);
  $('otpNote').innerHTML = `Garis putus-putus = OTP nasional (${f1(A.st.otp)}%) · klik batang untuk melihat profilnya`;
  const minV = Math.max(0, Math.floor((worst.otp - 8) / 5) * 5);
  const natLine = {
    id: 'natLine',
    afterDatasetsDraw(chart) {
      const x = chart.scales.x.getPixelForValue(A.st.otp), { top, bottom } = chart.chartArea, c = chart.ctx;
      c.save(); c.strokeStyle = css('--warn'); c.setLineDash([5, 4]); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke(); c.restore();
    },
  };
  mk('cOtp', {
    type: 'bar',
    plugins: [natLine],
    data: {
      labels: rank.map((r) => nm(r.code)),
      datasets: [{
        label: 'OTP', data: rank.map((r) => +r.otp.toFixed(1)), borderRadius: 8, maxBarThickness: 24,
        backgroundColor: perIndex(rank.map((r, i) => (i === 0 ? hGrad(hexA(css('--good'), 0.45), css('--good'))
          : i === rank.length - 1 ? hGrad(hexA(css('--bad'), 0.45), css('--bad'))
            : r.code === S.selAirline ? hGrad(hexA(css('--cyan'), 0.45), css('--cyan'))
              : hGrad(hexA(css('--blue'), 0.4), css('--blue'))))),
      }],
    },
    options: opts({
      indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false },
      layout: { padding: { right: 46 } },
      plugins: {
        legend: { display: false },
        valueLabels: { enabled: true, color: css('--text'), fmt: (v) => f1(v) + '%' },
        tooltip: { callbacks: { label: (c) => ` OTP ${f1(c.parsed.x)}% · ${nf.format(rank[c.dataIndex].ops)} penerbangan` } },
      },
      scales: { x: { min: minV, max: 100, ticks: { callback: (v) => v + '%' } }, y: { grid: { display: false }, ticks: { font: { weight: 600 } } } },
      onClick: (_e, els) => { if (els.length) { S.selAirline = rank[els[0].index].code; renderAll({ skipMap: true }); } },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
    }),
  });

  const above = rank.filter((r) => r.otp >= A.st.otp).length;
  const typeAvg = Object.entries(A.types).filter(([, v]) => v.ops > 0).map(([k, v]) => [k, pct(v.ontime, v.ops)]).sort((a, b) => b[1] - a[1]);
  const fsc = typeAvg.find(([k]) => /full/i.test(k)), lcc = typeAvg.find(([k]) => /lcc|low/i.test(k));
  setInterp('iOtp', [
    `Maskapai paling tepat waktu: <b>${esc(nm(best.code))} (${f1(best.otp)}%)</b>; paling sering delay: <b>${esc(nm(worst.code))} (${f1(worst.otp)}%)</b> — selisih <b>${f1(best.otp - worst.otp)} poin persen</b>.`,
    `${above} dari ${rank.length} maskapai berada di atas OTP nasional (${f1(A.st.otp)}%). Target industri ${CFG.otpTarget}% ${A.st.otp >= CFG.otpTarget ? '<b>sudah tercapai</b>' : '<b>belum tercapai</b>'} secara nasional.`,
    fsc && lcc ? `Rata-rata OTP <b>Full Service ${f1(fsc[1])}%</b> vs <b>LCC ${f1(lcc[1])}%</b> (selisih ${f1(fsc[1] - lcc[1])} pp). Model bisnis LCC memaksimalkan utilisasi pesawat dengan turnaround singkat, sehingga satu keterlambatan mudah merambat ke penerbangan berikutnya.` : '',
  ]);
}

function renderCauses(rows, A) {
  const ent = A.causeList;
  const total = ent.reduce((s, e) => s + e[1], 0);
  const cols = [css('--navy'), css('--blue'), css('--cyan'), css('--warn'), css('--bad'), css('--good'), css('--muted')];
  mk('cCause', {
    type: 'doughnut',
    data: { labels: ent.map((e) => e[0]), datasets: [{ data: ent.map((e) => e[1]), backgroundColor: cols, borderColor: css('--surface'), borderWidth: 4, hoverOffset: 10, borderRadius: 6 }] },
    options: opts({
      cutout: '66%', interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { position: isMobile() ? 'bottom' : 'right', labels: { generateLabels: (ch) => ch.data.labels.map((l, i) => ({ text: `${l}  ${f1(pct(ch.data.datasets[0].data[i], total))}%`, fillStyle: cols[i], strokeStyle: cols[i], pointStyle: 'circle', index: i, fontColor: css('--text') })) } },
        centerText: { text: compact(total), label: 'PENERBANGAN DELAY', color: css('--navy'), sub: css('--muted') },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${nf.format(c.parsed)} (${f1(pct(c.parsed, total))}%)` } },
      },
    }),
  });
  if (!total) { setInterp('iCause', []); return; }
  const share = (re) => pct(ent.filter(([k]) => re.test(k)).reduce((s, e) => s + e[1], 0), total);
  const internal = share(/operasional|teknis|rotasi|maskapai/i), weather = share(/cuaca|weather/i), airport = share(/bandara|atc|lalu lintas|trafik/i);
  setInterp('iCause', [
    `Penyebab terbesar: <b>${esc(ent[0][0])} (${f1(pct(ent[0][1], total))}%)</b>${ent[1] ? `, disusul ${esc(ent[1][0])} (${f1(pct(ent[1][1], total))}%)` : ''}.`,
    internal ? `<b>${f1(internal)}%</b> keterlambatan bersumber dari faktor internal maskapai (operasional, rotasi & teknis) — ini <b>faktor yang dapat dikendalikan</b> dan menjadi ruang perbaikan terbesar.` : '',
    weather || airport ? `Faktor eksternal: cuaca ${f1(weather)}%, bandara & ATC ${f1(airport)}%. Porsi bandara & ATC menjadi fokus langsung pengelola bandara (slot, gate, ground handling).` : '',
  ]);
}

const SEASON_COLOR = { Lebaran: '--bad', Nataru: '--warn', 'Libur Sekolah': '--cyan' };
const longLabel = (d) => `${+d.slice(8, 10)} ${BLN[+d.slice(5, 7) - 1]} ${d.slice(2, 4)}`;
function mondayOf(d) { const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return t.toISOString().slice(0, 10); }

/* Pita warna musim di belakang grafik tren */
function seasonBands(seasonsPerPoint) {
  return {
    id: 'seasonBands',
    beforeDatasetsDraw(chart) {
      const x = chart.scales.x, { top, bottom } = chart.chartArea, c = chart.ctx;
      const step = x.getPixelForValue(1) - x.getPixelForValue(0);
      c.save();
      seasonsPerPoint.forEach((sn, i) => {
        if (!SEASON_COLOR[sn]) return;
        c.fillStyle = hexA(css(SEASON_COLOR[sn]), 0.13);
        c.fillRect(x.getPixelForValue(i) - step / 2, top, step, bottom - top);
      });
      c.restore();
    },
  };
}

function renderTrend(rows, A) {
  const days = [...new Set(rows.map((f) => f.date))].sort();
  const weekly = days.length > 120;
  const g = byKey(rows, weekly ? (f) => mondayOf(f.date) : (f) => f.date);
  const keys = [...g.keys()].sort();
  const nDays = (k) => (weekly ? new Set(g.get(k).map((f) => f.date)).size : 1);
  const counts = keys.map((k) => Math.round(g.get(k).length / nDays(k)));
  const otp = keys.map((k) => +stats(g.get(k)).otp.toFixed(1));
  const ma = movAvg(otp, weekly ? 4 : 7);
  const sznOf = (k) => { const c = {}; g.get(k).forEach((f) => { c[f.season] = (c[f.season] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; };
  const szn = keys.map(sznOf);
  const lab = weekly || days.length && days[0].slice(0, 4) !== days[days.length - 1].slice(0, 4) ? longLabel : dayLabel;
  $('trendNote').textContent = weekly
    ? 'Rata-rata penerbangan/hari per minggu, OTP mingguan & rata-rata bergerak 4 minggu · pita merah = Lebaran, kuning = Nataru, biru = libur sekolah'
    : 'Jumlah penerbangan, OTP harian, dan rata-rata bergerak 7 hari · pita warna = musim puncak';
  mk('cTrend', {
    plugins: [seasonBands(szn)],
    data: {
      labels: keys.map((k) => (weekly ? 'Mgg ' : '') + lab(k)),
      datasets: [
        { type: 'bar', label: weekly ? 'Penerbangan/hari' : 'Penerbangan', data: counts, backgroundColor: vGrad(css('--cyan'), 0.6, 0.1), borderRadius: 4, yAxisID: 'y', order: 3 },
        { type: 'line', label: weekly ? 'OTP mingguan' : 'OTP harian', data: otp, borderColor: hexA(css('--blue'), 0.3), borderWidth: 1, pointRadius: 0, tension: 0.3, yAxisID: 'y1', order: 2 },
        { type: 'line', label: weekly ? 'OTP rata-rata 4 minggu' : 'OTP rata-rata 7 hari', data: ma, borderColor: css('--blue'), borderWidth: 3, pointRadius: 0, pointHoverRadius: 5, tension: 0.4, yAxisID: 'y1', order: 1 },
        { type: 'line', label: `Target ${CFG.otpTarget}%`, data: keys.map(() => CFG.otpTarget), borderColor: css('--warn'), borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, yAxisID: 'y1', order: 0 },
      ],
    },
    options: opts({
      plugins: { tooltip: { callbacks: { afterTitle: (it) => (szn[it[0].dataIndex] && szn[it[0].dataIndex] !== 'Reguler' ? `Musim: ${szn[it[0].dataIndex]}` : '') } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 12, maxRotation: 0 } },
        y: { beginAtZero: true, title: { display: true, text: weekly ? 'Penerbangan/hari' : 'Penerbangan' } },
        y1: { position: 'right', grid: { display: false }, ticks: { callback: (v) => v + '%' }, title: { display: true, text: 'OTP' } },
      },
    }),
  });
  if (!keys.length) return;
  const unit = weekly ? 'minggu' : 'hari';
  const iMax = counts.indexOf(Math.max(...counts));
  const iMin = otp.indexOf(Math.min(...otp));
  const below = otp.filter((v) => v < CFG.otpTarget).length;
  const wk = [4, 5, 6].map((i) => A.dow[i]), wd = [0, 1, 2, 3].map((i) => A.dow[i]);
  const rate = (arr) => pct(arr.reduce((x, y) => x + y.late, 0), arr.reduce((x, y) => x + y.ops, 0));
  const lines = [
    `Puncak volume pada ${unit} <b>${lab(keys[iMax])}</b> (${nf.format(counts[iMax])} penerbangan${weekly ? '/hari' : ''})${szn[iMax] !== 'Reguler' && szn[iMax] ? ` — bertepatan dengan musim <b>${szn[iMax]}</b>` : ''}.`,
    `OTP terendah pada ${unit} <b>${lab(keys[iMin])}</b> (${f1(otp[iMin])}%)${szn[iMin] !== 'Reguler' && szn[iMin] ? `, juga saat <b>${szn[iMin]}</b>: lonjakan volume dan load factor mendekati penuh membuat turnaround dan antrean runway tidak punya ruang cadangan` : '. Penurunan tajam sesaat umumnya dipicu gangguan seperti cuaca buruk regional'}.`,
    `<b>${below} dari ${keys.length} ${unit}</b> di bawah target ${CFG.otpTarget}%. Tingkat delay Jumat–Minggu <b>${f1(rate(wk))}%</b> vs Senin–Kamis <b>${f1(rate(wd))}%</b>${rate(wk) - rate(wd) > 0.5 ? ' — akhir pekan lebih rawan' : Math.abs(rate(wk) - rate(wd)) <= 0.5 ? ' — praktis setara' : ' — justru hari kerja lebih rawan'}.`,
  ];
  if (weekly && keys.length >= 52) {
    const half = Math.floor(keys.length / 2);
    const avg = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
    const g1 = avg(counts.slice(0, half)), g2 = avg(counts.slice(half));
    lines.push(`Tren jangka panjang: rata-rata volume paruh kedua periode <b>${g2 >= g1 ? '+' : ''}${f1(pct(g2 - g1, g1))}%</b> dibanding paruh pertama.`);
  }
  setInterp('iTrend', lines);
}

/* ---------- Dampak musim ---------- */
function renderSeason(rows, A) {
  const card = $('seasonCard');
  const ORDER = ['Reguler', 'Libur Sekolah', 'Nataru', 'Lebaran'];
  const g = byKey(rows.filter((f) => f.season), (f) => f.season);
  const list = [...g.keys()].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  card.hidden = list.length < 2;
  if (card.hidden) return;
  const m = list.map((k) => {
    const r = g.get(k), st = stats(r), d = new Set(r.map((f) => f.date)).size, seats = r.reduce((x, f) => x + f.seats, 0);
    return { k, perDay: r.length / d, delay: 100 - st.otp, lf: seats ? pct(st.pax, seats) : null, avgDelay: st.avgDelay };
  });
  const colOf = (k) => css(SEASON_COLOR[k] || '--blue');
  mk('cSeason', {
    data: {
      labels: m.map((x) => x.k),
      datasets: [
        { type: 'bar', label: 'Penerbangan/hari', data: m.map((x) => Math.round(x.perDay)), backgroundColor: (ctx) => vGrad(colOf((m[ctx.dataIndex] || m[0]).k), 0.95, 0.35)(ctx), borderRadius: 10, maxBarThickness: 64, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Tingkat delay (%)', data: m.map((x) => +x.delay.toFixed(1)), borderColor: css('--navy'), backgroundColor: css('--navy'), borderWidth: 2.5, pointRadius: 5, yAxisID: 'y1', order: 1 },
        ...(m[0].lf != null ? [{ type: 'line', label: 'Load factor (%)', data: m.map((x) => +x.lf.toFixed(1)), borderColor: css('--good'), backgroundColor: css('--good'), borderDash: [5, 4], borderWidth: 2, pointRadius: 5, pointStyle: 'rectRot', yAxisID: 'y1', order: 0 }] : []),
      ],
    },
    options: opts({
      layout: { padding: { top: 18 } },
      plugins: { valueLabels: { enabled: true, color: css('--text'), datasets: [0], fmt: (v) => nf.format(v) } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { weight: 700 } } },
        y: { beginAtZero: true, grace: '10%', title: { display: true, text: 'Penerbangan/hari' } },
        y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: (v) => v + '%' } },
      },
    }),
  });
  const base = m.find((x) => x.k === 'Reguler') || m[0];
  const peak = m.reduce((a, b) => (b.perDay > a.perDay ? b : a));
  const lines = m.filter((x) => x !== base).map((x) =>
    `<b>${x.k}</b>: volume <b>${x.perDay >= base.perDay ? '+' : ''}${f1(pct(x.perDay - base.perDay, base.perDay))}%</b>, tingkat delay <b>${f1(x.delay)}%</b> (${x.delay >= base.delay ? '+' : ''}${f1(x.delay - base.delay)} pp)${x.lf != null ? `, load factor ${f1(x.lf)}%` : ''} dibanding hari reguler.`);
  lines.push(`Musim <b>${peak.k}</b> adalah uji resiliensi terberat: volume tertinggi bertemu load factor mendekati penuh, sehingga tidak ada ruang cadangan saat terjadi gangguan. Persiapan kapasitas (ground handling, gate, koordinasi ATC) idealnya dimulai sebelum H-7.`);
  setInterp('iSeason', lines);
}

/* ---------- Panel model ML (hasil notebook) ---------- */
function renderModel() {
  const M = S.raw.model_metrics, R = S.raw.delay_risk, F = S.raw.feature_importance;
  const has = !!(M && R && R.length);
  $('modelEmpty').hidden = has; $('modelBody').hidden = !has;
  if (!has) return;
  const auc = M.model_terbaik && /random/i.test(M.model_terbaik) ? M.roc_auc_rf : M.roc_auc_lr;
  const pr = M.model_terbaik && /random/i.test(M.model_terbaik) ? M.pr_auc_rf : M.pr_auc_lr;
  const n2 = (v) => (v == null ? '–' : (+v).toFixed(3).replace('.', ','));
  $('modelChips').innerHTML = [
    ['Model terbaik', esc(M.model_terbaik || '–')],
    ['ROC-AUC (uji)', n2(auc)],
    ['PR-AUC', `${n2(pr)} <small>acak ${n2(M.prevalensi_uji)}</small>`],
    ['Lift 10% teratas', `${String(M.lift_desil_1 ?? '–').replace('.', ',')}×`],
    ['Latih → Uji', `${esc(M.periode_latih || '')} → ${esc(M.periode_uji || '')}`],
  ].map(([k, v]) => `<div class="mchip"><span>${k}</span><b>${v}</b></div>`).join('');

  // heatmap risiko maskapai × jam
  const rows = R.map((r) => ({ al: String(r.airline_code), h: +r.hour, risk: +r.risk, actual: +r.actual, n: +r.flights }));
  const hrs = [...new Set(rows.map((r) => r.h))].sort((a, b) => a - b);
  const als = [...new Set(rows.map((r) => r.al))]
    .map((c) => ({ c, avg: rows.filter((r) => r.al === c).reduce((x, r) => x + r.risk * r.n, 0) / rows.filter((r) => r.al === c).reduce((x, r) => x + r.n, 0) }))
    .sort((a, b) => b.avg - a.avg);
  const lo = Math.min(...rows.map((r) => r.risk)), hi = Math.max(...rows.map((r) => r.risk));
  const idx = {}; rows.forEach((r) => { idx[r.al + '|' + r.h] = r; });
  const el = $('riskHeat');
  el.style.setProperty('--cols', hrs.length);
  el.innerHTML = '<span></span>' + hrs.map((h) => `<span class="hm-h">${h % 2 ? '' : String(h).padStart(2, '0')}</span>`).join('') +
    als.map(({ c }) => `<span class="hm-d hm-al">${logoHTML(c, 0, 'xs')}</span>` + hrs.map((h) => {
      const r = idx[c + '|' + h];
      if (!r) return '<i class="hm-c empty"></i>';
      const t = hi > lo ? (r.risk - lo) / (hi - lo) : 0;
      return `<i class="hm-c" style="--t:${t.toFixed(3)}" title="${esc(S.alIndex[c] ? S.alIndex[c].airline_name : c)} ${hh(h)} — risiko ${f1(r.risk * 100)}% (aktual ${f1(r.actual * 100)}%, ${nf.format(r.n)} penerbangan)"></i>`;
    }).join('')).join('');

  // feature importance
  if (F && F.length) {
    const fi = F.slice().sort((a, b) => b.importance - a.importance);
    mk('cImportance', {
      type: 'bar',
      data: { labels: fi.map((x) => x.label || x.feature), datasets: [{ label: 'Penurunan AUC', data: fi.map((x) => Math.max(0, +x.importance)), borderRadius: 8, maxBarThickness: 20, backgroundColor: perIndex(fi.map((_, i) => (i < 3 ? hGrad(hexA(css('--cyan'), 0.45), css('--cyan')) : hGrad(hexA(css('--blue'), 0.35), css('--blue'))))) }] },
      options: opts({
        indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false }, layout: { padding: { right: 50 } },
        plugins: { legend: { display: false }, valueLabels: { enabled: true, color: css('--text'), fmt: (v) => v.toFixed(3).replace('.', ',') } },
        scales: { x: { beginAtZero: true, title: { display: true, text: 'Permutation importance (penurunan ROC-AUC)' } }, y: { grid: { display: false }, ticks: { font: { weight: 600 } } } },
      }),
    });
  }
  const top = als[0], bot = als[als.length - 1];
  const hotCell = rows.reduce((a, b) => (b.risk > a.risk ? b : a));
  const nm = (c) => (S.alIndex[c] ? S.alIndex[c].airline_name : c);
  const fi3 = F && F.length ? F.slice().sort((a, b) => b.importance - a.importance).slice(0, 3).map((x) => x.label || x.feature) : [];
  setInterp('iModel', [
    `Model <b>${esc(M.model_terbaik)}</b> mencapai ROC-AUC <b>${n2(auc)}</b> pada data uji ${esc(M.periode_uji || '')} yang tidak pernah dilihat saat pelatihan. Nilai ini <b>sedang</b>: model memberi sinyal prioritas yang berguna, bukan kepastian, karena pemicu terbesar delay (cuaca harian, keterlambatan rotasi sebelumnya) belum diketahui jauh hari.`,
    `10% penerbangan dengan skor tertinggi delay <b>${String(M.lift_desil_1).replace('.', ',')}×</b> lebih sering dari rata-rata → skor layak dipakai untuk memprioritaskan kesiapan gate & ground handling.`,
    fi3.length ? `Tiga pendorong terbesar: <b>${fi3.map(esc).join(', ')}</b>.` : '',
    `Kombinasi paling berisiko: <b>${esc(nm(hotCell.al))} pukul ${hh(hotCell.h)}</b> (peluang delay ${f1(hotCell.risk * 100)}%). Rata-rata risiko tertinggi ${esc(nm(top.c))} (${f1(top.avg * 100)}%), terendah ${esc(nm(bot.c))} (${f1(bot.avg * 100)}%).`,
    `<span class="muted">Skor dihitung di <code>analysis/delay_risk_model.ipynb</code> (Python, scikit-learn) dan tidak berubah oleh filter dashboard.</span>`,
  ]);
}

function renderHourly(rows, A) {
  const hrs = [];
  for (let h = 0; h < 24; h++) if (A.hour[h].n) hrs.push(h);
  if (!hrs.length) { setInterp('iHour', ['Kolom jam jadwal (<code>sched_dep</code>) tidak tersedia, jadi pola per jam tidak bisa dihitung.']); return; }
  const rate = hrs.map((h) => +pct(A.hour[h].late, A.hour[h].ops).toFixed(1));
  mk('cHour', {
    data: {
      labels: hrs.map(hh),
      datasets: [
        { type: 'bar', label: 'Penerbangan', data: hrs.map((h) => A.hour[h].n), backgroundColor: vGrad(css('--blue'), 0.9, 0.25), borderRadius: 6, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Tingkat delay (%)', data: rate, borderColor: css('--bad'), backgroundColor: css('--bad'), borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 6, tension: 0.35, yAxisID: 'y1', order: 1 },
      ],
    },
    options: opts({
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: 'Penerbangan' } },
        y1: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { callback: (v) => v + '%' }, title: { display: true, text: 'Delay' } },
      },
    }),
  });
  const busiest = hrs.reduce((b, h) => (A.hour[h].n > A.hour[b].n ? h : b), hrs[0]);
  const worst = hrs.filter((h) => A.hour[h].ops >= 30).reduce((b, h) => (pct(A.hour[h].late, A.hour[h].ops) > pct(A.hour[b].late, A.hour[b].ops) ? h : b), hrs[0]);
  const win = (a, b) => { const s = hrs.filter((h) => h >= a && h <= b); return pct(s.reduce((x, h) => x + A.hour[h].late, 0), s.reduce((x, h) => x + A.hour[h].ops, 0)); };
  const morn = win(5, 9), eve = win(17, 21);
  setInterp('iHour', [
    `Jam tersibuk adalah <b>${hh(busiest)}</b> (${nf.format(A.hour[busiest].n)} penerbangan), sedangkan tingkat delay tertinggi pada slot <b>${hh(worst)}</b> (${f1(pct(A.hour[worst].late, A.hour[worst].ops))}%).`,
    `Tingkat delay pagi (05–09) <b>${f1(morn)}%</b> vs sore-malam (17–21) <b>${f1(eve)}%</b>${eve > morn * 1.2 ? ` — naik <b>${f1(eve / (morn || 1))}×</b>. Ini pola <b>efek domino (knock-on delay)</b>: keterlambatan kecil di pagi hari menumpuk karena pesawat yang sama dipakai berulang kali sepanjang hari.` : ' — relatif stabil sepanjang hari.'}`,
  ]);
}

function renderHeatmap(rows, A) {
  const el = $('heatmap');
  const hrs = []; for (let h = 0; h < 24; h++) if (A.hour[h].n) hrs.push(h);
  if (!hrs.length) { el.innerHTML = ''; setInterp('iHeat', []); return; }
  const rates = [];
  A.heat.forEach((row) => hrs.forEach((h) => { if (row[h].ops >= 5) rates.push(pct(row[h].late, row[h].ops)); }));
  const lo = Math.min(...rates), hi = Math.max(...rates);
  let worst = null;
  el.style.setProperty('--cols', hrs.length);
  el.innerHTML = '<span></span>' + hrs.map((h) => `<span class="hm-h">${h % 2 ? '' : String(h).padStart(2, '0')}</span>`).join('') +
    A.heat.map((row, d) => `<span class="hm-d">${HR[d]}</span>` + hrs.map((h) => {
      const c = row[h];
      if (c.ops < 5) return '<i class="hm-c empty"></i>';
      const r = pct(c.late, c.ops), t = hi > lo ? (r - lo) / (hi - lo) : 0;
      if (c.ops >= 20 && (!worst || r > worst.r)) worst = { d, h, r };
      return `<i class="hm-c" style="--t:${t.toFixed(3)}" title="${HARI[d]} ${hh(h)} — delay ${f1(r)}% dari ${nf.format(c.ops)} penerbangan"></i>`;
    }).join('')).join('');
  const dRate = A.dow.map((x) => pct(x.late, x.ops));
  const dBest = dRate.indexOf(Math.min(...dRate)), dWorst = dRate.indexOf(Math.max(...dRate));
  setInterp('iHeat', [
    worst ? `Titik paling rawan: <b>${HARI[worst.d]} pukul ${hh(worst.h)}</b> dengan tingkat delay <b>${f1(worst.r)}%</b>.` : '',
    `Hari paling lancar <b>${HARI[dBest]}</b> (delay ${f1(dRate[dBest])}%), paling rawan <b>${HARI[dWorst]}</b> (${f1(dRate[dWorst])}%).`,
    (() => { const m = A.hour.slice(5, 10), e = A.hour.slice(17, 22); const r1 = pct(m.reduce((x, h) => x + h.late, 0), m.reduce((x, h) => x + h.ops, 0)), r2 = pct(e.reduce((x, h) => x + h.late, 0), e.reduce((x, h) => x + h.ops, 0)); return r2 > r1 * 1.2 ? 'Warna yang makin pekat ke arah kanan (malam) di hampir semua hari menunjukkan delay <b>terakumulasi sepanjang hari</b>, bukan masalah hari tertentu saja.' : ''; })(),
  ]);
}

function renderAirports(rows, A) {
  const list = A.airports.filter((x) => x.ops >= 30 && S.apIndex[x.code]);
  const maxPax = Math.max(1, ...list.map((x) => x.pax));
  mk('cAirport', {
    type: 'bubble',
    data: {
      datasets: [{
        label: 'Bandara',
        data: list.map((x) => ({ x: x.mv, y: +x.otp.toFixed(1), r: 6 + 22 * Math.sqrt(x.pax / maxPax), code: x.code })),
        backgroundColor: list.map((x) => hexA(S.apIndex[x.code].is_hub ? css('--cyan') : css('--blue'), 0.55)),
        borderColor: list.map((x) => (S.apIndex[x.code].is_hub ? css('--cyan') : css('--blue'))), borderWidth: 1.5,
      }],
    },
    options: opts({
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { display: false },
        valueLabels: { enabled: true, color: '#ffffff', fmt: (_v, i, ds) => (ds.data[i].r >= 13 ? ds.data[i].code : '') },
        tooltip: { callbacks: { label: (c) => { const d = c.raw, a = S.apIndex[d.code]; return ` ${d.code} ${a ? a.city : ''} · ${nf.format(d.x)} pergerakan · OTP ${f1(d.y)}%`; } } },
      },
      scales: {
        x: { type: 'logarithmic', title: { display: true, text: 'Pergerakan pesawat (skala log)' }, ticks: { callback: (v) => ([100, 300, 1000, 3000, 10000, 30000].includes(v) ? nf.format(v) : '') } },
        y: { title: { display: true, text: 'OTP (%)' }, ticks: { callback: (v) => v + '%' } },
      },
    }),
  });
  if (list.length < 3) { setInterp('iAirport', []); return; }
  const r = pearson(list.map((x) => Math.log(x.mv)), list.map((x) => x.otp));
  const big = list.slice(0, 8).sort((a, b) => a.otp - b.otp);
  const best = list.slice().sort((a, b) => b.otp - a.otp)[0];
  setInterp('iAirport', [
    `Korelasi Pearson antara log(trafik) dan OTP: <b>r = ${r.toFixed(2).replace('.', ',')}</b> → hubungan <b>${strength(r)}</b>${Math.abs(r) < 0.1 ? '' : r < 0 ? ' negatif' : ' positif'}. ${Math.abs(r) < 0.3 ? 'Artinya besar-kecilnya trafik bandara bukan penentu utama ketepatan waktu; faktor maskapai dan jam operasi lebih berperan.' : r < 0 ? 'Bandara yang makin sibuk cenderung makin sering delay, sejalan dengan isu kepadatan slot.' : 'Bandara yang lebih sibuk justru cenderung lebih tepat waktu, kemungkinan karena fasilitas dan SDM yang lebih lengkap.'} Ingat, korelasi bukan sebab-akibat.`,
    `Di antara 8 bandara tersibuk, OTP terendah ada di <b>${big[0].code} – ${esc(city(big[0].code))} (${f1(big[0].otp)}%)</b>, sementara OTP tertinggi seluruh bandara di <b>${best.code} – ${esc(city(best.code))} (${f1(best.otp)}%)</b>.`,
  ]);
}

function renderTable(rows) {
  const top = groupRoutes(rows).slice(0, 15);
  const cls = (v) => (v >= 85 ? 'good' : v >= 75 ? 'warn' : 'bad');
  $('routeTable').innerHTML = top.map((r, i) => {
    const al = S.alIndex[r.topAl];
    return `<tr>
      <td><span class="rk">${i + 1}</span></td>
      <td class="route">${r.a} <span class="arrow">⇄</span> ${r.b}</td>
      <td>${esc(city(r.a))} – ${esc(city(r.b))}</td>
      <td class="num">${nf.format(r.n)}</td>
      <td class="num">${nf.format(r.pax)}</td>
      <td class="num"><span class="pill ${cls(r.otp)}">${f1(r.otp)}%</span></td>
      <td class="num">${f1(r.avgDelay)} mnt</td>
      <td>${logoHTML(r.topAl, 0, 'sm')}${esc(al ? al.airline_name : r.topAl)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8">Tidak ada data.</td></tr>';
}

/* ---------- Insight utama & rekomendasi ---------- */
function renderInsights(rows, A) {
  const nm = (c) => (S.alIndex[c] ? S.alIndex[c].airline_name : c);
  $('targetChip').innerHTML = `Target OTP ${CFG.otpTarget}% · <b class="${A.st.otp >= CFG.otpTarget ? 'ok' : 'no'}">${A.st.otp >= CFG.otpTarget ? 'Tercapai' : 'Belum tercapai'}</b>`;
  if (!rows.length) { $('insightGrid').innerHTML = ''; $('recoList').innerHTML = ''; return; }
  const best = A.rank[0], worst = A.rank[A.rank.length - 1];
  const critical = A.routes.slice(0, 20).filter((r) => r.ops >= 30).sort((a, b) => a.otp - b.otp)[0];
  const hrs = A.hour.map((h, i) => ({ ...h, i })).filter((h) => h.ops >= 30);
  const worstHour = hrs.sort((a, b) => pct(b.late, b.ops) - pct(a.late, a.ops))[0];
  const viaCGK = rows.filter((f) => f.o === 'CGK' || f.d === 'CGK').length;
  const cause = A.causeList[0], causeTot = A.causeList.reduce((s, e) => s + e[1], 0);
  const bigAp = A.airports.filter((x) => S.apIndex[x.code]).slice(0, 8).sort((a, b) => a.otp - b.otp)[0];

  // load factor rute & bottleneck bandara × jam
  const seatsByRoute = {};
  rows.forEach((f) => { if (f.seats) { const r = seatsByRoute[f.route] || (seatsByRoute[f.route] = { pax: 0, seats: 0 }); r.pax += f.pax; r.seats += f.seats; } });
  const lfRoute = A.routes.slice(0, 20).filter((r) => seatsByRoute[r.a + '|' + r.b] && seatsByRoute[r.a + '|' + r.b].seats)
    .map((r) => ({ ...r, lf: pct(seatsByRoute[r.a + '|' + r.b].pax, seatsByRoute[r.a + '|' + r.b].seats) })).sort((a, b) => b.lf - a.lf)[0];
  const cell = {};
  rows.forEach((f) => {
    if (f.cancelled || f.hour == null) return;
    const k = f.o + '|' + f.hour, c = cell[k] || (cell[k] = { ap: f.o, h: f.hour, ops: 0, late: 0, causes: {}, lcc: 0 });
    c.ops++;
    if (!f.onTime) { c.late++; c.causes[f.cause || 'Tidak tercatat'] = (c.causes[f.cause || 'Tidak tercatat'] || 0) + 1; if (S.alIndex[f.al] && /lcc/i.test(S.alIndex[f.al].type)) c.lcc++; }
  });
  const minOps = Math.max(40, rows.length * 0.003);
  const bott = Object.values(cell).filter((c) => c.ops >= minOps).sort((a, b) => pct(b.late, b.ops) - pct(a.late, a.ops))[0];
  if (bott) { bott.rate = pct(bott.late, bott.ops); bott.topCause = Object.entries(bott.causes).sort((a, b) => b[1] - a[1])[0]; }
  S.bottleneck = bott;

  const tiles = [
    { ic: 'gauge', tone: A.st.otp >= CFG.otpTarget ? 'good' : 'warn', t: 'Kesehatan Jaringan', v: `${f1(A.st.otp)}%`, d: `OTP nasional, ${A.st.otp >= CFG.otpTarget ? 'di atas' : 'di bawah'} target ${CFG.otpTarget}% sebesar ${f1(Math.abs(A.st.otp - CFG.otpTarget))} pp.` },
    best && { ic: 'trophy', tone: 'good', t: 'Maskapai Terbaik', v: nm(best.code), d: `OTP ${f1(best.otp)}% — ${f1(best.otp - A.st.otp)} pp di atas rata-rata nasional.` },
    worst && { ic: 'alert', tone: 'bad', t: 'Perlu Perhatian', v: nm(worst.code), d: `OTP ${f1(worst.otp)}%, terendah di antara ${A.rank.length} maskapai.` },
    critical && { ic: 'route', tone: 'warn', t: 'Rute Kritis', v: `${critical.a} ⇄ ${critical.b}`, d: `OTP ${f1(critical.otp)}% dengan ${nf.format(critical.n)} penerbangan — terburuk di 20 rute tersibuk.` },
    cause && { ic: 'cause', tone: 'navy', t: 'Akar Masalah', v: cause[0], d: `${f1(pct(cause[1], causeTot))}% dari seluruh penerbangan yang terlambat.` },
    { ic: 'hub', tone: 'navy', t: 'Ketergantungan Hub', v: `${f1(pct(viaCGK, rows.length))}%`, d: 'penerbangan melewati CGK — titik tunggal yang paling menentukan OTP nasional.' },
    bott && { ic: 'clock', tone: 'bad', t: 'Peringatan Bottleneck', v: `${bott.ap} · ${hh(bott.h)}`, d: `Peluang delay ${f1(bott.rate)}% untuk keberangkatan dari ${esc(city(bott.ap))} di jam ini${bott.topCause ? `; pemicu utama: ${esc(bott.topCause[0].toLowerCase())}` : ''}${bott.late ? `, ${f1(pct(bott.lcc, bott.late))}% oleh maskapai LCC` : ''}.` },
    lfRoute && { ic: 'route', tone: 'good', t: 'Utilisasi Tertinggi', v: `${lfRoute.a} ⇄ ${lfRoute.b}`, d: `Load factor ${f1(lfRoute.lf)}% — kursi paling penuh di antara 20 rute tersibuk; kandidat tambahan frekuensi/pesawat lebih besar.` },
  ].filter(Boolean);
  const ICON = {
    gauge: 'M12 4a9 9 0 0 0-9 9h2a7 7 0 0 1 14 0h2a9 9 0 0 0-9-9zm4.2 3.4-5 5a1.5 1.5 0 1 0 1.4 1.4l5-5z',
    trophy: 'M7 2h10v2h4v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 13.9V17h3v3H8v-3h3v-3.1A5 5 0 0 1 7.3 11H7a4 4 0 0 1-4-4V4h4zm-2 4v1a2 2 0 0 0 2 2V6zm12 0v3a2 2 0 0 0 2-2V6z',
    alert: 'M12 2 1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z',
    route: 'M6 3a3 3 0 0 1 1 5.8V14a3 3 0 0 0 3 3h4.2A3 3 0 1 1 14.2 19H10a5 5 0 0 1-5-5V8.8A3 3 0 0 1 6 3zm12-1 4 4-4 4V7h-4V5h4z',
    clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.4 3.5 2-1 1.8L11 13V6h2z',
    cause: 'M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z',
    hub: 'M12 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM5 16a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm14 0a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM11 8h2v4l5.5 4-1.2 1.6L12 13.7l-5.3 3.9-1.2-1.6L11 12z',
    ap: 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z',
  };
  $('insightGrid').innerHTML = tiles.map((x) => `
    <div class="ins ${x.tone}">
      <span class="ins-ic"><svg viewBox="0 0 24 24"><path fill="currentColor" d="${ICON[x.ic]}"/></svg></span>
      <div><small>${x.t}</small><b>${esc(x.v)}</b><p>${x.d}</p></div>
    </div>`).join('');

  // rekomendasi berbasis temuan
  const reco = [];
  const morn = (() => { const s = A.hour.slice(5, 10); return pct(s.reduce((a, h) => a + h.late, 0), s.reduce((a, h) => a + h.ops, 0)); })();
  const eve = (() => { const s = A.hour.slice(17, 22); return pct(s.reduce((a, h) => a + h.late, 0), s.reduce((a, h) => a + h.ops, 0)); })();
  if (A.hasHour && eve > morn * 1.2) reco.push(`<b>Tambahkan buffer turnaround 10–15 menit untuk slot 17.00–21.00</b>, terutama maskapai LCC. Delay sore-malam ${f1(eve / (morn || 1))}× lebih tinggi dari pagi akibat efek domino rotasi pesawat.`);
  if (worst && best) reco.push(`<b>Lakukan evaluasi kinerja bersama ${esc(nm(worst.code))}</b> (OTP ${f1(worst.otp)}%) — tetapkan target perbaikan bertahap menuju rata-rata nasional ${f1(A.st.otp)}% dan jadikan praktik ${esc(nm(best.code))} sebagai benchmark.`);
  if (critical) reco.push(`<b>Prioritaskan rute ${critical.a} ⇄ ${critical.b}</b>: evaluasi alokasi slot dan gate di ${esc(city(critical.a))} dan ${esc(city(critical.b))} pada jam puncak, karena rute ini padat sekaligus paling rawan delay.`);
  const internal = pct(A.causeList.filter(([k]) => /operasional|teknis|rotasi|maskapai/i.test(k)).reduce((s, e) => s + e[1], 0), causeTot);
  if (internal > 40) reco.push(`<b>Fokus pada faktor yang bisa dikendalikan</b>: ${f1(internal)}% delay berasal dari operasional, rotasi & teknis maskapai — perkuat koordinasi ground handling, kesiapan armada cadangan, dan pemantauan on-time di bandara hub.`);
  if (bott) reco.push(`<b>Urai bottleneck ${bott.ap} pukul ${hh(bott.h)}</b> (peluang delay ${f1(bott.rate)}%): tinjau alokasi slot runway & gate di jam tersebut dan siapkan petugas turnaround tambahan.`);
  const sz = byKey(rows.filter((f) => f.season), (f) => f.season);
  if (sz.has('Lebaran') && sz.has('Reguler')) {
    const a1 = stats(sz.get('Lebaran')), a0 = stats(sz.get('Reguler'));
    const d1 = new Set(sz.get('Lebaran').map((f) => f.date)).size, d0 = new Set(sz.get('Reguler').map((f) => f.date)).size;
    reco.push(`<b>Rencana kapasitas mudik Lebaran</b>: volume harian naik ${f1(pct(sz.get('Lebaran').length / d1 - sz.get('Reguler').length / d0, sz.get('Reguler').length / d0))}% dan OTP turun ${f1(a0.otp - a1.otp)} pp. Aktifkan posko terpadu, extra flight terjadwal di luar jam puncak, dan tambahan ground handling di CGK & SUB mulai H-7.`);
  }
  if (pct(viaCGK, rows.length) > 40) reco.push(`<b>Kurangi ketergantungan pada CGK</b> dengan mendorong rute langsung antar-hub (SUB, UPG, BPN, KNO) dan memperkuat bandara Indonesia Timur sebagai hub regional.`);
  $('recoList').innerHTML = reco.map((x) => `<li>${x}</li>`).join('');
}

/* =========================================================
   7b. DECISION SUPPORT: biaya delay, simulasi, terminal, FIDS, brief, model statistik
   ========================================================= */

/* ---------- Biaya delay (Cost of Delay) ----------
   Semua angka di bawah adalah ASUMSI yang bisa diubah (juga dari panel simulasi),
   kecuali kompensasi Rp300.000 untuk delay > 240 menit yang tertulis di PM 89/2015.
   Kompensasi hanya dihitung bila penyebabnya faktor manajemen maskapai (bukan cuaca/teknis). */
const COST = {
  perMinute: 1000000,              // Rp per menit keterlambatan per penerbangan (avtur, kru, ground handling) — asumsi
  tiers: [                         // PM 89/2015: kategori keterlambatan → biaya per penumpang (nilai Rp kategori 1–4 = asumsi harga konsumsi)
    { min: 30, max: 60, rp: 15000 },     // kategori 1: minuman ringan
    { min: 61, max: 120, rp: 35000 },    // kategori 2: minuman + makanan ringan
    { min: 121, max: 180, rp: 60000 },   // kategori 3: minuman + makanan berat
    { min: 181, max: 240, rp: 85000 },   // kategori 4: minuman, makanan ringan & berat
    { min: 241, max: Infinity, rp: 300000 }, // kategori 5: ganti rugi Rp300.000 (PM 89/2015)
  ],
  compCause: /operasional maskapai|manajemen/i,
};
const rp = (v) => {
  const a = Math.abs(v);
  if (a >= 1e12) return `Rp ${f1(v / 1e12)} T`;
  if (a >= 1e9) return `Rp ${f1(v / 1e9)} M`;
  if (a >= 1e6) return `Rp ${f1(v / 1e6)} jt`;
  return `Rp ${nf.format(Math.round(v))}`;
};
function compPerPax(delay) { const t = COST.tiers.find((x) => delay >= x.min && delay <= x.max); return t ? t.rp : 0; }
function flightCost(f) {
  if (f.cancelled || f.onTime) return { op: 0, comp: 0 };
  return { op: f.delay * COST.perMinute, comp: COST.compCause.test(f.cause) ? compPerPax(f.delay) * f.pax : 0 };
}
function costOf(rows) {
  let op = 0, comp = 0;
  for (const f of rows) { const c = flightCost(f); op += c.op; comp += c.comp; }
  return { op, comp, total: op + comp };
}
function renderCostKPI(rows) {
  const c = costOf(rows);
  let pv = null;
  if (S.period !== 'all') { const pr = filterRows(prevMonth(S.period)); if (pr.length) pv = costOf(pr); }
  countUp($('kCost'), c.total, (v) => rp(v).replace('Rp ', ''));
  $('kCostSub').innerHTML = delta(c.total, pv && pv.total, { goodUp: false }) + `operasional ${rp(c.op)}, kompensasi ${rp(c.comp)}`;
  S.cost = c;
}

/* ---------- Simulator what-if ---------- */
const SIM = { shift: 0, internal: 0, buffer: 0 };
function hourRates(rows) {
  // peluang delay per maskapai × jam: dari model ML jika ada, kalau tidak dari data
  const R = {};
  if (S.raw.delay_risk && S.raw.delay_risk.length) {
    S.raw.delay_risk.forEach((r) => { (R[r.airline_code] = R[r.airline_code] || {})[+r.hour] = +r.risk; });
    return { R, src: 'model ML' };
  }
  const g = {};
  rows.forEach((f) => { if (f.cancelled || f.hour == null) return; const k = f.al + '|' + f.hour; const x = g[k] || (g[k] = { n: 0, l: 0 }); x.n++; if (!f.onTime) x.l++; });
  Object.entries(g).forEach(([k, v]) => { const [a, h] = k.split('|'); (R[a] = R[a] || {})[+h] = v.n >= 20 ? v.l / v.n : null; });
  return { R, src: 'data historis' };
}
function simulate(rows) {
  const { R, src } = hourRates(rows);
  const offRate = {};
  Object.entries(R).forEach(([a, hrs]) => {
    const v = [10, 11, 12, 13, 14, 15].map((h) => hrs[h]).filter((x) => x != null);
    offRate[a] = v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  });
  const X = SIM.shift / 100, Y = SIM.internal / 100, Z = SIM.buffer;
  let ops = 0, late0 = 0, late1 = 0, min0 = 0, min1 = 0, cost0 = 0, cost1 = 0, moved = 0;
  const byAl = {};
  for (const f of rows) {
    if (f.cancelled) continue;
    ops++;
    const a = byAl[f.al] || (byAl[f.al] = { ops: 0, l0: 0, l1: 0 }); a.ops++;
    if (f.hour != null && f.hour >= 17 && f.hour <= 21) moved += X;
    if (f.onTime) continue;
    const c0 = flightCost(f);
    let p = 1, m = f.delay;
    const lcc = S.alIndex[f.al] && /lcc/i.test(S.alIndex[f.al].type);
    if (lcc && Z > 0) { m = Math.max(0, f.delay - Z); if (m <= CFG.otpLimit) { p = 0; m = 0; } }
    if (p && Y > 0 && /operasional|rotasi|teknis/i.test(f.cause)) { p *= 1 - Y; m *= 1 - Y; }
    if (p && X > 0 && f.hour >= 17 && f.hour <= 21) {
      const r = R[f.al] && R[f.al][f.hour], o = offRate[f.al];
      if (r && o != null) { const fac = (1 - X) + X * Math.min(1.5, o / r); p *= fac; m *= fac; }
    }
    late0++; late1 += p; min0 += f.delay; min1 += m;
    cost0 += c0.op + c0.comp;
    cost1 += m * COST.perMinute + (COST.compCause.test(f.cause) && p > 0 ? compPerPax(m / Math.max(p, 1e-9)) * f.pax * p : 0);
    a.l0++; a.l1 += p;
  }
  return { src, ops, otp0: 100 - pct(late0, ops), otp1: 100 - pct(late1, ops), avoided: late0 - late1, saved: cost0 - cost1, cost0, cost1, minSaved: min0 - min1, moved: Math.round(moved), byAl };
}
function renderSim(rows) {
  const r = simulate(rows);
  $('simOtp0').textContent = f1(r.otp0) + '%';
  $('simOtp1').textContent = f1(r.otp1) + '%';
  const d = r.otp1 - r.otp0;
  $('simDelta').textContent = `${d >= 0 ? '+' : ''}${f1(d)} poin persen`;
  $('simDelta').className = 'sim-delta ' + (d > 0.05 ? 'up' : '');
  $('simTarget').textContent = r.otp1 >= CFG.otpTarget ? `Target ${CFG.otpTarget}% tercapai` : `Masih ${f1(CFG.otpTarget - r.otp1)} pp di bawah target ${CFG.otpTarget}%`;
  $('simAvoid').textContent = nf.format(Math.round(r.avoided));
  $('simMinutes').textContent = compact(r.minSaved);
  $('simSaved').textContent = rp(r.saved);
  $('simMoved').textContent = nf.format(r.moved);
  ['shift', 'internal', 'buffer'].forEach((k) => { $('v_' + k).textContent = SIM[k] + (k === 'buffer' ? ' mnt' : '%'); });

  const codes = Object.keys(r.byAl).sort((a, b) => pct(r.byAl[b].l0, r.byAl[b].ops) - pct(r.byAl[a].l0, r.byAl[a].ops));
  const nm = (c) => (S.alIndex[c] ? S.alIndex[c].airline_name : c);
  mk('cSim', {
    type: 'bar',
    data: {
      labels: codes.map(nm),
      datasets: [
        { label: 'OTP saat ini', data: codes.map((c) => +(100 - pct(r.byAl[c].l0, r.byAl[c].ops)).toFixed(1)), backgroundColor: hexA(css('--muted'), 0.45), borderRadius: 6, maxBarThickness: 18 },
        { label: 'OTP skenario', data: codes.map((c) => +(100 - pct(r.byAl[c].l1, r.byAl[c].ops)).toFixed(1)), backgroundColor: css('--brass'), borderRadius: 6, maxBarThickness: 18 },
      ],
    },
    options: opts({
      indexAxis: 'y', interaction: { mode: 'index', axis: 'y', intersect: false },
      scales: { x: { min: 60, max: 100, ticks: { callback: (v) => v + '%' } }, y: { grid: { display: false } } },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${f1(c.parsed.x)}%` } } },
    }),
  });
  const any = SIM.shift || SIM.internal || SIM.buffer;
  setInterp('iSim', any ? [
    `Dengan skenario ini OTP naik dari <b>${f1(r.otp0)}%</b> ke <b>${f1(r.otp1)}%</b>: sekitar <b>${nf.format(Math.round(r.avoided))} penerbangan</b> tidak lagi terlambat dan estimasi penghematan <b>${rp(r.saved)}</b> pada periode terpilih.`,
    SIM.buffer ? `Buffer turnaround ${SIM.buffer} menit untuk LCC adalah tuas paling murah: penerbangan yang tadinya terlambat tipis (16–${15 + SIM.buffer} menit) langsung masuk kategori tepat waktu.` : '',
    SIM.shift ? `Memindahkan ${SIM.shift}% penerbangan 17.00–21.00 ke 10.00–15.00 memakai peluang delay per maskapai × jam dari ${r.src}. Simulasi mengasumsikan slot siang masih cukup longgar, sehingga dampak kemacetan baru di jam tujuan belum dimodelkan.` : '',
    SIM.internal ? `Penurunan ${SIM.internal}% delay akibat faktor internal (operasional, rotasi & teknis) mencerminkan program perbaikan ground handling dan kesiapan armada.` : '',
  ] : ['Geser slider untuk menguji kebijakan. Angka berubah langsung berdasarkan data dan filter yang aktif.']);
}

/* ---------- Utilisasi terminal CGK ----------
   Pemetaan maskapai → terminal dan kapasitas gate adalah ASUMSI simulasi
   (alokasi terminal Soekarno-Hatta berubah beberapa kali sejak 2025). */
const CGK = {
  terminals: [
    { id: 'T1A', airlines: ['JT'], gates: 9 },
    { id: 'T1B', airlines: ['QG'], gates: 9 },
    { id: 'T1C', airlines: ['IU', 'IW', 'QZ'], gates: 9 },
    { id: 'T2', airlines: ['ID', 'IP'], gates: 14 },
    { id: 'T3', airlines: ['GA'], gates: 16 },
  ],
  gateMinutes: 50,           // lama satu pesawat menempati gate (menit) — asumsi
  realDepPerDay: 450,        // keberangkatan domestik CGK per hari di dunia nyata (asumsi) → skala sampel data
};
function terminalOf(code) { const t = CGK.terminals.find((x) => x.airlines.includes(code)); return t ? t.id : 'T2'; }
function renderTerminals(rows) {
  const deps = rows.filter((f) => f.o === 'CGK' && !f.cancelled);
  const card = $('terminalCard');
  if (!deps.length) { card.classList.add('dim'); $('termList').innerHTML = '<p class="muted">Tidak ada keberangkatan dari CGK pada filter ini.</p>'; setInterp('iTerm', []); return; }
  card.classList.remove('dim');
  const days = new Set(deps.map((f) => f.date)).size || 1;
  const scale = CGK.realDepPerDay / (deps.length / days);
  const out = CGK.terminals.map((t) => {
    const r = deps.filter((f) => t.airlines.includes(f.al));
    const hrs = new Array(24).fill(0); r.forEach((f) => { if (f.hour != null) hrs[f.hour]++; });
    const peakH = hrs.indexOf(Math.max(...hrs));
    const peakPerHour = (hrs[peakH] / days) * scale;                   // keberangkatan pada jam puncak (skala nyata)
    const util = pct(peakPerHour * CGK.gateMinutes / 60, t.gates);      // gate-jam dibutuhkan ÷ gate tersedia
    const late = r.filter((f) => !f.onTime).length;
    return { ...t, n: r.length, peakH, util, delay: pct(late, r.length) };
  });
  const lvl = (u) => (u >= 85 ? ['bad', 'Overload'] : u >= 65 ? ['warn', 'Padat'] : ['good', 'Optimal']);
  $('termList').innerHTML = out.map((t) => {
    const [c, l] = lvl(t.util);
    return `<div class="term ${c}">
      <div class="term-id"><b>${t.id}</b><span>${t.airlines.map((a) => logoHTML(a, 0, 'xs')).join('')}</span></div>
      <div class="term-bar"><i style="width:${Math.min(100, t.util)}%"></i><em style="left:85%"></em></div>
      <div class="term-num"><b>${f1(t.util)}%</b><span class="tag-${c}">${l}</span></div>
      <div class="term-meta">jam puncak ${hh(t.peakH)}, delay ${f1(t.delay)}%, ${t.gates} gate</div>
    </div>`;
  }).join('');
  const worst = out.reduce((a, b) => (b.util > a.util ? b : a));
  const calm = out.reduce((a, b) => (b.util < a.util ? b : a));
  const cor = pearson(out.map((t) => t.util), out.map((t) => t.delay));
  setInterp('iTerm', [
    `Terminal paling tertekan: <b>${worst.id}</b> dengan utilisasi gate <b>${f1(worst.util)}%</b> pada jam puncak ${hh(worst.peakH)}${worst.util >= 85 ? ' — di atas ambang 85%, antrean gate & bus apron berisiko memperpanjang turnaround' : ''}. Paling longgar: <b>${calm.id}</b> (${f1(calm.util)}%).`,
    `Antar-terminal, utilisasi dan tingkat delay berkorelasi <b>r = ${cor.toFixed(2).replace('.', ',')}</b> (hanya ${out.length} titik, jadi indikatif). Rekomendasi: tambahkan petugas turnaround dan shuttle apron di ${worst.id} pada jam puncak, atau pindahkan sebagian slot ke ${calm.id}.`,
    `<span class="muted">Pemetaan maskapai–terminal, jumlah gate, dan volume ${nf.format(CGK.realDepPerDay)} keberangkatan/hari adalah asumsi simulasi (ubah di objek <code>CGK</code> pada app.js).</span>`,
  ]);
}

/* ---------- Papan FIDS ---------- */
let fidsTimer = null;
const FIDS = { ap: 'CGK', prev: {} };
function gateOf(f) {
  let h = 0; for (const ch of f.no) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  if (FIDS.ap === 'CGK') { const t = terminalOf(f.al); const pref = { T1A: 'A', T1B: 'B', T1C: 'C', T2: 'E', T3: '' }[t]; return { term: t.replace('T', ''), gate: (pref || '') + (1 + (h % (pref ? 9 : 24))) }; }
  return { term: '–', gate: String(1 + (h % 12)) };
}
function openFids() {
  const sel = $('fidsAirport');
  const hubs = S.airports.filter((a) => a.is_hub).map((a) => a.iata);
  sel.innerHTML = hubs.map((c) => `<option value="${c}">${c} — ${esc(city(c))}</option>`).join('');
  sel.value = hubs.includes(FIDS.ap) ? FIDS.ap : hubs[0];
  FIDS.ap = sel.value; FIDS.prev = {};
  $('fids').hidden = false; document.body.classList.add('no-scroll');
  renderFids(); clearInterval(fidsTimer); fidsTimer = setInterval(renderFids, 15000);
  $('fidsClose').focus();
}
function closeFids() { $('fids').hidden = true; document.body.classList.remove('no-scroll'); clearInterval(fidsTimer); }
function renderFids() {
  const now = new Date();
  const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const nowMin = wib.getHours() * 60 + wib.getMinutes();
  const dow = (wib.getDay() + 6) % 7;
  const dates = [...new Set(S.flights.map((f) => f.date))].sort();
  const ref = dates.slice().reverse().find((d) => dowOf(d) === dow) || dates[dates.length - 1];
  const list = S.flights.filter((f) => f.date === ref && f.o === FIDS.ap && f.sm != null)
    .map((f) => ({ no: f.no, al: f.al, d: f.d, sched: f.sm, schedTxt: `${String(Math.floor(f.sm / 60)).padStart(2, '0')}:${String(f.sm % 60).padStart(2, '0')}`,
      delay: f.delay, cancelled: f.cancelled }))
    .sort((a, b) => a.sched - b.sched);
  let rows = list.filter((f) => f.sched + f.delay >= nowMin - 20).slice(0, 13);
  if (rows.length < 13) rows = rows.concat(list.slice(0, 13 - rows.length).map((f) => ({ ...f, tomorrow: true })));
  const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  $('fidsClock').textContent = wib.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
  $('fidsDate').textContent = wib.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('fidsNote').textContent = `Simulasi: jadwal diambil dari data ${HARI[dowOf(ref)]} ${longLabel(ref)}; nomor gate & terminal ilustratif.`;
  $('fidsBody').innerHTML = rows.map((f) => {
    const dep = f.sched + (f.delay > CFG.otpLimit ? f.delay : 0);
    const left = f.tomorrow ? 9999 : dep - nowMin;
    let st, cls;
    if (f.cancelled) { st = 'CANCELLED'; cls = 'bad'; }
    else if (left < 0) { st = 'DEPARTED'; cls = 'dim'; }
    else if (f.delay > CFG.otpLimit) { st = `DELAYED ${fmt(dep)}`; cls = 'warn'; }
    else if (left <= 10) { st = 'FINAL CALL'; cls = 'blink'; }
    else if (left <= 35) { st = 'BOARDING'; cls = 'go'; }
    else { st = 'ON SCHEDULE'; cls = 'ok'; }
    const key = f.no + f.schedTxt, flip = FIDS.prev[key] && FIDS.prev[key] !== st ? ' flip' : '';
    FIDS.prev[key] = st;
    const g = gateOf(f);
    return `<tr><td class="ft">${f.schedTxt}${f.tomorrow ? '<sup>+1</sup>' : ''}</td><td class="fn">${logoHTML(f.al, 0, 'xs')}${esc(f.no)}</td>
      <td class="fd">${esc(city(f.d)).toUpperCase()} <small>${esc(f.d)}</small></td><td>${g.term}</td><td>${g.gate}</td><td class="fs ${cls}${flip}"><span>${st}</span></td></tr>`;
  }).join('') || '<tr><td colspan="6">Tidak ada keberangkatan pada data referensi.</td></tr>';
}

/* ---------- Brief eksekutif (cetak / PDF) ---------- */
async function exportBrief() {
  const wasDark = theme() === 'dark';
  S.noAnim = true;
  if (wasDark) document.documentElement.dataset.theme = 'light';
  renderAll({ skipMap: true });
  await new Promise((r) => setTimeout(r, 120));
  const img = (id) => (charts[id] ? charts[id].toBase64Image('image/png', 1) : '');
  const rows = filterRows(); const st = stats(rows); const A = analyze(rows); const c = costOf(rows);
  const scope = [S.period === 'all' ? 'Semua periode' : monthLabel(S.period), S.airport === 'all' ? 'semua bandara' : S.airport, S.season === 'all' ? '' : `musim ${S.season}`].filter(Boolean).join(', ');
  const seats = rows.reduce((x, f) => x + f.seats, 0);
  $('brief').innerHTML = `
    <header class="b-head">
      <div class="b-brand"><span class="b-mark">✈</span><div><b>Nusantara Flight Monitor</b><small>Brief eksekutif kinerja penerbangan domestik</small></div></div>
      <div class="b-meta"><span>${esc(scope)}</span><span>Dicetak ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</span><span>Analis: <b>M. Naufal Zamani</b></span></div>
    </header>
    <section class="b-kpis">
      <div><span>Penerbangan</span><b>${nf.format(st.n)}</b></div>
      <div><span>OTP nasional</span><b>${f1(st.otp)}%</b><small>target ${CFG.otpTarget}%</small></div>
      <div><span>Penumpang</span><b>${compact(st.pax)}</b>${seats ? `<small>LF ${f1(pct(st.pax, seats))}%</small>` : ''}</div>
      <div><span>Rata-rata delay</span><b>${f1(st.avgDelay)} mnt</b></div>
      <div><span>Estimasi biaya delay</span><b>${rp(c.total)}</b><small>asumsi Rp ${nf.format(COST.perMinute)}/menit</small></div>
    </section>
    <section class="b-cols">
      <div><h3>Temuan utama</h3>${$('insightGrid').innerHTML}</div>
      <div><h3>Rekomendasi</h3><ol>${$('recoList').innerHTML}</ol></div>
    </section>
    <section class="b-charts">
      <figure><img src="${img('cTrend')}" alt=""><figcaption>Tren volume & OTP</figcaption></figure>
      <figure><img src="${img('cOtp')}" alt=""><figcaption>OTP per maskapai</figcaption></figure>
    </section>
    <footer class="b-foot">Data simulasi untuk portofolio; tidak mewakili kinerja resmi maskapai/bandara. Biaya delay memakai asumsi yang dapat diubah; kompensasi mengacu PM 89/2015.</footer>`;
  if (wasDark) { document.documentElement.dataset.theme = 'dark'; renderAll({ skipMap: true }); }
  S.noAnim = false;
  window.print();
}

/* ---------- Model statistik (hasil statistical_models.ipynb) ---------- */
function tex(el, src) {
  if (!el) return;
  if (window.katex) { try { katex.render(src, el, { displayMode: true, throwOnError: false }); return; } catch (e) { /* fallback */ } }
  el.textContent = src;
}
function renderStats() {
  const SM = S.raw.stat_models, FC = S.raw.forecast, HI = S.raw.forecast_history, MM = S.raw.model_metrics;
  const has = !!(SM && FC && FC.length);
  $('statsEmpty').hidden = has; $('statsBody').hidden = !has;
  if (!has) return;
  const sa = SM.sarima, dd = SM.delay_dist;
  const n3 = (v) => Math.abs(v).toFixed(3);
  const polyTxt = (arr, s, lag) => arr.map((v, i) => { const e = (i + 1) * lag; return `${v < 0 ? '-' : '+'} ${n3(v)}${e === 1 ? 'B' : `B^{${e}}`}`; }).join(' ');
  const ma = sa.theta.length ? `(1 ${polyTxt(sa.theta, 1, 1)})` : '';
  const sma = sa.Theta.length ? `(1 ${polyTxt(sa.Theta, 7, 7)})` : '';
  const ar = sa.phi.length ? `(1 ${polyTxt(sa.phi.map((x) => -x), 1, 1)})` : '';
  const sar = sa.Phi.length ? `(1 ${polyTxt(sa.Phi.map((x) => -x), 7, 7)})` : '';
  tex($('texSarima'), `${ar}${sar}(1-B)(1-B^{7})\\,u_t = ${ma}${sma}\\,\\varepsilon_t`);
  tex($('texSarimaReg'), `\\ln Y_t = ${(Math.log(1 + sa.efek_lebaran_pct / 100)).toFixed(3)}\\,\\text{Lebaran}_t + ${(Math.log(1 + sa.efek_nataru_pct / 100)).toFixed(3)}\\,\\text{Nataru}_t + \\dots + u_t`);
  $('sarimaFacts').innerHTML = `<li><b>${esc(sa.model)}</b> dipilih dengan BIC terendah (AIC ${f1(sa.aic)}).</li>
    <li>Efek musim: <b>Lebaran +${f1(sa.efek_lebaran_pct)}%</b>, <b>Nataru +${f1(sa.efek_nataru_pct)}%</b> penumpang/hari.</li>
    <li>Backtest 28 hari: <b>MAPE ${f1(sa.mape_backtest)}%</b> (seasonal naive ${f1(sa.mape_naive)}%). Ljung–Box lag 14: p = ${String(sa.ljung_box_p14).replace('.', ',')}.</li>`;
  tex($('texGamma'), `f(x;\\hat\\alpha,\\hat\\beta)=\\frac{x^{\\hat\\alpha-1}e^{-x/\\hat\\beta}}{\\Gamma(\\hat\\alpha)\\hat\\beta^{\\hat\\alpha}},\\quad \\hat\\alpha=${dd.gamma_alpha.toFixed(3)},\\ \\hat\\beta=${dd.gamma_beta.toFixed(1)}`);
  $('gammaFacts').innerHTML = `<li>X = menit di atas ambang 15 menit, dari ${nf.format(dd.n)} penerbangan delay; Gamma terpilih (AIC terendah).</li>
    <li>P(delay &gt; 60 mnt | delay) = <b>${f1(dd.p_gt60 * 100)}%</b> (empiris ${f1(dd.p_gt60_empiris * 100)}%).</li>
    <li>P(delay &gt; 240 mnt | delay) = <b>${f1(dd.p_gt240 * 100)}%</b> → ambang kompensasi Rp300.000/penumpang (PM 89/2015).</li>`;
  if (MM && MM.odds_ratio) {
    const o = MM.odds_ratio;
    tex($('texLogit'), `\\ln\\frac{P(\\text{Delay})}{1-P(\\text{Delay})}=\\beta_0+\\boldsymbol\\beta^{\\top}\\mathbf{x},\\qquad P(\\text{Delay})=\\frac{1}{1+e^{-(\\beta_0+\\boldsymbol\\beta^{\\top}\\mathbf{x})}}`);
    const r = (a, b) => (o[a] && o[b] ? f1(o[a] / o[b]) : '–');
    $('logitFacts').innerHTML = `<li>Odds delay Lion Air ≈ <b>${r('airline_JT', 'airline_GA')}×</b> Garuda Indonesia pada kondisi lain yang sama.</li>
      <li>Odds delay saat Lebaran ≈ <b>${r('season_Lebaran', 'season_Reguler')}×</b> hari reguler.</li>
      <li>Setiap ±4,5 jam lebih sore (1 simpangan baku), odds delay ×<b>${o.hour ? f1(o.hour) : '–'}</b>. ROC-AUC uji ${String(MM.roc_auc_lr).replace('.', ',')}.</li>`;
  }
  // grafik ramalan
  const h = (HI || []).map((r) => ({ d: String(r.date), v: +r.pax }));
  const f = FC.map((r) => ({ d: String(r.date), m: +r.mean, lo: +r.lower_95, hi: +r.upper_95 }));
  const labels = [...h.map((x) => x.d), ...f.map((x) => x.d)];
  const pad = (arr, before) => [...new Array(before).fill(null), ...arr];
  const lastH = h.length ? h[h.length - 1].v : null;
  mk('cForecast', {
    data: {
      labels: labels.map(longLabel),
      datasets: [
        { type: 'line', label: 'Batas atas 95%', data: pad(f.map((x) => x.hi), h.length), borderWidth: 0, pointRadius: 0, backgroundColor: hexA(css('--brass'), 0.22), fill: '+1', order: 3 },
        { type: 'line', label: 'Batas bawah 95%', data: pad(f.map((x) => x.lo), h.length), borderWidth: 0, pointRadius: 0, fill: false, order: 3 },
        { type: 'line', label: 'Aktual', data: [...h.map((x) => x.v), ...new Array(f.length).fill(null)], borderColor: css('--blue'), borderWidth: 2, pointRadius: 0, tension: 0.25, order: 1 },
        { type: 'line', label: 'Ramalan SARIMA', data: [...new Array(Math.max(0, h.length - 1)).fill(null), lastH, ...f.map((x) => x.m)], borderColor: css('--brass'), borderWidth: 2.5, borderDash: [6, 4], pointRadius: 0, tension: 0.25, order: 0 },
      ],
    },
    options: opts({
      plugins: { legend: { labels: { filter: (it) => !/Batas bawah/.test(it.text) } }, tooltip: { callbacks: { label: (c) => (c.parsed.y == null ? '' : ` ${c.dataset.label}: ${nf.format(Math.round(c.parsed.y))} pax`) } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0 } }, y: { ticks: { callback: (v) => compact(v) }, title: { display: true, text: 'Penumpang per hari' } } },
    }),
  });
  const tot = f.reduce((x, y) => x + y.m, 0), pk = f.reduce((a, b) => (b.m > a.m ? b : a));
  setInterp('iForecast', [
    `Ramalan ${f.length} hari ke depan: rata-rata <b>${nf.format(Math.round(tot / f.length))} penumpang/hari</b>, puncak pada <b>${longLabel(pk.d)}</b> (${nf.format(Math.round(pk.m))}; selang 95% ${nf.format(Math.round(pk.lo))}–${nf.format(Math.round(pk.hi))}).`,
    'Pola gigi gergaji mingguan (Jumat & Minggu tinggi) terbawa dari komponen musiman s = 7. Selang melebar seiring horizon karena ketidakpastian ramalan terakumulasi (Var = σ²Σψ²).',
    `<span class="muted">Diestimasi di <code>analysis/statistical_models.ipynb</code> (${esc(sa.metode)}).</span>`,
  ]);
}

/* =========================================================
   8. RENDER SEMUA
   ========================================================= */
function renderHero() {
  const used = new Set(S.flights.flatMap((f) => [f.o, f.d]));
  const routes = new Set(S.flights.map((f) => f.route));
  const als = new Set(S.flights.map((f) => f.al));
  const dates = S.flights.map((f) => f.date).sort();
  countUp($('hAirports'), used.size, (v) => nf.format(Math.round(v)));
  countUp($('hRoutes'), routes.size, (v) => nf.format(Math.round(v)));
  countUp($('hAirlines'), als.size, (v) => nf.format(Math.round(v)));
  const a = dates[0], b = dates[dates.length - 1];
  $('hRange').textContent = a ? `${BLN[+a.slice(5, 7) - 1]}–${BLN[+b.slice(5, 7) - 1]} ${b.slice(0, 4)}` : '—';
}

function renderAll({ skipMap = false } = {}) {
  chartDefaults();
  const rows = filterRows();
  const A = analyze(rows);
  renderKPIs(rows);
  renderCostKPI(rows);
  renderInsights(rows, A);
  if (!skipMap) renderMap(rows);
  renderAirline(rows, A);
  renderHistogram(rows, A);
  renderOtpRanking(rows, A);
  renderCauses(rows, A);
  renderTrend(rows, A);
  renderSeason(rows, A);
  renderHourly(rows, A);
  renderHeatmap(rows, A);
  renderAirports(rows, A);
  renderTerminals(rows);
  renderSim(rows);
  renderTable(rows);
  const scope = [S.period === 'all' ? 'semua periode' : monthLabel(S.period), S.airport === 'all' ? 'semua bandara' : S.airport].join(' · ');
  $('dataBadge').textContent = `${nf.format(rows.length)} dari ${nf.format(S.flights.length)} penerbangan · ${scope}`;
}

function buildSearch() {
  const opts = [
    ...S.airports.map((a) => `${a.iata} — ${a.city} (${a.airport_name})`),
    ...S.airlines.map((a) => a.airline_name),
  ];
  $('searchList').innerHTML = opts.map((o) => `<option value="${esc(o)}">`).join('');
}

function boot(d) {
  try {
    S.raw = { ...S.raw, ...d };
    ingest(S.raw);
    buildFilters();
    buildSearch();
    renderHero();
    renderAll();
    renderModel();
    renderStats();
    $('overlay').hidden = true;
    setTimeout(() => map.invalidateSize(), 50);
  } catch (err) {
    console.error(err);
    toast(err.message, true);
  }
}

/* =========================================================
   9. UI: sidebar, pencarian, tema, file
   ========================================================= */
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 5000);
}

const isMobile = () => window.matchMedia('(max-width: 860px)').matches;
function closeMobileMenu() { document.documentElement.classList.remove('sb-open'); }

function doSearch(q) {
  q = q.trim().toLowerCase();
  if (!q) return;
  const code = q.split(/\s|—/)[0].toUpperCase();
  const ap = S.apIndex[code] || S.airports.find((a) => a.city.toLowerCase().includes(q) || a.airport_name.toLowerCase().includes(q));
  const al = S.alIndex[code] || S.airlines.find((a) => a.airline_name.toLowerCase().includes(q));
  if (al && !(ap && ap.iata === code)) {
    S.selAirline = al.airline_code; S.mapAirline = al.airline_code;
    $('fMapAirline').value = al.airline_code;
    renderAll();
    document.getElementById('maskapai').scrollIntoView();
    toast(`Menampilkan ${al.airline_name}`);
  } else if (ap) {
    S.airport = ap.iata; $('fAirport').value = ap.iata;
    renderAll();
    document.getElementById('peta').scrollIntoView();
    map.flyTo([ap.lat, ap.lon], 6, { duration: 1.2 });
    toast(`Filter bandara: ${ap.iata} — ${ap.city}`);
  } else {
    toast(`"${q}" tidak ditemukan. Coba kode IATA (mis. CGK) atau nama maskapai.`, true);
    return;
  }
  $('searchInput').value = '';
  closeMobileMenu();
}

function updateThemeLabel() {
  document.querySelector('.theme-label').textContent = theme() === 'dark' ? 'Mode siang' : 'Mode malam';
}

function bindUI() {
  $('fPeriod').addEventListener('change', (e) => { S.period = e.target.value; renderAll(); });
  $('fAirport').addEventListener('change', (e) => { S.airport = e.target.value; renderAll(); });
  $('fSeason').addEventListener('change', (e) => { S.season = e.target.value; renderAll(); });
  $('fMapAirline').addEventListener('change', (e) => { S.mapAirline = e.target.value; renderMap(filterRows()); });
  $('btnReset').addEventListener('click', () => {
    S.airport = 'all'; S.mapAirline = 'all'; S.season = 'all'; $('fSeason').value = 'all';
    const months = [...new Set(S.flights.map((f) => f.month))].sort();
    S.period = months[months.length - 1] || 'all';
    $('fPeriod').value = S.period; $('fAirport').value = 'all'; $('fMapAirline').value = 'all';
    renderAll();
    map.flyToBounds([[6.5, 94.5], [-11.2, 141.2]], { duration: 1 });
  });
  $('airlineChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    S.selAirline = b.dataset.code; renderAll({ skipMap: true });
  });
  syncBaseButtons();
  $('btnPlanes').classList.toggle('on', S.planesOn);
  $('btnPlanes').addEventListener('click', () => {
    S.planesOn = !S.planesOn;
    $('btnPlanes').classList.toggle('on', S.planesOn);
    $('map').classList.toggle('no-planes', !S.planesOn);
    if (S.planesOn && !planeRAF) planeRAF = requestAnimationFrame(tickPlanes);
  });
  $('btnLogo').addEventListener('click', () => $('logoInput').click());
  $('logoInput').addEventListener('change', async (e) => { await loadLogoFiles(e.target.files); e.target.value = ''; });
  $('btnLogoReset').addEventListener('click', () => {
    S.logoOverride = {};
    try { localStorage.removeItem('nfm-logos'); } catch (e) { /* abaikan */ }
    if (S.flights.length) renderAll({ skipMap: true });
    toast('Logo yang dipasang lewat tombol sudah dihapus.');
  });
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    S.base = b.dataset.base; syncBaseButtons(); setTiles();
    if (S.flights.length) renderMap(filterRows());
  }));

  $('btnTheme').addEventListener('click', () => {
    const t = theme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('nfm-theme', t); } catch (e) { /* abaikan */ }
    updateThemeLabel();
    setTiles();
    if (S.flights.length) { renderAll(); renderModel(); renderStats(); }
  });
  updateThemeLabel();

  // sidebar: lipat (desktop) / geser (HP)
  $('btnCollapse').addEventListener('click', () => {
    const c = document.documentElement.classList.toggle('sb-collapsed');
    try { localStorage.setItem('nfm-sidebar', c ? 'collapsed' : 'open'); } catch (e) { /* abaikan */ }
    setTimeout(() => map && map.invalidateSize(), 480);
  });
  $('btnMobileMenu').addEventListener('click', () => document.documentElement.classList.add('sb-open'));
  $('sbBackdrop').addEventListener('click', closeMobileMenu);
  document.querySelectorAll('.sb-nav a').forEach((a) => a.addEventListener('click', () => { if (isMobile()) closeMobileMenu(); }));
  // kalau sidebar terlipat, klik ikon cari = buka sidebar
  $('searchForm').addEventListener('click', () => {
    if (document.documentElement.classList.contains('sb-collapsed') && !isMobile()) {
      $('btnCollapse').click(); setTimeout(() => $('searchInput').focus(), 300);
    }
  });
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); doSearch($('searchInput').value); });
  $('searchInput').addEventListener('change', (e) => { if (e.target.value.includes('—') || S.alIndex && S.airlines.some((a) => a.airline_name === e.target.value)) doSearch(e.target.value); });

  // simulator
  let simRaf = null;
  ['shift', 'internal', 'buffer'].forEach((k) => $('s_' + k).addEventListener('input', (e) => {
    SIM[k] = +e.target.value;
    if (!simRaf) simRaf = requestAnimationFrame(() => { simRaf = null; renderSim(filterRows()); });
  }));
  $('costInput').value = COST.perMinute;
  $('costInput').addEventListener('change', (e) => {
    const v = Math.max(0, +String(e.target.value).replace(/[^0-9]/g, '') || 0);
    COST.perMinute = v; e.target.value = v;
    const rows = filterRows(); renderCostKPI(rows); renderSim(rows);
  });
  $('simReset').addEventListener('click', () => {
    Object.keys(SIM).forEach((k) => { SIM[k] = 0; $('s_' + k).value = 0; });
    renderSim(filterRows());
  });
  // FIDS & brief
  document.querySelectorAll('[data-action="fids"]').forEach((b) => b.addEventListener('click', () => { if (S.flights.length) { openFids(); closeMobileMenu(); } }));
  document.querySelectorAll('[data-action="brief"]').forEach((b) => b.addEventListener('click', () => { if (S.flights.length) { closeMobileMenu(); exportBrief(); } }));
  $('fidsClose').addEventListener('click', closeFids);
  $('fidsAirport').addEventListener('change', (e) => { FIDS.ap = e.target.value; FIDS.prev = {}; renderFids(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('fids').hidden) closeFids(); });

  const pick = () => $('fileInput').click();
  $('btnLoad').addEventListener('click', pick);
  $('btnOverlayLoad').addEventListener('click', pick);
  $('fileInput').addEventListener('change', async (e) => {
    try {
      const d = await readFiles(e.target.files);
      boot(d);
      if (S.flights.length) toast('Data berhasil dimuat ✓');
    } catch (err) { toast(err.message, true); }
    e.target.value = '';
  });
}

// menu aktif mengikuti posisi scroll + animasi muncul
// saat layar berputar / berubah ukuran melewati batas HP, susun ulang grafik
let _wasMobile = null;
window.addEventListener('resize', () => {
  const m = isMobile();
  if (_wasMobile !== null && m !== _wasMobile && S.flights.length) { renderAll({ skipMap: true }); map.invalidateSize(); }
  _wasMobile = m;
});
if (L.Browser && L.Browser.mobile) {
  // aktifkan geser peta dengan dua jari
  document.addEventListener('touchstart', (e) => { if (map && e.target.closest && e.target.closest('#map')) { if (e.touches.length > 1) map.dragging.enable(); else map.dragging.disable(); } }, { passive: true });
}

function initScrollFx() {
  if (!('IntersectionObserver' in window)) return;
  const links = [...document.querySelectorAll('.sb-link[data-sec]')];
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) links.forEach((l) => l.classList.toggle('active', l.dataset.sec === en.target.id));
    });
  }, { rootMargin: '-35% 0px -60% 0px' });
  links.forEach((l) => { const sec = document.getElementById(l.dataset.sec); if (sec) spy.observe(sec); });

  const items = document.querySelectorAll('.kpi, .card');
  const rev = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); rev.unobserve(en.target); } });
  }, { threshold: 0.08 });
  items.forEach((el) => { el.classList.add('reveal'); rev.observe(el); });
}

function startClock() {
  const tick = () => {
    const now = new Date();
    $('clock').textContent = now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
    $('clockMobile').textContent = now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }) + ' WIB';
  };
  tick(); setInterval(tick, 1000);
}

// Foto latar judul: 1) assets/hero.jpg milikmu, 2) foto Terminal 3 Soekarno-Hatta dari Unsplash
// (Edwin Petrus, Unsplash License), 3) ilustrasi bawaan jika keduanya gagal dimuat.
const HERO_PHOTOS = [
  { src: 'assets/hero.jpg', credit: '' },
  { src: 'https://images.unsplash.com/photo-1724568056925-ad2496c95fd9?auto=format&fit=crop&w=2400&h=1100&q=80',
    credit: 'Foto: Edwin Petrus / Unsplash — Terminal 3 Soekarno-Hatta', link: 'https://unsplash.com/photos/cKes3C-Xmjc' },
];
function loadHeroPhoto(i = 0) {
  const p = HERO_PHOTOS[i]; if (!p) return;
  const img = new Image();
  img.onload = () => {
    $('heroPhoto').style.backgroundImage = `url('${p.src}')`;
    document.querySelector('.hero').classList.add('has-photo');
    const c = $('heroCredit');
    if (c) { c.innerHTML = p.credit ? `<a href="${p.link}" target="_blank" rel="noopener">${esc(p.credit)}</a>` : ''; }
  };
  img.onerror = () => loadHeroPhoto(i + 1);
  img.src = p.src;
}

async function init() {
  loadHeroPhoto();
  startClock();
  bindUI();
  initMap();
  initScrollFx();
  try {
    boot(await loadFromServer());
  } catch (e) {
    console.warn('Gagal memuat CSV dari folder data/:', e);
    $('overlay').hidden = false;
    $('dataBadge').textContent = 'Data belum dimuat';
  }
}

document.addEventListener('DOMContentLoaded', init);
