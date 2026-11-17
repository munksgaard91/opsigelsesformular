// Opsigelsesformular: motoren bag opsigelse.leksione.dk for Best One A/S
// Formularen ligger på GitHub Pages. Denne worker:
//   1. tjekker Google-login (kun @best-one.dk) og udsteder en session på 30 dage
//   2. henter kunder (fra supportformularens KV) og kundens Genfak-aftaler fra ClickUp
//   3. registrerer opsigelsen (indtil videre kun som kommentar på kundeopgaven)
//
// Secrets i Cloudflare: CLICKUP_TOKEN, SESSION_SECRET
// KV-binding: KUNDER_KV = SAMME navnerum som supportformularen. Supportens cron
//   opdaterer kundelisten hver time, så denne worker behøver ingen cron.
// Bygget efter samme mønster som supportformularens worker.

const CFG = {
  ORIGIN: 'https://opsigelse.leksione.dk',
  GOOGLE_CLIENT_ID: '733090718962-9dda64antqa8ki7j5q3de1nfrv7rod35.apps.googleusercontent.com',
  DOMAENE: 'best-one.dk',
  SESSION_DAGE: 30,
  KUNDER_LIST: '900800029468',
  KV_KUNDER: 'kunder-v2',       // supportformularens nøgle (læses kun, skrives aldrig herfra)
  GENFAK_TYPE_ID: 1008,         // opgavetypen "Genfak" = én aftale
  TAG_OPSAGT: '🪦',             // findes i forvejen i ClickUp; sættes på opsagte Genfak-opgaver ved siden af "udløber xx/yy"
  CACHE_MINUTTER: 10,
  CLICKUP_URL: 'https://bestcrm.clickup.com',
  F: {
    hjemmeside: 'd8f36f07-cf17-48dd-aab6-bb6974a7cbcc',
    produkter: 'a98fb65b-50a1-4dad-a5e1-b36bbd6615ce',
    vaerdi: '6d274cc8-c678-49b2-a864-e221207dde01',
    deadline: '28760aed-67b8-433d-8151-f240378e3193', // aftalens udløb
  },
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (req.method === 'OPTIONS') return svar(null, 204);

      if (url.pathname === '/api/login' && req.method === 'POST') {
        const { credential } = await req.json().catch(() => ({}));
        return svar(await login(env, credential), 200);
      }

      // Alt herunder kræver en gyldig session
      const bruger = await tjekSession(env, req);
      if (!bruger) return svar({ fejl: 'Du er logget ud. Log ind igen.', kode: 'OF-105' }, 401);

      if (url.pathname === '/api/kunder' && req.method === 'GET') {
        return svar(await medKode('OF-201', 'Kunderne kunne ikke hentes.', () => kunder(env, url.searchParams.has('frisk'))), 200);
      }
      if (url.pathname === '/api/aftaler' && req.method === 'GET') {
        return svar(await medKode('OF-202', 'Aftalerne kunne ikke hentes.', () => aftaler(env, url.searchParams.get('kunde'))), 200);
      }
      if (url.pathname === '/api/opsig' && req.method === 'POST') {
        return svar(await opsig(env, bruger, await req.json().catch(() => ({}))), 200);
      }
      return svar({ fejl: 'Siden findes ikke', kode: 'OF-901' }, 404);
    } catch (e) {
      const kode = e.kode || 'OF-900';
      console.error(kode, url.pathname, e.detalje || '', e.message);
      return svar({ fejl: e.status && e.status < 500 ? e.message : (e.kode ? e.message : 'Der skete en uventet fejl.'), kode }, e.status || 500);
    }
  },
};

// Giver fejl ved hentning en egen kode, men bevarer de mere præcise ClickUp-koder (OF-3xx)
async function medKode(kode, tekst, fn) {
  try { return await fn(); } catch (e) {
    if (e.kode && (e.kode.startsWith('OF-3') || e.kode === 'OF-400')) throw e;
    throw fejl(tekst, 502, kode, e.detalje || e.message);
  }
}

// ---------- Login (samme metode som supportformularen) ----------

const b64url = {
  til: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  fra: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
  tekst: (s) => new TextDecoder().decode(b64url.fra(s)),
};

function fejl(msg, status, kode, detalje) {
  const e = new Error(msg);
  e.status = status;
  e.kode = kode;
  e.detalje = detalje;
  return e;
}

