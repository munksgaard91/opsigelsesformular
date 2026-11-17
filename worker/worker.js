// Cloudflare Worker til opsigelsesformularen (opsigelse.leksione.dk)
//
// Hemmeligheder (sættes i Cloudflare under Settings > Variables and Secrets, aldrig i koden):
//   CLICKUP_TOKEN   ClickUp API-token (pk_...)
//   SESSION_SECRET  lang tilfældig tekst, bruges til at signere login-sessioner
//
// Kald: se README.md i repoet.

const TILLADT_ORIGIN = 'https://opsigelse.leksione.dk';
const GOOGLE_CLIENT_ID = '733090718962-9dda64antqa8ki7j5q3de1nfrv7rod35.apps.googleusercontent.com';
const DOMAENE = 'best-one.dk';
const SESSION_DAGE = 30;

// ClickUp
const CU = 'https://api.clickup.com/api/v2';
const LISTE_KUNDER = '900800029468';
const TYPE_GENFAK = 1008; // opgavetypen "Genfak" (custom_item_id)
const FELT = {
  hjemmeside: 'd8f36f07-cf17-48dd-aab6-bb6974a7cbcc',
  produkter: 'a98fb65b-50a1-4dad-a5e1-b36bbd6615ce',
  vaerdi: '6d274cc8-c678-49b2-a864-e221207dde01',
  deadline: '28760aed-67b8-433d-8151-f240378e3193', // bruges som aftalens udløb
};
const KUNDE_CACHE_SEK = 600;

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    try {
      const url = new URL(req.url);
      const sti = url.pathname;
      if (sti === '/api/login' && req.method === 'POST') return svar(await login(req, env));

      const bruger = await tjekSession(req, env);
      if (sti === '/api/kunder' && req.method === 'GET') return svar(await kunder(env, ctx, url.searchParams.has('frisk')));
      if (sti === '/api/aftaler' && req.method === 'GET') return svar(await aftaler(env, url.searchParams.get('kunde')));
      if (sti === '/api/opsig' && req.method === 'POST') return svar(await opsig(env, bruger, await req.json().catch(() => ({}))));
      throw fejl(404, 'Ukendt adresse.', 'OF-404');
    } catch (e) {
      if (!e.status) console.error(e);
      return svar({ fejl: e.status ? e.message : 'Der skete en fejl på serveren.', kode: e.kode || 'OF-900' }, e.status || 500);
    }
  },
};

// ---------- Hjælpere ----------
function cors() {
  return {
    'Access-Control-Allow-Origin': TILLADT_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function svar(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors() } });
}
function fejl(status, tekst, kode) { const e = new Error(tekst); e.status = status; e.kode = kode; return e; }

async function clickup(env, sti, opts = {}) {
  if (!env.CLICKUP_TOKEN) throw fejl(500, 'Workeren mangler ClickUp-nøglen.', 'OF-701');
  const r = await fetch(CU + sti, { ...opts, headers: { Authorization: env.CLICKUP_TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) {
    console.error('ClickUp', r.status, sti, await r.text().catch(() => ''));
    if (r.status === 404) throw fejl(404, 'Opgaven findes ikke i ClickUp.', 'OF-704');
    throw fejl(502, 'ClickUp svarede med en fejl.', 'OF-702');
  }
  return r.json();
}
const felt = (task, id) => (task.custom_fields || []).find((f) => f.id === id);

// ---------- Login ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tekstTilB64url = (s) => b64url(new TextEncoder().encode(s));
const b64urlTilTekst = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

async function hmac(env, data) {
  if (!env.SESSION_SECRET) throw fejl(500, 'Workeren mangler SESSION_SECRET.', 'OF-703');
  const noegle = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', noegle, new TextEncoder().encode(data)));
}

async function login(req, env) {
  const { credential } = await req.json().catch(() => ({}));
  if (!credential) throw fejl(400, 'Login mangler.', 'OF-101');
  // Google tjekker selv signaturen på tokenet; vi tjekker hvem det er udstedt til og til hvilket domæne
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) throw fejl(401, 'Google kunne ikke bekræfte dit login. Prøv igen.', 'OF-102');
  const g = await r.json();
  if (g.aud !== GOOGLE_CLIENT_ID) throw fejl(401, 'Login er udstedt til en anden app.', 'OF-103');
  if (g.hd !== DOMAENE || String(g.email_verified) !== 'true' || !String(g.email).toLowerCase().endsWith('@' + DOMAENE)) {
    throw fejl(403, `Kun ${DOMAENE}-konti har adgang.`, 'OF-104');
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAGE * 86400;
  const data = tekstTilB64url(JSON.stringify({ email: g.email, navn: g.name || g.email, exp }));
  return { token: data + '.' + (await hmac(env, data)), navn: g.name || g.email, billede: g.picture || null, exp };
}

async function tjekSession(req, env) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const [data, sig] = t.split('.');
  if (!data || !sig || sig !== (await hmac(env, data))) throw fejl(401, 'Du er logget ud. Log ind igen.', 'OF-105');
  let s;
  try { s = JSON.parse(b64urlTilTekst(data)); } catch { throw fejl(401, 'Du er logget ud. Log ind igen.', 'OF-105'); }
  if (!s.exp || s.exp < Date.now() / 1000) throw fejl(401, 'Dit login er udløbet. Log ind igen.', 'OF-106');
  return s;
}

// ---------- Kunder ----------
async function kunder(env, ctx, frisk) {
  const cache = caches.default;
  const noegle = new Request('https://cache.opsigelse.internal/kunder');
  if (!frisk) {
    const hit = await cache.match(noegle);
    if (hit) return hit.json();
  }
  const ud = [];
  for (let side = 0; side < 100; side++) {
    const d = await clickup(env, `/list/${LISTE_KUNDER}/task?page=${side}&subtasks=false&include_closed=true&archived=false`);
    for (const t of d.tasks || []) {
      if (t.parent) continue;
      const hj = felt(t, FELT.hjemmeside)?.value || '';
      ud.push({
        id: t.id,
        navn: t.name,
        domaene: String(hj).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''),
        status: t.status?.status || '',
        url: t.url,
      });
    }
    if (d.last_page || !(d.tasks || []).length) break;
  }
  ud.sort((a, b) => a.navn.localeCompare(b.navn, 'da'));
  ctx.waitUntil(cache.put(noegle, new Response(JSON.stringify(ud), { headers: { 'Cache-Control': `max-age=${KUNDE_CACHE_SEK}` } })));
  return ud;
}

