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
   udløbsdato (feltet Deadline). Er en hostingaftale med (HOS, H0S eller HOS+), spørges der om hjemmesiden skal udleveres.
4. "Opsig".

## Test lokalt

Åbn siden fra `localhost` eller med `?demo` i adressen. Så kører den med opdigtede testdata og uden login,
og der sendes intet til ClickUp.

## Worker

Koden ligger i `worker/worker.js` og sættes ind i Cloudflare-workeren `opsigelsesformular`
(Workers & Pages > opsigelsesformular > Edit code). Den er bygget efter samme mønster som supportformularens worker.

- Secrets: `CLICKUP_TOKEN`, `SESSION_SECRET`, `MAIL_URL` og `MAIL_SECRET`
- KV-binding: `KUNDER_KV` = **samme** KV-navnerum som supportformularen. Kundelisten læses derfra
  (nøglen `kunder-v2`, opdateres hver time af supportformularens cron), så opsigelsesformularen
  ikke selv skal hente alle kunder fra ClickUp. Workeren skriver aldrig i KV.
- Ingen cron-trigger nødvendig.

"Opsig" gør fem ting:

1. Sætter tagget 🪦 på hver valgt Genfak-opgave (de andre tags, fx "udløber 26/27", bliver stående).
2. Sender en mail til bogholderiet: emne `[Kunde]: Opsagte produkter: [Produkt, Produkt]`, en linje pr. produkt med stopdato,
   link til hovedopgaven og hvem der oprettede opsigelsen.
3. Skriver en kommentar i hovedopgaven (kunden) med de opsagte produkter, hvornår kunden stopper og,
   hvis HOS er med, om hjemmesiden skal udleveres.

4. Sætter brugergruppen "Hjemmeside Admin" som ekstra assignee på hovedopgaven, når alle opsagte aftaler kun er hosting
   (HOS, H0S, HOS+), eller når kunden er en ren hostingkunde (ingen andre produkter på nogen Genfak). Ellers ikke.

5. Sætter en due date på hovedopgaven, hvis den ikke har en: til og med kl. 12:00 på en arbejdsdag = i dag, ellers næste
   arbejdsdag (weekender og helligdage springes over), som i supportformularen.

Formularen viser også kundens sælger (feltet "Sælger" på hovedopgaven) under kundens navn.

Workeren tilføjer altid kun: tags, assignees og kommentarer. Den fjerner eller erstatter aldrig noget.
Aftaler der allerede har 🪦, kan ikke vælges.

## Mail via Google Apps Script

Koden ligger i `apps-script/Code.gs`. Den udrulles fra den konto, mailene skal komme fra (bestcrm@best-one.dk):

1. Opret et nyt Apps Script-projekt på script.google.com og indsæt `Code.gs`.
2. Projektindstillinger > Script properties: `HEMMELIGHED` (samme værdi som `MAIL_SECRET` i Cloudflare) og
   `MODTAGER` (bogholderiets adresse). Adressen ligger kun dér, ikke i repoet.
3. Kør `testMail` én gang og godkend adgangen.
4. Implementér > Ny implementering > Webapp, udfør som "Mig", adgang "Alle". Adressen sættes som `MAIL_URL` i Cloudflare.

## Workerens API

| Kald | Svar |
|---|---|
| `POST /api/login` `{ credential }` | `{ token, navn, email, billede, exp }`. Googles signatur tjekkes, og `hd` skal være `best-one.dk`. |
| `GET /api/kunder` | `[{ id, navn, domaene, status, url }]` |
| `GET /api/aftaler?kunde=<id>` | `{ aftaler: [{ id, navn, produkter: [{ navn, farve }], vaerdi, udloeb, opsagt, url }], saelger: { navn } \| null }` |
| `POST /api/opsig` `{ kundeId, aftaleIder: [...], stop: 'nu' \| 'udloeb', tilsendHjemmeside }` | `{ ok, antal }` |

Fejl svares som `{ fejl, kode }` med fejlkoder `OF-xxx`.
