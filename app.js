// Konfiguration
const API = 'https://opsigelsesformular.best-one.workers.dev'; // workerens adresse
const GOOGLE_CLIENT_ID = '733090718962-9dda64antqa8ki7j5q3de1nfrv7rod35.apps.googleusercontent.com'; // offentligt ID, ikke en hemmelighed
// Demo: kører med testdata og uden login, når siden åbnes lokalt eller med ?demo i adressen
const DEMO = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || new URLSearchParams(location.search).has('demo');

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = (s) => String(s || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').trim();
const dato = (ms) => (ms ? new Date(+ms).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' }) : null);
const kortDato = (ms) => new Date(+ms).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
// Sæsonen løber juli-juni. Sæson 2026 = 1. juli 2026 til 30. juni 2027.
const saeson = (ms) => { const d = new Date(+ms); return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; };
function saesonKlasse(udloeb) {
  if (!udloeb) return { klasse: '', titel: '' };
  const nu = saeson(Date.now()), forskel = saeson(udloeb) - nu;
  const navn = (s) => `${s}/${String(s + 1).slice(2)}`;
  if (forskel <= 0) return { klasse: 'denne', titel: `Udløber i indeværende sæson (${navn(nu)})` };
  if (forskel === 1) return { klasse: 'naeste', titel: `Udløber i næste sæson (${navn(nu + 1)})` };
  return { klasse: '', titel: `Udløber i sæson ${navn(saeson(udloeb))}` };
}
const kr = (v) => (v || v === 0 ? new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 }).format(+v) + ' kr.' : null);

let KUNDER = [];
// aftaler: kundens Genfak-opgaver. valgte: de aftaler der opsiges (én eller flere).
const S = { kunde: null, aftaler: null, valgte: [], stop: null, overdragelse: null };

// ---------- Generisk søgeliste ----------
function combo({ input, liste, hent, render, vaelg, tom, paaMarker }) {
  let fund = [], aktiv = 0, hoverTimer = null;
  function tegn() {
    fund = hent(input.value);
    aktiv = 0;
    liste.innerHTML = fund.length
      ? fund.map((x, i) => `<div class="valg" role="option" data-i="${i}" aria-selected="${i === 0}">${render(x)}</div>`).join('')
      : `<div class="tom">${tom ? tom(input.value) : 'Ingen resultater'}</div>`;
    liste.classList.add('aaben');
    input.setAttribute('aria-expanded', 'true');
    if (paaMarker && fund.length === 1) paaMarker(fund[0]); // kun ét match: hent i forvejen
  }
  function luk() { liste.classList.remove('aaben'); input.setAttribute('aria-expanded', 'false'); }
  function marker(i) {
    aktiv = Math.max(0, Math.min(fund.length - 1, i));
    liste.querySelectorAll('.valg').forEach((el, j) => el.setAttribute('aria-selected', j === aktiv));
    liste.querySelector(`[data-i="${aktiv}"]`)?.scrollIntoView({ block: 'nearest' });
    if (paaMarker && fund[aktiv]) paaMarker(fund[aktiv]);
  }
  input.addEventListener('input', tegn);
  input.addEventListener('focus', tegn);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); marker(aktiv + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marker(aktiv - 1); }
    else if (e.key === 'Enter' && fund[aktiv]) { e.preventDefault(); vaelg(fund[aktiv]); input.value = ''; luk(); }
    else if (e.key === 'Escape') luk();
  });
  // Musen over en kunde: hent i forvejen, når den har hvilet et øjeblik
  liste.addEventListener('mouseover', (e) => {
    const el = e.target.closest('.valg');
    clearTimeout(hoverTimer);
    if (el && paaMarker) hoverTimer = setTimeout(() => fund[+el.dataset.i] && paaMarker(fund[+el.dataset.i]), 150);
  });
  liste.addEventListener('mousedown', (e) => {
    e.preventDefault(); // behold fokus, så knapper i listen kan klikkes
    const el = e.target.closest('.valg');
    if (el) { vaelg(fund[+el.dataset.i]); input.value = ''; luk(); }
  });
  input.addEventListener('blur', () => setTimeout(luk, 120));
  return { luk, tegn };
}