// ---------- Aftaler (kundens Genfak-underopgaver) ----------
function tilAftale(t) {
  const pf = felt(t, FELT.produkter);
  const valg = pf?.type_config?.options || [];
  const produkter = (Array.isArray(pf?.value) ? pf.value : []).map((v) => {
    const id = typeof v === 'object' ? v.id : v;
    const o = valg.find((x) => x.id === id);
    return { navn: o?.label || o?.name || (typeof v === 'object' ? v.label : '') || '?', farve: o?.color || null };
  });
  const vaerdi = felt(t, FELT.vaerdi)?.value;
  const deadline = felt(t, FELT.deadline)?.value;
  return { id: t.id, navn: t.name, produkter, vaerdi: vaerdi != null && vaerdi !== '' ? +vaerdi : null, udloeb: deadline ? +deadline : null, url: t.url };
}

async function genfakOpgaver(env, kundeId) {
  const kunde = await clickup(env, `/task/${encodeURIComponent(kundeId)}?include_subtasks=true`);
  const ids = (kunde.subtasks || [])
    .filter((s) => s.custom_item_id === TYPE_GENFAK && s.status?.type !== 'closed')
    .map((s) => s.id);
  const opgaver = await Promise.all(ids.map((id) => clickup(env, `/task/${id}`)));
  return { kunde, opgaver };
}

async function aftaler(env, kundeId) {
  if (!kundeId) throw fejl(400, 'Kunden mangler.', 'OF-201');
  const { opgaver } = await genfakOpgaver(env, kundeId);
  return opgaver.map(tilAftale).sort((a, b) => (a.udloeb || Infinity) - (b.udloeb || Infinity));
}

// ---------- Opsig ----------
// Indtil automatiseringerne er besluttet, skrives opsigelsen kun som en kommentar på kundeopgaven.
async function opsig(env, bruger, d) {
  const varighed = Number(d.varighed);
  if (!d.kundeId || !d.aftaleId) throw fejl(400, 'Kunde eller aftale mangler.', 'OF-400');
  if (![1, 2, 3, 4, 5].includes(varighed)) throw fejl(400, 'Ugyldig varighed.', 'OF-400');
  if (!['nu', 'udloeb'].includes(d.stop)) throw fejl(400, 'Ugyldigt stoptidspunkt.', 'OF-400');

  // Aftalen skal høre til kunden
  const { kunde, opgaver } = await genfakOpgaver(env, d.kundeId);
  const opgave = opgaver.find((o) => o.id === d.aftaleId);
  if (!opgave) throw fejl(400, 'Aftalen hører ikke til kunden. Genindlæs siden.', 'OF-401');
  const aftale = tilAftale(opgave);
  const hosting = aftale.produkter.some((p) => /^hos\+?$|hosting/i.test(p.navn.trim()));
  if (hosting && typeof d.tilsendHjemmeside !== 'boolean') throw fejl(400, 'Svar på om kunden skal have tilsendt hjemmesiden.', 'OF-400');

  const dato = (ms) => new Date(ms).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Copenhagen' });
  const linjer = [
    `🔴 Opsigelse registreret af ${bruger.navn}`,
    `Aftale: ${aftale.produkter.map((p) => p.navn).join(', ') || aftale.navn} (${aftale.url})`,
    `Aftalens varighed: ${varighed} år`,
    `Stopper: ${d.stop === 'nu' ? 'Nu' : `Ved udløb af aftalen${aftale.udloeb ? ` (${dato(aftale.udloeb)})` : ''}`}`,
  ];
  if (hosting) linjer.push(`Tilsend hjemmesiden: ${d.tilsendHjemmeside ? 'Ja' : 'Nej'}`);
  await clickup(env, `/task/${kunde.id}/comment`, { method: 'POST', body: JSON.stringify({ comment_text: linjer.join('\n'), notify_all: false }) });
  return { ok: true };
}
