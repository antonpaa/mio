# Glossary — EN / FI / SV

Mio ships in English, Finnish and Swedish. This is the agreed vocabulary.

Terminology drift between UI strings, database columns and translator output is
a persistent and expensive bug class in a trilingual clinical product. The
glossary is the cheap fix: one agreed term per concept, used in code, in the
interface and in translation.

> ⚠️ **The Finnish and Swedish columns are drafts and have not been reviewed by
> a native clinical reviewer.** They are a starting point for that review, not
> an approved translation. Several entries are marked where a term is
> particularly likely to need a clinician's judgement rather than a
> translator's.

## Rules

- **The English term is the identifier.** Code, database columns, API fields and
  Cedar entities use the English term. Translations are presentation only.
- One concept, one term. If two English words are in use for one thing, pick one
  and record the loser here as deprecated.
- Survey content is **not** governed by this glossary — it is clinical data
  authored per instrument, not UI vocabulary
  ([`architecture/surveys-and-alerts.md`](architecture/surveys-and-alerts.md)).

## Product

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Mio | Mio | Mio | Never translated |
| Care, together | Hoitoa yhdessä | Vård, tillsammans | Slogan, from the brief |

## People and roles

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Patient | Potilas | Patient | |
| Care team | Hoitotiimi | Vårdteam | |
| Treatment Member | Hoitotiimin jäsen | Vårdteammedlem | Role name |
| Treatment Lead | Hoidon vastuuhenkilö | Behandlingsansvarig | Role name ⚠️ |
| Administrator | Ylläpitäjä | Administratör | Role name |
| Care relationship | Hoitosuhde | Vårdrelation | Established FI term |

## Treatments

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Treatment | Hoito | Behandling | |
| Treatment programme | Hoito-ohjelma | Behandlingsprogram | |
| Treatment template | Hoitomalli | Behandlingsmall | ⚠️ |
| Activity | Tapahtuma | Aktivitet | ⚠️ Not *toimenpide*, which means a clinical procedure |
| Task | Tehtävä | Uppgift | Clinician-side work item |

## Treatment lifecycle

| English | Finnish | Swedish |
|---|---|---|
| Draft | Luonnos | Utkast |
| Active | Aktiivinen | Aktiv |
| Paused | Tauolla | Pausad |
| Completed | Päättynyt | Avslutad |
| Discontinued | Lopetettu | Avbruten |

## Surveys

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Survey | Kysely | Enkät | |
| Question | Kysymys | Fråga | |
| Response | Vastaus | Svar | |
| Draft (saved response) | Keskeneräinen vastaus | Påbörjat svar | Distinct from template draft |
| Due date | Määräpäivä | Förfallodatum | |
| Overdue | Myöhässä | Försenad | |
| Body map | Kehokartta | Kroppskarta | |
| Recurrence | Toistuvuus | Upprepning | |

## Content lifecycle

Used for both survey and treatment templates.

| English | Finnish | Swedish |
|---|---|---|
| Draft | Luonnos | Utkast |
| Published | Julkaistu | Publicerad |
| Archived | Arkistoitu | Arkiverad |
| Version | Versio | Version |

## Alerts

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Alert | Hälytys | Larm | ⚠️ Clinically loaded — confirm with clinicians |
| Severity | Vakavuusaste | Allvarlighetsgrad | |
| New | Uusi | Ny | |
| Acknowledged | Kuitattu | Kvitterad | ⚠️ |
| Resolved | Ratkaistu | Åtgärdad | ⚠️ |

## Messaging

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Message | Viesti | Meddelande | |
| Internal note | Sisäinen muistiinpano | Intern anteckning | Never patient-visible |
| Attachment | Liite | Bilaga | |

## Navigation and views

Terms fixed by the brief's naming conventions.

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Updates | Päivitykset | Uppdateringar | Landing feed. **Not** "Recent activities" |
| Action needed | Vaatii toimia | Kräver åtgärd | Patient's pending items |
| Upcoming | Tulevat | Kommande | |
| Messages | Viestit | Meddelanden | |
| Treatments | Hoidot | Behandlingar | |
| Surveys | Kyselyt | Enkäter | |
| Dashboard | Työpöytä | Arbetsyta | Clinician start view ⚠️ |
| Worklist | Työlista | Arbetslista | |
| Patient roster | Potilaslista | Patientlista | |
| Notification | Ilmoitus | Avisering | |
| Settings | Asetukset | Inställningar | |

## Account and access

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Log in | Kirjaudu sisään | Logga in | |
| Log out | Kirjaudu ulos | Logga ut | |
| Password | Salasana | Lösenord | |
| Verification code | Vahvistuskoodi | Verifieringskod | The email MFA code |
| Access log | Käyttöloki | Åtkomstlogg | Established FI term |
| Audit log | Käyttöloki | Granskningslogg | Internal; patients see "access log" |
| Consent | Suostumus | Samtycke | |
| Terms of use | Käyttöehdot | Användarvillkor | |
| Privacy notice | Tietosuojaseloste | Integritetspolicy | Established FI term |

## Deprecated

Terms not to use, and what to use instead.

| Do not use | Use | Why |
|---|---|---|
| Recent activities | Updates | Fixed by the brief |
| Flag | Alert | One term for the concept |
| Form | Survey | "Form" is the builder's output type, not the product concept |
| Toimenpide (FI) | Tapahtuma | *Toimenpide* means a clinical procedure |
| Case | Treatment | |