let JWKS = { t: 0, keys: [] };
async function googleNoegler(tving) {
  if (!tving && Date.now() - JWKS.t < 3600000 && JWKS.keys.length) return JWKS.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  JWKS = { t: Date.now(), keys: (await r.json()).keys };
  return JWKS.keys;
}

// Tjekker Googles ID-token: signatur, udsteder, app, udløb og domæne
async function login(env, credential) {
  if (!credential) throw fejl('Mangler login fra Google.', 400, 'OF-101');
  const [h, p, sig] = String(credential).split('.');
  let header, data;
  try { header = JSON.parse(b64url.tekst(h)); data = JSON.parse(b64url.tekst(p)); }
  catch { throw fejl('Ugyldigt login.', 401, 'OF-102', 'Kunne ikke læse login fra Google'); }

  let jwk = (await googleNoegler()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleNoegler(true)).find((k) => k.kid === header.kid); // Google har skiftet nøgle
  if (!jwk || header.alg !== 'RS256') throw fejl('Ugyldigt login.', 401, 'OF-102', 'Ukendt nøgle eller algoritme');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url.fra(sig), new TextEncoder().encode(`${h}.${p}`));

  const nu = Math.floor(Date.now() / 1000);
  if (!ok) throw fejl('Ugyldigt login.', 401, 'OF-102', 'Signatur passer ikke');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(data.iss)) throw fejl('Ugyldigt login.', 401, 'OF-102', 'Forkert udsteder');
  if (data.aud !== CFG.GOOGLE_CLIENT_ID) throw fejl('Login er ikke sat rigtigt op.', 500, 'OF-107', `Client ID passer ikke: ${data.aud}`);
  if (data.exp < nu) throw fejl('Login er udløbet. Prøv igen.', 401, 'OF-104');
  if (data.hd !== CFG.DOMAENE || !data.email_verified) throw fejl(`Log ind med din @${CFG.DOMAENE}-konto.`, 403, 'OF-103', data.email);

  const session = { email: data.email, navn: data.name || data.email, exp: nu + CFG.SESSION_DAGE * 86400 };
  return { token: await signer(env, session), ...session, billede: data.picture || null };
}

async function hmacNoegle(env) {
  if (!env.SESSION_SECRET) throw fejl('Formularen er ikke sat rigtigt op.', 500, 'OF-106', 'SESSION_SECRET mangler');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signer(env, data) {
  const p = b64url.til(new TextEncoder().encode(JSON.stringify(data)));
  const sig = await crypto.subtle.sign('HMAC', await hmacNoegle(env), new TextEncoder().encode(p));
  return `${p}.${b64url.til(sig)}`;
}

async function tjekSession(env, req) {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer (.+)\.(.+)$/);
  if (!m) return null;
  const noegle = await hmacNoegle(env); // mangler SESSION_SECRET, skal det vises som en opsætningsfejl
  try {
    const ok = await crypto.subtle.verify('HMAC', noegle, b64url.fra(m[2]), new TextEncoder().encode(m[1]));
    if (!ok) return null;
    const data = JSON.parse(b64url.tekst(m[1]));
    return data.exp > Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
}

// ---------- Hjælpere ----------

function svar(data, status) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': CFG.ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      Vary: 'Origin',
    },
  });
}

async function cu(env, path, opts = {}) {
  if (!env.CLICKUP_TOKEN) throw fejl('Formularen er ikke sat rigtigt op.', 500, 'OF-301', 'CLICKUP_TOKEN mangler');
  const res = await fetch('https://api.clickup.com/api/v2' + path, {
    ...opts,
    headers: { Authorization: env.CLICKUP_TOKEN, 'Content-Type': 'application/json' },
  });
  const tekst = await res.text();
  let data;
  try { data = JSON.parse(tekst); } catch { data = tekst; }
  if (!res.ok) {
    const msg = typeof data === 'string' ? data : `${data.err || ''} ${data.ECODE || ''}`.trim() || JSON.stringify(data);
    const detalje = `ClickUp ${res.status} ${path.split('?')[0]}: ${msg}`;
    const ecode = (data && data.ECODE) || '';
    if (res.status === 401 && /OAUTH_01[789]|OAUTH_025|token/i.test(ecode + msg)) throw fejl('Formularen kan ikke logge ind i ClickUp.', 502, 'OF-301', detalje);
    if (res.status === 401 || res.status === 403 || res.status === 404) throw fejl('Formularen har ikke adgang til opgaven i ClickUp.', 502, 'OF-302', detalje);
    if (res.status === 429) throw fejl('ClickUp har for travlt lige nu. Prøv igen om et minut.', 503, 'OF-304', detalje);
    if (res.status >= 500) throw fejl('ClickUp svarer ikke lige nu. Prøv igen om lidt.', 503, 'OF-305', detalje);
    throw fejl('ClickUp afviste opsigelsen.', 502, 'OF-303', detalje);
  }
  return data;
}

