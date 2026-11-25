# Opsigelsesformular

Intern formular til at registrere en kundes opsigelse i BestCRM (ClickUp).
Ligger på https://opsigelse.leksione.dk og kræver login med en best-one.dk Google-konto.

- `index.html`: formularen (skrift, logo og stil er indlejret). Rettes direkte i filen.
- `app.js`: logikken i browseren
- `worker/worker.js`: Cloudflare Worker, al adgang til ClickUp
- `apps-script/Code.gs`: Google Apps Script, der sender mailen til bogholderiet
- Der ligger ingen nøgler eller adresser i dette repo.

## Flow

1. Vælg kunden (søgning i Kunder-listen). Sælgeren fra hovedopgaven vises under kunden.
2. Vælg én eller flere Genfak-aftaler. Aftaler der allerede har 🪦, kan ikke vælges.
3. Hvornår kunden stopper: "Nu" = alle valgte aftaler stopper nu. "Ved udløb" = hver aftale stopper på sin egen
   udløbsdato (feltet Deadline). Er en hostingaftale med (HOS, H0S eller HOS+), spørges der om hjemmesiden skal udleveres.
4. "Opsig". Kvitteringen viser kun noget ud over opsigelsen, hvis noget fejlede (med fejlkode).

## Det sker, når der trykkes "Opsig"

1. Tagget 🪦 sættes på hver valgt Genfak-opgave. De andre tags, fx "udløber 26/27", bliver stående.
   Lykkes det ikke for nogen af aftalerne, stopper opsigelsen, og intet er ændret.
2. Hovedopgaven får en due date, hvis den ikke har en: til og med kl. 12:00 på en arbejdsdag = i dag, ellers næste
   arbejdsdag (weekender og helligdage springes over), som i supportformularen.
3. Mail til bogholderiet (HTML, med en tekstudgave som reserve): emne `[Kunde]: Opsagte produkter: [Produkt, Produkt]`,
   en linje pr. aftale med hvornår den stopper, om hjemmesiden skal udleveres (kun ved hosting), link til hovedopgaven
   og hvem der oprettede opsigelsen. Svar på mailen går til den, der oprettede opsigelsen.
4. Kommentar i hovedopgaven med de opsagte produkter, hvornår kunden stopper og evt. om hjemmesiden skal udleveres.

Workeren **tilføjer kun** (tag, due date når den mangler, kommentar). Den fjerner eller erstatter aldrig noget.

"Hjemmeside Admin" som assignee er slået fra (`CFG.HJEMMESIDE_ADMIN_AKTIV: false`) og tilføjes aldrig.

## Opsætning

### Cloudflare Worker
Koden i `worker/worker.js` sættes ind i workeren `opsigelsesformular` (Workers & Pages > opsigelsesformular > Edit code > Deploy).

- Secrets: `CLICKUP_TOKEN`, `SESSION_SECRET`, `MAIL_URL`, `MAIL_SECRET`
- KV-binding: `KUNDER_KV` = **samme** KV-navnerum som supportformularen. Kundelisten læses fra nøglen `kunder-v2`,
  som supportformularens cron opdaterer hver time. Workeren skriver aldrig i KV. Ingen cron nødvendig.
- Kopiér koden med UTF-8 (`LANG=en_US.UTF-8 pbcopy < worker/worker.js`), ellers ødelægges æøå og 🪦.

### ClickUp-brugeren
`CLICKUP_TOKEN` tilhører servicebrugeren BestCRM. Den skal være **Member** (ikke Guest) og have **Can edit** på listen
Kunder i Produktionen. Uden det afviser ClickUp tagget med `ACCESS_081`, og formularen viser OF-313.

### Google Apps Script (mailen)
Udrullet fra servicekontoen, så mailene sendes fra dens Gmail og ligger i dens Sendt-mappe.

- Script properties: `HEMMELIGHED` (samme værdi som `MAIL_SECRET` i Cloudflare) og `MODTAGER` (bogholderiets adresse).
  Ændringer i properties virker med det samme.
- Første gang: kør `testMail` og godkend adgangen til Gmail.
- **Opdatering af koden:** Implementér > Administrer implementeringer > blyanten > Version: Ny version > Implementér.
  Brug ikke "Ny implementering", det giver en ny adresse, så `MAIL_URL` i Cloudflare ikke længere passer.

## Test lokalt

Åbn siden fra `localhost` (fx `python3 -m http.server`). Så kører den med opdigtede testdata og uden login,
og der sendes intet til BestCRM.

## Workerens API

| Kald | Svar |
|---|---|
| `POST /api/login` `{ credential }` | `{ token, navn, email, billede, exp }`. Googles signatur tjekkes, og `hd` skal være `best-one.dk`. |
| `GET /api/kunder` | `[{ id, navn, domaene, status, url }]` |
| `GET /api/aftaler?kunde=<id>` | `{ aftaler: [{ id, navn, produkter: [{ navn, farve }], vaerdi, udloeb, opsagt, url }], saelger: { navn } \| null }` |
| `POST /api/opsig` `{ kundeId, aftaleIder: [...], stop: 'nu' \| 'udloeb', tilsendHjemmeside }` | `{ ok, antal, tagFejl, mailFejl, dueSat, dueFejl, kommentarFejl }` |

Fejl svares som `{ fejl, kode }` med fejlkoder `OF-xxx`. De vigtigste:

| Kode | Betyder |
|---|---|
| OF-306 | Ingen af aftalerne kunne markeres med 🪦. Intet er ændret. |
| OF-313 | Servicebrugeren mangler rettigheder i BestCRM. Intet er ændret. |
| OF-308 / OF-309 | Mailen blev ikke sendt (mangler opsætning / Apps Script fejlede). Resten er gennemført. |
| OF-312 | Produkterne på en aftale kunne ikke læses. Intet er ændret. |
| OF-401 / OF-402 | Aftalerne har ændret sig, eller en er allerede opsagt. Aftalerne hentes igen. |
