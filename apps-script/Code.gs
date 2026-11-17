// Opsigelsesformular: sender mail til bogholderiet, når en opsigelse er lavet.
// Kaldes af Cloudflare-workeren "opsigelsesformular". Mailen sendes fra Gmail på den konto, der udruller
// scriptet (bestcrm@best-one.dk), og ligger bagefter i kontoens Sendt-mappe.
//
// Script properties (Projektindstillinger > Script properties), aldrig i koden:
//   HEMMELIGHED  samme lange tilfældige tekst som MAIL_SECRET i Cloudflare
//   MODTAGER     bogholderiets e-mailadresse (flere adskilles med komma)
//
// Udrulning: Implementér > Ny implementering > Webapp
//   Udfør som: Mig   ·   Hvem har adgang: Alle
// (Adgangen beskyttes af HEMMELIGHED. Webappens adresse sættes som MAIL_URL i Cloudflare.)

function doPost(e) {
  const p = PropertiesService.getScriptProperties();
  let d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return svar({ ok: false, fejl: 'Ugyldig forespørgsel' });
  }
  const hemmelighed = p.getProperty('HEMMELIGHED');
  if (!hemmelighed || d.hemmelighed !== hemmelighed) return svar({ ok: false, fejl: 'Adgang nægtet' });

  const til = p.getProperty('MODTAGER');
  if (!til) return svar({ ok: false, fejl: 'MODTAGER er ikke sat i scriptets indstillinger' });
  if (!d.emne || !d.tekst) return svar({ ok: false, fejl: 'Emne eller tekst mangler' });

  const valg = { name: 'BestCRM' };
  // Svar går til den medarbejder der lavede opsigelsen
  if (/^[^\s@]+@best-one\.dk$/i.test(String(d.svarTil || ''))) valg.replyTo = d.svarTil;

  GmailApp.sendEmail(til, String(d.emne).slice(0, 250), String(d.tekst), valg);
  return svar({ ok: true });
}

function svar(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Kør denne én gang fra editoren for at give scriptet lov til at sende mail (og tjekke opsætningen)
function testMail() {
  const til = PropertiesService.getScriptProperties().getProperty('MODTAGER');
  if (!til) throw new Error('Sæt MODTAGER under Projektindstillinger > Script properties først');
  GmailApp.sendEmail(Session.getActiveUser().getEmail(), 'Test: Opsigelsesformular', 'Scriptet kan sende mail. Rigtige mails går til: ' + til, { name: 'BestCRM' });
}
