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
| Clinician | Kliinikko | Kliniker | Role name (2026-08-25 restructure) — any treating staff account |
| Author | Laatija | Författare | Role name (2026-08-25) — authors survey/treatment templates and alert rules; matches the rule-authoring copy already in product |
| Treatment lead | Hoidon vastuuhenkilö | Behandlingsansvarig | ⚠️ A **position on one treatment's care team**, not an account role (2026-08-25) |
| Administrator | Ylläpitäjä | Administratör | Role name |
| Auditor | Auditoija | Revisor | Role name — oversight of the full audit log (P2, 2026-08-24) |
| Care relationship | Hoitosuhde | Vårdrelation | Established FI term |

## Treatments

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Treatment | Hoito | Behandling | |
| Treatment programme | Hoito-ohjelma | Behandlingsprogram | |
| Treatment template | Hoitomalli | Behandlingsmall | ⚠️ |
| Activity | Tapahtuma | Aktivitet | ⚠️ Not *toimenpide*, which means a clinical procedure |
| Calendar | Kalenteri | Kalender | Patient-side consolidated view (P9) |
| Task | Tehtävä | Uppgift | Clinician-side work item |
| Claim (a task) | Ota tehtävä | Ta uppgift | ⚠️ |
| Assign (a task) | Osoita tehtävä | Tilldela uppgift | Hand to a named team member |
| Unclaimed | Ottamatta | Ej tagen | Team-queue state ⚠️ |
| Team queue | Tiimin jono | Teamets kö | ⚠️ |

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
| Survey | Kysely | Enkät | Owner decision 2026-08-24 (X5): *kysely* in every context. In Finnish usage *lomake* denotes the blank form — template territory — never the instrument or a response |
| Question | Kysymys | Fråga | |
| Response | Vastaus | Svar | |
| Draft (saved response) | Keskeneräinen vastaus | Påbörjat svar | Distinct from template draft |
| Due date | Määräpäivä | Förfallodatum | |
| Overdue | Myöhässä | Försenad | |
| Body map | Kehokartta | Kroppskarta | |
| Recurrence | Toistuvuus | Upprepning | |
| Phase (of a recurrence) | Vaihe | Fas | Ordered leg of a phased schedule (T3) ⚠️ |
| Answer window | Vastausaika | Svarsfönster | Per-occurrence response period ⚠️ |
| Conditional logic | Ehdollinen logiikka | Villkorslogik | Follow-up branching ⚠️ |
| Follow-up question | Jatkokysymys | Följdfråga | ⚠️ |

## Content lifecycle

Used for both survey and treatment templates.

| English | Finnish | Swedish |
|---|---|---|
| Draft | Luonnos | Utkast |
| Published | Julkaistu | Publicerad |
| Archived | Arkistoitu | Arkiverad |
| Version | Versio | Version |

## Alerts and rules

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Alert | Hälytys | Larm | ⚠️ Clinically loaded — confirm with clinicians |
| Trigger | Liipaisin | Utlösare | A single fired rule; an alert cites its triggers ("No triggers", "Raising triggers") ⚠️ |
| Severity | Vakavuusaste | Allvarlighetsgrad | |
| High | Korkea | Hög | Severity level ⚠️ |
| Moderate | Kohtalainen | Måttlig | Severity level ⚠️ |
| Low | Matala | Låg | Severity level ⚠️ |
| New | Uusi | Ny | |
| Acknowledged | Kuitattu | Kvitterad | ⚠️ |
| Resolved | Ratkaistu | Åtgärdad | ⚠️ |
| Triage queue | Hälytysjono | Larmkö | The dashboard's open-alert queue (C1). FI/SV avoid the loanword "triage" - plain "alert queue" reads better (product decision 2026-08) |
| Record only | Vain kirjaus | Endast registrering | Rule with all outcomes off — stored, nothing raised |
| Trend rule | Trendisääntö | Trendregel | Condition across consecutive responses ⚠️ |
| Custom notification | Mukautettu ilmoitus | Anpassad avisering | Rule outcome with authored text ⚠️ |
| Expected in this program | Odotettu tässä ohjelmassa | Förväntat i detta program | Response-detail standing ⚠️ |
| Above expected | Odotettua voimakkaampi | Över förväntat | ⚠️ |
| Critical area | Kriittinen alue | Kritiskt område | Body-map region flagged per program ⚠️ |

## Messaging

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Message | Viesti | Meddelande | |
| Conversation | Keskustelu | Samtal | One thread per treatment programme (WP-23) |
| Internal note | Sisäinen muistiinpano | Intern anteckning | Never patient-visible |
| Attachment | Liite | Bilaga | |

## Navigation and views

Terms fixed by the brief's naming conventions.

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Updates | Päivitykset | Uppdateringar | Landing feed. **Not** "Recent activities" |
| Action needed | Vaatii toimia | Kräver åtgärd | Patient's pending items |
| Download my data | Lataa omat tietoni | Ladda ner mina uppgifter | GDPR self-export (WP-26) |
| Who has viewed my records | Kuka on katsonut tietojani | Vem har tittat på mina uppgifter | P8 access log (WP-26) |
| Upcoming | Tulevat | Kommande | |
| Messages | Viestit | Meddelanden | |
| Treatments | Hoidot | Behandlingar | |
| Surveys | Kyselyt | Enkäter | |
| Dashboard | Työpöytä | Arbetsyta | Clinician start view ⚠️ |
| Worklist | Työlista | Arbetslista | |
| Patient roster | Potilaslista | Patientlista | |
| Notification | Ilmoitus | Avisering | |
| Settings | Asetukset | Inställningar | |