// Skifter app.clickup.com ud med jeres eget domæne
const cuLink = (u) => String(u || '').replace(/^https:\/\/app\.clickup\.com/, CFG.CLICKUP_URL);

function felt(task, id) {
  const f = (task.custom_fields || []).find((x) => x.id === id);
  return f && f.value !== undefined ? f.value : null;
}

function domaene(u) {
  if (!u) return '';
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[\/?#]/)[0];
  try { s = new URL('https://' + s).hostname.replace(/^www\./, ''); } catch {}
  return s;
}

// ---------- Kunder ----------
// Læses fra supportformularens KV (opdateres hver time af dens cron). Kun de felter,
// formularen bruger, sendes videre. Findes listen ikke dér, hentes den selv fra ClickUp.

const MEM = {};
const kort = (k) => ({ id: k.id, navn: k.navn, domaene: k.domaene || '', status: k.status || '', url: cuLink(k.url) });

async function kunder(env, frisk) {
  const hit = MEM.kunder;
  if (!frisk && hit && Date.now() - hit.t < CFG.CACHE_MINUTTER * 60000) return hit.data;
  if (!frisk && env.KUNDER_KV) {
    const gemt = await env.KUNDER_KV.get(CFG.KV_KUNDER, 'json');
    if (Array.isArray(gemt) && gemt.length) {
      const data = gemt.map(kort);
      MEM.kunder = { t: Date.now(), data };
      return data;
    }
  }
  return hentKunderSelv(env);
}

// Kun én hentning ad gangen: kommer der flere forespørgsler samtidig, venter de på den samme
let iGang = null;
async function hentKunderSelv(env) {
  if (iGang) return iGang;
  iGang = (async () => {
    const SAMTIDIGE = 6;
    const ud = [];
    let side = 0, faerdig = false;
    while (!faerdig && side < 60) {
      const sider = Array.from({ length: SAMTIDIGE }, (_, i) => side + i);
      const svar = await Promise.all(sider.map((p) =>
        cu(env, `/list/${CFG.KUNDER_LIST}/task?page=${p}&subtasks=false&include_closed=true&archived=false`)));
      for (const d of svar) {
        const tasks = d.tasks || [];
        for (const t of tasks) {
          const hj = felt(t, CFG.F.hjemmeside) || '';
          ud.push({ id: t.id, navn: t.name, domaene: domaene(hj), status: (t.status && t.status.status) || '', url: cuLink(t.url) });
        }
        if (d.last_page || tasks.length === 0) { faerdig = true; break; }
      }
      side += SAMTIDIGE;
    }
    ud.sort((a, b) => a.navn.localeCompare(b.navn, 'da'));
    MEM.kunder = { t: Date.now(), data: ud };
    return ud;
  })();
  try { return await iGang; } finally { iGang = null; }
}

// ---------- Aftaler (kundens Genfak-underopgaver) ----------

// Produktvalgene (navn og farve) hentes én gang fra Kunder-listens felt, hvis opgaven ikke selv har dem
let PRODUKT_OPTS = [];
async function produktValg(env) {
  if (PRODUKT_OPTS.length) return PRODUKT_OPTS;
  try {
    const felter = await cu(env, `/list/${CFG.KUNDER_LIST}/field`);
    const pf = (felter.fields || []).find((f) => f.id === CFG.F.produkter);
    if (pf && pf.type_config && pf.type_config.options) PRODUKT_OPTS = pf.type_config.options;
  } catch {}
  return PRODUKT_OPTS;
}

function produkter(t, reserve) {
  const f = (t.custom_fields || []).find((x) => x.id === CFG.F.produkter);
  if (!f || !Array.isArray(f.value)) return [];
  const opts = (f.type_config && f.type_config.options && f.type_config.options.length) ? f.type_config.options : reserve;
  return f.value
    .map((v) => opts.find((o) => o.id === (v && v.id ? v.id : v)))
    .filter(Boolean)
    .sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0))
    .map((o) => ({ navn: o.label || o.name, farve: o.color || '#e9e9e9' }));
}

