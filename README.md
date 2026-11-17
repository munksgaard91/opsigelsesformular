# Opsigelsesformular

Intern formular til at registrere en kundes opsigelse i ClickUp (BestCRM).
Ligger på https://opsigelse.leksione.dk og kræver login med en best-one.dk Google-konto.

- `index.html`: formularen (skrift, logo og stil er indlejret)
- `app.js`: logikken
- Al adgang til ClickUp sker i en Cloudflare Worker. Der ligger ingen nøgler i dette repo.

## Flow

1. Vælg kunden (søgning i Kunder-listen).
2. Vælg én Genfak-aftale. Én aftale = én opsigelse.
3. Aftalens samlede varighed, hvornår kunden stopper (nu / ved udløb) og, hvis aftalen indeholder HOS,
   om kunden skal have tilsendt hjemmesiden.
4. "Opsig".

## Test lokalt

Åbn siden fra `localhost` eller med `?demo` i adressen. Så kører den med opdigtede testdata og uden login,
og der sendes intet til ClickUp.

## Workerens API

| Kald | Svar |
|---|---|
| `POST /api/login` `{ credential }` | `{ token, navn, billede, exp }`. Google-token tjekkes, og `hd` skal være `best-one.dk`. |
| `GET /api/kunder` | `[{ id, navn, domaene, status, url }]` |
| `GET /api/aftaler?kunde=<id>` | `[{ id, navn, produkter: [{ navn, farve }], vaerdi, udloeb, url }]` (kundens Genfak-underopgaver) |
| `POST /api/opsig` `{ kundeId, aftaleId, varighed, stop, tilsendHjemmeside }` | `{ ok, url? }` |

Fejl svares som `{ fejl, kode }` med fejlkoder `OF-xxx`.

## Worker

Koden ligger i `worker/worker.js` og sættes ind i Cloudflare-workeren `opsigelsesformular`
(Workers & Pages > opsigelsesformular > Edit code). Den skal have to hemmeligheder:

- `CLICKUP_TOKEN`: ClickUp API-token
- `SESSION_SECRET`: lang tilfældig tekst (fx `openssl rand -hex 32`)

Lige nu skriver "Opsig" kun en kommentar på kundeopgaven. Automatiseringerne i ClickUp kommer bagefter.