## Patient profile sub-navigation (clinician side)

Finnish supplied by the product owner — canonical, unlike the drafts above;
revised 2026-08-24 per the X5 decision (*kysely* replaces *lomake*).
Swedish remains draft ⚠️.

| English | Finnish | Swedish |
|---|---|---|
| Patient profile | Potilaan profiili | Patientprofil |
| Patient summary | Potilaan yhteenveto | Patientöversikt |
| Programs, surveys & care team | Ohjelmat, kyselyt ja hoitotiimi | Program, enkäter och vårdteam |
| Patient details | Potilaan tiedot | Patientuppgifter |
| Health data | Terveystiedot | Hälsodata |
| Values | Arvot | Värden |
| Symptoms | Oireet | Symtom |
| Completed surveys | Täytetyt kyselyt | Ifyllda enkäter |
| Data export | Potilaan tietojen vienti | Dataexport |
| Report | Raportti | Rapport |
| Report a symptom | Raportoi oire | Rapportera symtom |
| Fill a survey | Täytä kysely | Fyll i enkät |
| New value | Uusi arvo | Nytt värde |

## Symptom taxonomy

System reference data ([`architecture/observations.md`](architecture/observations.md)).
**Finnish is canonical** (supplied by the product owner); English is the
working translation from the brief; Swedish is draft ⚠️ pending native
clinical review. The list grows over time. QLQ-30 from the source list is an
instrument, not a symptom — it lives in the survey catalog (register R11).

| Finnish (canonical) | English | Swedish ⚠️ |
|---|---|---|
| Hengenahdistus | Shortness of breath | Andnöd |
| Ihottuma / ihomuutos | Rash / skin change — reported on the body map | Hudutslag / hudförändring |
| Nivelkipu | Joint pain | Ledvärk |
| Ripuli | Diarrhea | Diarré |
| Turvotus | Swelling | Svullnad |
| Yskä | Cough | Hosta |
| Erektiohäiriö | Erectile dysfunction | Erektil dysfunktion |
| Eturauhasen kipu | Prostate pain | Prostatasmärta |
| Kipu | Pain | Smärta |
| Kivulias virtsaaminen | Painful urination | Smärtsam urinering |
| Kuume | Fever | Feber |
| Muut oireet | Other symptoms | Övriga symtom |
| Neuropatia | Neuropathy | Neuropati |
| Oksentelu | Vomiting | Kräkningar |
| Pahoinvointi | Nausea | Illamående |
| Paleltumat | Cold sensitivity | Köldkänslighet |
| Peräaukon kipu | Anal pain | Analsmärta |
| Ruokahalun väheneminen | Decreased appetite | Nedsatt aptit |
| Suun kuivuminen | Dry mouth | Muntorrhet |
| Suun limakalvovauriot | Oral mucosal damage | Skador på munslemhinnan |
| Tihentynyt virtsaamisen tarve | Urinary frequency | Täta urinträngningar |
| Ummetus | Constipation | Förstoppning |
| Verivirtsaisuus | Hematuria | Blod i urinen |
| Väsymys | Fatigue | Trötthet |
| Virtsan karkailu | Urinary incontinence | Urininkontinens |
| Virtsapakko | Urinary urgency | Urinträngningar |
| Virtsaumpi | Urinary retention | Urinstämma |

Symptom-observation trend labels: New — Uusi — Ny ⚠️; Worsening — Pahenee —
Förvärras ⚠️; Stable — Vakaa — Stabil ⚠️; Easing — Helpottaa — Lindras ⚠️;
Resolved — Poistunut — Avklingat ⚠️.

## Account and access

| English | Finnish | Swedish | Note |
|---|---|---|---|
| Log in | Kirjaudu sisään | Logga in | |
| Log out | Kirjaudu ulos | Logga ut | |
| Password | Salasana | Lösenord | |
| Verification code | Vahvistuskoodi | Verifieringskod | The email MFA code |
| Access log | Käyttöloki | Åtkomstlogg | Established FI term |
| Audit log | Käyttöloki | Åtkomstlogg | Internal; patients see "access log". FI and SV deliberately reuse the access-log term — one word for one concept on both sides (WP-28) |
| Reset login | Nollaa kirjautuminen | Återställ inloggning | Admin action (A1): new setup link, sessions signed out, data untouched |
| Deactivate | Poista käytöstä | Avaktivera | Account lifecycle (A1) |
| Reactivate | Palauta käyttöön | Återaktivera | Inverse of deactivate; restores sign-in only |
| Capability | Oikeus | Behörighet | A2 role matrix column/row language |
| Deceased | Menehtynyt | Avliden | ⚠️ Respectful register — FI deliberately *menehtynyt*, never *kuollut*, in UI text (WP-29) |
| Mark as deceased | Merkitse menehtyneeksi | Markera som avliden | Lead-only care action (WP-29) |
| Date of death | Kuolinpäivä | Dödsdatum | Dialog field label |
| Archived (treatment) | Arkistoitu | Arkiverad | Read-only after the quiet period (WP-29) |
| Retention | Säilytys | Bevarande | Data kept per statutory periods (R5) |
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