// ---------- Kunde ----------
function soegKunder(q) {
  q = norm(q);
  if (!q) return KUNDER.slice(0, 8);
  const start = [], inde = [];
  for (const k of KUNDER) {
    const n = k.navn.toLowerCase();
    const d = k.domaene || '';
    if (n.startsWith(q) || d.startsWith(q)) start.push(k);
    else if (n.includes(q) || d.includes(q)) inde.push(k);
    if (start.length >= 8) break;
  }
  return [...start, ...inde].slice(0, 8);
}

const LUKKET = /nedluk|opsag|opsig|lukket/i;
const kundeCombo = combo({
  input: $('#kundeInput'), liste: $('#kundeListe'),
  hent: soegKunder,
  render: (k) => `<span><b>${esc(k.navn)}</b><br><span class="sub">${esc(k.domaene || 'Ingen hjemmeside på kundekortet')}</span></span>${LUKKET.test(k.status) ? `<span class="pille">${esc(k.status)}</span>` : ''}`,
  vaelg: vaelgKunde,
  paaMarker: (k) => hentAftaler(k.id),
  tom: () => `Ingen kunder matcher. <button type="button" data-handl="opdater">Opdatér listen</button>`,
});
$('#kundeListe').addEventListener('click', (e) => {
  if (e.target.closest('[data-handl="opdater"]')) hentKunder(true);
});

const IKON_UD = `<svg class="ikon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M9 2h5v5M14 2L7 9M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="sr">(åbner i ny fane)</span>`;

// Aftaler hentes i forvejen, når en kunde markeres i søgelisten, og huskes i 5 minutter.
// Samme kunde hentes aldrig to gange samtidig.
const AFTALE_CACHE = new Map();
function hentAftaler(id, frisk) {
  const hit = AFTALE_CACHE.get(id);
  if (!frisk && hit && Date.now() - hit.t < 5 * 60000) return hit.p;
  const p = api('/api/aftaler?kunde=' + encodeURIComponent(id));
  AFTALE_CACHE.set(id, { t: Date.now(), p });
  p.catch(() => AFTALE_CACHE.delete(id)); // en fejl skal ikke huskes
  return p;
}

async function vaelgKunde(k) {
  S.kunde = k; S.aftaler = null; S.valgte = [];
  $('#kundeSoeg').classList.add('skjult');
  const el = $('#kundeValgt');
  el.classList.remove('skjult');
  el.innerHTML = `<div class="kunde"><span><b>${esc(k.navn)}</b><span class="sub">${esc(k.domaene || 'Ingen hjemmeside på kundekortet')}</span></span>
    <span class="handl">${k.url ? `<a class="link" href="${esc(k.url)}" target="_blank" rel="noopener">Åbn i ClickUp ${IKON_UD}</a>` : ''}<button class="link" type="button" id="skiftKunde">Vælg ny kunde</button></span></div>
    ${LUKKET.test(k.status) ? `<p class="advarsel">Kunden har allerede status "${esc(k.status)}". Tjek at opsigelsen ikke er lavet før.</p>` : ''}`;
  $('#skiftKunde').onclick = nulstilKunde;
  $('#resten').classList.remove('skjult');
  tegnAftaler();
  try {
    const aftaler = await hentAftaler(k.id);
    if (S.kunde !== k) return; // brugeren har skiftet kunde imens
    S.aftaler = aftaler;
  } catch (e) {
    if (S.kunde !== k) return;
    S.aftaler = { fejl: visFejl(e) };
  }
  tegnAftaler();
}
function nulstilKunde() {
  S.kunde = null; S.aftaler = null; S.valgte = [];
  // Svarene hører til den forrige kunde, så de nulstilles
  ['#stop', '#overdragelse'].forEach((s) => document.querySelectorAll(`${s} button`).forEach((b) => b.setAttribute('aria-pressed', 'false')));
  S.stop = S.overdragelse = null;
  $('#kundeValgt').classList.add('skjult');
  $('#kundeSoeg').classList.remove('skjult');
  $('#resten').classList.add('skjult');
  $('#fejl').textContent = '';
  $('#kundeInput').focus();
  opdaterAfhaengige();
}

