# Opsigelsesformular

Intern formular til at registrere en kundes opsigelse i ClickUp (BestCRM).
Ligger på https://opsigelse.leksione.dk og kræver login med en best-one.dk Google-konto.

- `index.html`: formularen (skrift, logo og stil er indlejret)
- `app.js`: logikken
- Al adgang til ClickUp sker i en Cloudflare Worker. Der ligger ingen nøgler i dette repo.

## Flow

1. Vælg kunden (søgning i Kunder-listen).
2. Vælg én eller flere Genfak-aftaler.
3. Hvornår kunden stopper: "Nu" = alle valgte aftaler stopper nu. "Ved udløb" = hver aftale stopper på sin egen
   udløbsdato (feltet Deadline). Er HOS med, spørges der om kunden skal have tilsendt hjemmesiden.
4. "Opsig".

## Test lokalt

Åbn siden fra `localhost` eller med `?demo` i adressen. Så kører den med opdigtede testdata og uden login,
og der sendes intet til ClickUp.

## Worker

Koden ligger i `worker/worker.js` og sættes ind i Cloudflare-workeren `opsigelsesformular`
(Workers & Pages > opsigelsesformular > Edit code). Den er bygget efter samme mønster som supportformularens worker.

- Secrets: `CLICKUP_TOKEN` og `SESSION_SECRET`
- KV-binding: `KUNDER_KV` = **samme** KV-navnerum som supportformularen. Kundelisten læses derfra
  (nøglen `kunder-v2`, opdateres hver time af supportformularens cron), så opsigelsesformularen
  ikke selv skal hente alle kunder fra ClickUp. Workeren skriver aldrig i KV.
- Ingen cron-trigger nødvendig.

"Opsig" sætter tagget 🪦 på hver valgt Genfak-opgave (de andre tags, fx "udløber 26/27", bliver stående) og skriver en samlet kommentar på kundeopgaven. Aftaler der allerede har 🪦, kan ikke vælges.

## Workerens API

| Kald | Svar |
|---|---|
| `POST /api/login` `{ credential }` | `{ token, navn, email, billede, exp }`. Googles signatur tjekkes, og `hd` skal være `best-one.dk`. |
| `GET /api/kunder` | `[{ id, navn, domaene, status, url }]` |
| `GET /api/aftaler?kunde=<id>` | `[{ id, navn, produkter: [{ navn, farve }], vaerdi, udloeb, url }]` (kundens Genfak-underopgaver) |
| `POST /api/opsig` `{ kundeId, aftaleIder: [...], stop: 'nu' \| 'udloeb', tilsendHjemmeside }` | `{ ok, antal }` |

Fejl svares som `{ fejl, kode }` med fejlkoder `OF-xxx`.
