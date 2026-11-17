# Opsigelsesformular

Intern formular til at registrere en kundes opsigelse i ClickUp (BestCRM).
Ligger på https://opsigelse.leksione.dk og kræver login med en best-one.dk Google-konto.

- `index.html`: formularen (skrift, logo og stil er indlejret)
- `app.js`: logikken
- Al adgang til ClickUp sker i en Cloudflare Worker. Der ligger ingen nøgler i dette repo.

## Flow

1. Vælg kunden (søgning i Kunder-listen).
2. Vælg én Genfak-aftale. Én aftale = én opsigelse.
3. Hvornår kunden stopper (nu / ved udløb) og, hvis aftalen indeholder HOS,
   om kunden skal have tilsendt hjemmesiden.
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

Lige nu skriver "Opsig" kun en kommentar på kundeopgaven. Automatiseringerne i ClickUp kommer bagefter.