function tilAftale(t, reserve) {
  const vaerdi = felt(t, CFG.F.vaerdi);
  const deadline = felt(t, CFG.F.deadline);
  return {
    id: t.id,
    navn: t.name,
    produkter: produkter(t, reserve),
    vaerdi: vaerdi !== null && vaerdi !== '' ? Number(vaerdi) : null,
    udloeb: deadline ? Number(deadline) : null,
    opsagt: (t.tags || []).some((x) => x.name === CFG.TAG_OPSAGT),
    url: cuLink(t.url),
  };
}

const erGenfak = (t, kundeId) => t.parent === kundeId && t.custom_item_id === CFG.GENFAK_TYPE_ID && !(t.status && t.status.type === 'closed');

// Hurtig vej: alle kundens underopgaver med felter i ét kald til ClickUp.
// Giver den ingen Genfak (fx hvis ClickUp ignorerer parent-filteret), bruges den langsomme vej.
async function genfakOpgaver(env, kundeId) {
  if (!/^[a-z0-9]+$/i.test(String(kundeId || ''))) throw fejl('Ukendt kunde.', 400, 'OF-400');
  try {
    const d = await cu(env, `/list/${CFG.KUNDER_LIST}/task?parent=${kundeId}&subtasks=true&include_closed=true&archived=false`);
    const opgaver = (d.tasks || []).filter((t) => erGenfak(t, kundeId));
    if (opgaver.length) return { kunde: { id: kundeId }, opgaver };
  } catch (e) {
    console.error('Hurtig hentning af aftaler fejlede', e.detalje || e.message);
  }
  return genfakOpgaverLangsomt(env, kundeId);
}

// Langsom vej: kundeopgaven med underopgaver, og derefter hver Genfak for sig
async function genfakOpgaverLangsomt(env, kundeId) {
  const kunde = await cu(env, `/task/${kundeId}?include_subtasks=true`);
  const ids = (kunde.subtasks || [])
    // Mangler typen i oversigten, hentes opgaven alligevel og filtreres nedenfor
    .filter((s) => (s.custom_item_id === undefined || s.custom_item_id === CFG.GENFAK_TYPE_ID) && !(s.status && s.status.type === 'closed'))
    .map((s) => s.id);
  const opgaver = await Promise.all(ids.map((id) => cu(env, `/task/${id}`)));
  // Kun opgaver der stadig er Genfak og hører til kunden
  return { kunde, opgaver: opgaver.filter((o) => erGenfak(o, kunde.id)) };
}

async function aftaler(env, kundeId) {
  const [{ opgaver }, reserve] = await Promise.all([genfakOpgaver(env, kundeId), produktValg(env)]);
  return opgaver.map((t) => tilAftale(t, reserve)).sort((a, b) => (a.udloeb || Infinity) - (b.udloeb || Infinity));
}

// ---------- Opsig ----------
// 1. Hver valgt Genfak-opgave får tagget 🪦 (de andre tags, fx "udløber 26/27", bliver stående).
// 2. En samlet kommentar skrives på kundeopgaven.

const erHosting = (navn) => /^hos\+?$|hosting/i.test(String(navn).trim()); // HOS og HOS+, ikke H0S (nul)