// ---------- Aftaler (Genfak-opgaver) ----------
const gyldigFarve = (f) => (/^#[0-9a-f]{3,6}$/i.test(f) ? f : '#e9e9e9');
function tekstfarve(hex) {
  const h = String(hex).replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#1c2733' : '#ffffff';
}

function tegnAftaler() {
  const rod = $('#aftaler');
  const a = S.aftaler;
  if (!a) { rod.innerHTML = `<p class="forhaand">Henter kundens aftaler…</p>`; opdaterAfhaengige(); return; }
  if (a.fejl) { rod.innerHTML = `<p class="forhaand advarsel-lys">Kunne ikke hente aftalerne. ${esc(a.fejl)}</p>`; opdaterAfhaengige(); return; }
  if (!a.length) {
    rod.innerHTML = `<p class="forhaand advarsel-lys">Kunden har ingen Genfak-aftaler i ClickUp, så der er ikke noget at opsige her. Tjek kundekortet.</p>`;
    opdaterAfhaengige(); return;
  }
  // Én linje pr. aftale, tidligste udløb først. Man kan vælge flere.
  // Allerede opsagte (🪦) står nederst og kan ikke vælges igen
  const sorteret = [...a].sort((x, y) => (Number(!!x.opsagt) - Number(!!y.opsagt)) || ((x.udloeb || Infinity) - (y.udloeb || Infinity)));
  const aktive = sorteret.filter((x) => !x.opsagt);
  if (!aktive.length) {
    rod.innerHTML = `<p class="forhaand advarsel-lys">Alle kundens aftaler er allerede opsagt (🪦).</p>`;
    opdaterAfhaengige(); return;
  }
  const alleValgt = S.valgte.length === aktive.length;
  rod.innerHTML = `${aktive.length > 1 ? `<button type="button" class="link vaelg-alle" id="vaelgAlle">${alleValgt ? 'Fravælg alle' : 'Vælg alle'}</button>` : ''}
  <div class="aftaleliste" role="group" aria-label="Kundens aftaler">${sorteret.map((x) => {
    const valgt = S.valgte.some((v) => v.id === x.id);
    const s = saesonKlasse(x.udloeb);
    return `<label class="aftalekort${valgt ? ' valgt' : ''}${x.opsagt ? ' opsagt' : ''}"${x.opsagt ? ' title="Allerede opsagt"' : ''}>
      <input type="checkbox" name="aftale" value="${esc(x.id)}"${valgt ? ' checked' : ''}${x.opsagt ? ' disabled' : ''}>
      <span class="produkter">${(x.produkter || []).map((p) => `<span class="produkt" data-farve="${gyldigFarve(p.farve)}">${esc(p.navn)}</span>`).join('') || `<b>${esc(x.navn)}</b>`}</span>
      ${x.opsagt ? '<span class="udloeb">🪦 Opsagt</span>' : `<span class="udloeb ${s.klasse}" title="${esc(s.titel)}">${x.udloeb ? esc(kortDato(x.udloeb)) : 'Ingen udløbsdato'}</span>`}
      <span class="vaerdi">${esc(kr(x.vaerdi) || '')}</span>
      ${x.url ? `<a class="link" href="${esc(x.url)}" target="_blank" rel="noopener" aria-label="Åbn aftalen i ClickUp">${IKON_UD}</a>` : '<span class="link"></span>'}
    </label>`;
  }).join('')}</div>`;
  rod.querySelectorAll('.produkt').forEach((el) => { el.style.background = el.dataset.farve; el.style.color = tekstfarve(el.dataset.farve); });
  rod.querySelectorAll('input[name=aftale]').forEach((cb) => cb.addEventListener('change', () => {
    // Behold listens rækkefølge (tidligste udløb først)
    const ider = new Set([...rod.querySelectorAll('input[name=aftale]:checked')].map((x) => x.value));
    S.valgte = sorteret.filter((x) => ider.has(x.id));
    cb.closest('.aftalekort').classList.toggle('valgt', cb.checked);
    const alle = $('#vaelgAlle');
    if (alle) alle.textContent = S.valgte.length === aktive.length ? 'Fravælg alle' : 'Vælg alle';
    opdaterAfhaengige();
  }));
  const alle = $('#vaelgAlle');
  if (alle) alle.onclick = () => { S.valgte = S.valgte.length === aktive.length ? [] : [...aktive]; tegnAftaler(); };
  opdaterAfhaengige();
}

// Felter der afhænger af de valgte aftaler
const erHosting = (navn) => /^hos\+?$|hosting/i.test(String(navn).trim()); // HOS og HOS+ (ikke H0S med nul)
const opsigerHosting = () => S.valgte.some((a) => (a.produkter || []).some((p) => erHosting(p.navn)));
const aftaleNavn = (a) => (a.produkter || []).map((p) => p.navn).join(', ') || a.navn;
function opdaterAfhaengige() {
  // "Skal de have tilsendt hjemmesiden?" giver kun mening, når hosting opsiges
  const vis = opsigerHosting();
  $('#overdragelseFelt').classList.toggle('skjult', !vis);
  if (!vis && S.overdragelse) {
    S.overdragelse = null;
    document.querySelectorAll('#overdragelse button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  }
  // Én aftale: vis dens udløbsdato på knappen. Flere: hver udløber på sin egen dato.
  const en = S.valgte.length === 1 && dato(S.valgte[0].udloeb);
  $('#stop [data-v="nu"]').textContent = S.valgte.length > 1 ? 'Nu (alle aftaler)' : 'Nu';
  $('#stop [data-v="udloeb"]').textContent = S.valgte.length > 1 ? 'Ved udløb (hver sin dato)' : en ? `Ved udløb af aftalen (${en})` : 'Ved udløb af aftalen';
  opdaterStopTekst();
}
// Nu = alle valgte aftaler stopper nu. Ved udløb = hver aftale stopper på sin egen udløbsdato.
function opdaterStopTekst() {
  const t = $('#stopTekst');
  if (!S.stop) { t.classList.add('skjult'); return; }
  const flere = S.valgte.length > 1;
  if (S.stop === 'nu') {
    t.textContent = flere ? `Alle ${S.valgte.length} aftaler stopper med det samme.` : 'Kunden stopper med det samme.';
  } else if (flere) {
    t.innerHTML = 'Hver aftale kører videre til sin egen udløbsdato:<br>' +
      S.valgte.map((a) => `${esc(aftaleNavn(a))}: ${a.udloeb ? esc(dato(a.udloeb)) : 'ingen udløbsdato'}`).join('<br>');
  } else {
    const d = S.valgte[0] && dato(S.valgte[0].udloeb);
    t.textContent = `Kunden kører videre til aftalens udløb${d ? ` den ${d}` : ''}.`;
  }
  t.classList.remove('skjult');
}

// ---------- Segmenter ----------
function segment(rod, onChange) {
  rod.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    rod.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    onChange(b.dataset.v);
  });
}
segment($('#stop'), (v) => { S.stop = v; opdaterStopTekst(); });
segment($('#overdragelse'), (v) => (S.overdragelse = v));

// ---------- Data ----------
// Kundelisten huskes i browseren, så søgningen er klar med det samme næste gang.
// Den friske liste hentes bagefter i baggrunden. Kun navn, domæne, status og link gemmes.
const KUNDE_LAGER = 'opsigelsesformular.kunder';
function gemteKunder() {
  try { const g = JSON.parse(localStorage.getItem(KUNDE_LAGER)); return Array.isArray(g?.liste) ? g.liste : null; } catch { return null; }
}
async function hentKunder(frisk) {
  const input = $('#kundeInput');
  const gemt = !frisk && gemteKunder();
  if (gemt && !KUNDER.length) { KUNDER = gemt; input.placeholder = `Søg blandt ${KUNDER.length} kunder`; }
  else if (!KUNDER.length || frisk) input.placeholder = 'Henter kunder…';
  try {
    const liste = await api('/api/kunder' + (frisk ? '?frisk=1' : ''));
    KUNDER = liste;
    input.placeholder = `Søg blandt ${KUNDER.length} kunder`;
    try { localStorage.setItem(KUNDE_LAGER, JSON.stringify({ tid: Date.now(), liste })); } catch {}
    // Opdatér en åben søgeliste med det samme
    if (frisk || (document.activeElement === input && $('#kundeListe').classList.contains('aaben'))) kundeCombo.tegn();
  } catch (e) {
    if (!KUNDER.length) input.placeholder = 'Kunne ikke hente kunder. Genindlæs siden.' + (e.kode ? ` (Fejlkode: ${e.kode})` : '');
  }
}
function start() { hentKunder(false); }

// ---------- Opsig ----------

$('#opsig').addEventListener('click', async () => {
  const fejl = $('#fejl'); fejl.textContent = '';
  const tjek = [
    [!S.kunde, 'Vælg kunden.'],
    [!S.valgte.length, 'Vælg hvilke aftaler der opsiges.'],
    [!S.stop, 'Vælg hvornår kunden stopper.'],
    [opsigerHosting() && !S.overdragelse, 'Vælg om kunden skal have tilsendt hjemmesiden.'],
  ].find(([b]) => b);
  if (tjek) { fejl.textContent = tjek[1]; return; }

  const knap = $('#opsig'); knap.disabled = true; knap.textContent = 'Opsiger…';
  const data = {
    kundeId: S.kunde.id,
    aftaleIder: S.valgte.map((a) => a.id),
    stop: S.stop, // 'nu' eller 'udloeb'
    // null = hosting opsiges ikke, så spørgsmålet er ikke stillet
    tilsendHjemmeside: opsigerHosting() ? S.overdragelse === 'ja' : null,
  };
  try {
    const d = await api('/api/opsig', { method: 'POST', body: JSON.stringify(data) });
    AFTALE_CACHE.delete(data.kundeId); // kundens aftaler kan have ændret sig
    visKvittering(d, data);
  } catch (e) {
    const brugerfejl = ['OF-400', 'OF-401', 'OF-402'].includes(e.kode);
    fejl.textContent = visFejl(e) + (brugerfejl ? '' : ' Prøv igen, eller giv besked med fejlkoden, hvis det fortsætter.');
  } finally {
    knap.disabled = false; knap.textContent = 'Opsig';
  }
});

function visKvittering(d, data) {
  const k = $('#kvittering');
  k.innerHTML = `
    ${$('.logo').outerHTML}
    <h1>Opsigelsen er registreret</h1>
    <ul class="fakta">
      <li><b>Kunde:</b> ${esc(S.kunde.navn)}</li>
      ${S.valgte.map((a) => `<li><b>${esc(aftaleNavn(a))}:</b> stopper ${data.stop === 'nu' ? 'nu' : a.udloeb ? `ved udløb ${esc(dato(a.udloeb))}` : 'ved udløb (ingen dato i ClickUp)'}</li>`).join('')}
      ${data.tilsendHjemmeside === null ? '' : `<li><b>Tilsend hjemmesiden:</b> ${data.tilsendHjemmeside ? 'Ja' : 'Nej'}</li>`}
    </ul>
    ${!d.demo && Array.isArray(d.tagFejl) ? `<p class="forhaand">${d.antal === 1 ? 'Aftalen er' : 'Aftalerne er'} markeret med 🪦 i ClickUp${'mailFejl' in d && !d.mailFejl ? ', bogholderiet har fået en mail,' : ''} og der er skrevet en kommentar på kunden.</p>` : ''}
    ${d.mailFejl ? `<p class="obs">Mailen til bogholderiet kunne ikke sendes. Giv dem besked selv. (Fejlkode: ${esc(d.mailFejl)})</p>` : ''}
    ${!d.demo && !Array.isArray(d.tagFejl) ? `<p class="forhaand">Opsigelsen er skrevet som en kommentar på kunden.</p>` : ''}
    ${(d.tagFejl || []).length ? `<p class="obs">Disse aftaler fik ikke 🪦 og skal markeres i hånden: ${d.tagFejl.map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.navn)}</a>`).join(', ')}. (Fejlkode: OF-306)</p>` : ''}
    ${d.kommentarFejl ? `<p class="obs">Kommentaren på kunden kunne ikke skrives, men aftalerne er markeret. (Fejlkode: ${esc(d.kommentarFejl)})</p>` : ''}
    <div class="knapper">
      ${S.kunde.url ? `<a href="${esc(S.kunde.url)}" target="_blank" rel="noopener">Åbn kunden i ClickUp<span class="sr"> (åbner i ny fane)</span></a>` : ''}
      ${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">Åbn opsigelsen i ClickUp<span class="sr"> (åbner i ny fane)</span></a>` : ''}
    </div>
    ${d.demo ? `<p class="obs">Demo: intet er sendt til ClickUp.</p>` : ''}
    <button class="link ny-sag" type="button" id="nyOpsigelse">Opret en ny opsigelse</button>`;
  $('#formular').classList.add('skjult'); k.classList.remove('skjult');
  $('#nyOpsigelse').onclick = nulstilAlt;
  window.scrollTo(0, 0);
}

function nulstilAlt() {
  nulstilKunde();
  $('#kvittering').classList.add('skjult'); $('#formular').classList.remove('skjult');
}

// ---------- Baggrundsvideo (samme som supportformularen) ----------
(function () {
  const v = $('#bgVideo');
  const spar = navigator.connection && navigator.connection.saveData;
  const rolig = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!v || spar || rolig) { v && v.remove(); return; }
  const fjern = () => { v.remove(); document.body.classList.remove('har-video'); };
  v.addEventListener('error', fjern, true);
  v.querySelectorAll('source').forEach((src) => src.addEventListener('error', fjern));
  // Blåt slør først, når videoen faktisk kører
  v.addEventListener('playing', () => document.body.classList.add('har-video'), { once: true });
  // Videoen hentes først, når resten af siden er klar, så den ikke forsinker formularen
  const startVideo = () => { v.preload = 'auto'; v.load(); v.play().catch(() => {}); };
  document.readyState === 'complete' ? startVideo() : window.addEventListener('load', startVideo, { once: true });
  // Pause når fanen ikke er synlig, så den ikke bruger strøm i baggrunden
  document.addEventListener('visibilitychange', () => (document.hidden ? v.pause() : v.play().catch(() => {})));
})();

// ---------- Login og API ----------
const SESSION_KEY = 'opsigelsesformular.session';
let startet = false, googleKlar = false;

function session() {
  if (DEMO) return { navn: 'Demo Bruger', token: 'demo', exp: Infinity };
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    return s && s.exp > Date.now() / 1000 + 60 ? s : null;
  } catch { return null; }
}

function fejlMedKode(tekst, kode) { const e = new Error(tekst); e.kode = kode; return e; }
const visFejl = (e) => (e.kode ? `${e.message} (Fejlkode: ${e.kode})` : e.message);

async function hent(sti, opts) {
  let r;
  try { r = await fetch(API + sti, opts); }
  catch { throw fejlMedKode('Kan ikke få forbindelse til formularens server.', 'OF-501'); }
  let d;
  try { d = await r.json(); }
  catch { throw fejlMedKode('Serveren svarede uventet.', 'OF-502'); }
  if (!r.ok) { const e = fejlMedKode(d.fejl || 'Noget gik galt.', d.kode || 'OF-900'); e.status = r.status; throw e; }
  return d;
}

async function api(sti, opts = {}) {
  if (DEMO) return demoApi(sti, opts);
  const s = session();
  if (!s) { visLogin(); throw fejlMedKode('Du er logget ud. Log ind igen.', 'OF-105'); }
  try {
    return await hent(sti, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.token } });
  } catch (e) {
    if (e.status === 401) { localStorage.removeItem(SESSION_KEY); visLogin(); }
    throw e;
  }
}

function visFormular() {
  const s = session();
  const initialer = s.navn.split(/\s+/).map((d) => d[0]).slice(0, 2).join('').toUpperCase();
  $('#brugerNavn').innerHTML = `<span class="avatar mig">${s.billede ? `<img src="${esc(s.billede)}" alt="" referrerpolicy="no-referrer">` : esc(initialer)}</span>Logget ind som ${esc(s.navn)}${DEMO ? ' <span class="pille demo">Demo</span>' : ''}`;
  const img = $('#brugerNavn img');
  if (img) img.onerror = () => { img.parentElement.textContent = initialer; };
  $('#login').classList.add('skjult');
  $('#kvittering').classList.add('skjult');
  $('#formular').classList.remove('skjult');
  if (!startet) { startet = true; start(); }
}

function visLogin() {
  $('#formular').classList.add('skjult');
  $('#kvittering').classList.add('skjult');
  $('#login').classList.remove('skjult');
  if (googleKlar) initGoogle();
}

function initGoogle() {
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogle, auto_select: true, hd: 'best-one.dk', use_fedcm_for_prompt: true });
  google.accounts.id.renderButton($('#gBtn'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'da' });
  google.accounts.id.prompt();
}

async function onGoogle(svar) {
  $('#loginFejl').textContent = '';
  try {
    const d = await hent('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: svar.credential }) });
    localStorage.setItem(SESSION_KEY, JSON.stringify(d));
    visFormular();
  } catch (e) {
    $('#loginFejl').textContent = visFejl(e);
  }
}

$('#logud').onclick = () => {
  if (DEMO) return;
  try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(KUNDE_LAGER); } catch {}
  if (googleKlar) google.accounts.id.disableAutoSelect();
  visLogin();
};

if (DEMO) {
  $('#logud').classList.add('skjult');
} else {
  const googleFejl = () => {
    if (googleKlar || session()) return;
    $('#loginFejl').textContent = 'Google-login kunne ikke indlæses. Tjek din internetforbindelse eller adblocker. (Fejlkode: OF-503)';
  };
  setTimeout(googleFejl, 10000);
  const gsi = document.createElement('script');
  gsi.src = 'https://accounts.google.com/gsi/client';
  gsi.async = true;
  gsi.onerror = googleFejl;
  document.head.append(gsi);
  window.onGoogleLibraryLoad = () => { googleKlar = true; if (!session()) initGoogle(); };
}

// ---------- Demo-data ----------
// Bruges kun i demo, med opdigtede kunder. Formen svarer til det, workeren skal levere fra ClickUp.
async function demoApi(sti) {
  await new Promise((r) => setTimeout(r, 250));
  const om = (mdr) => Date.now() + mdr * 30 * 864e5;
  if (sti.startsWith('/api/kunder')) return [
    { id: 'demo1', navn: 'Testkunde ApS', domaene: 'testkunde.dk', status: 'blue', url: 'https://app.clickup.com/t/demo1' },
    { id: 'demo2', navn: 'Tømrer Eksempel', domaene: 'toemrer-eksempel.dk', status: 'blue', url: '' },
    { id: 'demo3', navn: 'Klinik Eksempel', domaene: 'klinik-eksempel.dk', status: 'opsagt', url: '' },
  ];
  if (sti.startsWith('/api/aftaler')) {
    const kunde = new URLSearchParams(sti.split('?')[1]).get('kunde');
    if (kunde !== 'demo1') return [];
    return [
      { id: 'g1', navn: 'Genfak SEO', produkter: [{ navn: 'SEO', farve: '#225581' }], vaerdi: 18000, udloeb: om(22), url: '' },
      { id: 'g2', navn: 'Genfak GA, G-RE', produkter: [{ navn: 'GA', farve: '#2b6aa1' }, { navn: 'G-RE', farve: '#8d8d8d' }], vaerdi: 29000, udloeb: om(9), url: '' },
      { id: 'g3', navn: 'Genfak HOS', produkter: [{ navn: 'HOS', farve: '#6647f0' }], vaerdi: 5000, udloeb: om(4), url: '' },
      { id: 'g4', navn: 'Genfak META', produkter: [{ navn: 'META', farve: '#3e63dd' }], vaerdi: 12000, udloeb: om(2), opsagt: true, url: '' },
    ];
  }
  if (sti === '/api/opsig') return { demo: true, ok: true, antal: S.valgte.length, tagFejl: [], mailFejl: null, kommentarFejl: null };
  throw fejlMedKode('Ukendt adresse i demo.', 'OF-404');
}

session() ? visFormular() : visLogin();