// Nu = alle valgte aftaler stopper nu. Ved udløb = hver aftale stopper på sin egen udløbsdato.
async function opsig(env, bruger, b) {
  // aftaleIder (flere) eller aftaleId (én, ældre version af formularen)
  const ider = [...new Set((Array.isArray(b.aftaleIder) ? b.aftaleIder : [b.aftaleId]).filter(Boolean).map(String))];
  if (!b.kundeId || !ider.length) throw fejl('Vælg kunden og mindst én aftale.', 400, 'OF-400');
  if (ider.length > 30) throw fejl('For mange aftaler på én gang.', 400, 'OF-400');
  if (!['nu', 'udloeb'].includes(b.stop)) throw fejl('Vælg hvornår kunden stopper.', 400, 'OF-400');

  // Alle aftaler skal høre til kunden
  const [{ kunde, opgaver }, reserve] = await Promise.all([genfakOpgaver(env, b.kundeId), produktValg(env)]);
  const aftaler = ider.map((id) => opgaver.find((o) => o.id === id));
  if (aftaler.some((o) => !o)) throw fejl('En af aftalerne hører ikke til kunden. Genindlæs siden og prøv igen.', 400, 'OF-401');
  const valgte = aftaler.map((o) => tilAftale(o, reserve)).sort((x, y) => (x.udloeb || Infinity) - (y.udloeb || Infinity));
  if (valgte.some((a) => a.opsagt)) throw fejl('En af aftalerne er allerede opsagt (🪦). Genindlæs siden.', 400, 'OF-402');
  const hosting = valgte.some((a) => a.produkter.some((p) => erHosting(p.navn)));
  if (hosting && typeof b.tilsendHjemmeside !== 'boolean') throw fejl('Vælg om kunden skal have tilsendt hjemmesiden.', 400, 'OF-400');

  // 1. Tag 🪦 på hver aftale. Lykkes ingen, stoppes der her, så der ikke skrives en kommentar om noget der ikke skete.
  const tagSti = (id) => `/task/${id}/tag/${encodeURIComponent(CFG.TAG_OPSAGT)}`;
  const tagResultat = await Promise.allSettled(valgte.map((a) => cu(env, tagSti(a.id), { method: 'POST' })));
  const tagFejl = valgte.filter((_, i) => tagResultat[i].status === 'rejected');
  tagResultat.forEach((r, i) => r.status === 'rejected' && console.error('OF-306', valgte[i].id, r.reason.detalje || r.reason.message));
  if (tagFejl.length === valgte.length) throw fejl('Aftalerne kunne ikke markeres som opsagt i ClickUp. Intet er ændret.', 502, 'OF-306', tagResultat[0].reason.detalje);

  const dato = (ms) => new Date(ms).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Copenhagen' });
  const navn = (a) => a.produkter.map((p) => p.navn).join(', ') || a.navn;
  const stopper = (a) => (b.stop === 'nu' ? 'nu' : a.udloeb ? `ved udløb ${dato(a.udloeb)}` : 'ved udløb (ingen udløbsdato i ClickUp)');
  const titel = `🔴 Opsigelse | ${valgte.map(navn).join(' + ')}`;
  const afslut = [
    `Stopper: ${b.stop === 'nu' ? 'Nu (alle aftaler)' : 'Ved udløb (hver aftale på sin egen dato)'}`,
    ...(hosting ? [`Tilsend hjemmesiden: ${b.tilsendHjemmeside ? 'Ja' : 'Nej'}`] : []),
  ];

  // Formateret kommentar (ClickUp rich text): én linje pr. aftale med link, med almindelig tekst som reserve
  const comment = [{ text: titel, attributes: { bold: true } }, { text: '\n' }];
  for (const a of valgte) {
    comment.push({ text: `• ${navn(a)}: stopper ${stopper(a)} ` }, { text: 'Åbn', attributes: { link: a.url } }, { text: '\n' });
  }
  comment.push({ text: '\n' + afslut.join('\n') + '\n\n' }, { text: `Registreret af ${bruger.navn} i opsigelsesformularen.`, attributes: { italic: true } }, { text: '\n' });
  if (tagFejl.length) comment.push({ text: `\n⚠️ Fik ikke 🪦: ${tagFejl.map(navn).join(', ')}. Sæt tagget i hånden.\n` });

  // 2. Kommentar. Tags er sat på dette tidspunkt, så en fejl her stopper ikke opsigelsen.
  let kommentarFejl = null;
  try {
    try {
      await cu(env, `/task/${kunde.id}/comment`, { method: 'POST', body: JSON.stringify({ comment, notify_all: false }) });
    } catch {
      const tekst = [titel, ...valgte.map((a) => `• ${navn(a)}: stopper ${stopper(a)} (${a.url})`), '', ...afslut, '', `Registreret af ${bruger.navn} i opsigelsesformularen.`,
        ...(tagFejl.length ? ['', `⚠️ Fik ikke 🪦: ${tagFejl.map(navn).join(', ')}. Sæt tagget i hånden.`] : [])].join('\n');
      await cu(env, `/task/${kunde.id}/comment`, { method: 'POST', body: JSON.stringify({ comment_text: tekst, notify_all: false }) });
    }
  } catch (e) {
    kommentarFejl = 'OF-307';
    console.error('OF-307', kunde.id, e.detalje || e.message);
  }
  return {
    ok: true,
    antal: valgte.length,
    tagFejl: tagFejl.map((a) => ({ id: a.id, navn: navn(a), url: a.url })),
    kommentarFejl,
  };
}
