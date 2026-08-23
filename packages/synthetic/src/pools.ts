/**
 * Curated synthetic pools. Names are common Finnish and Swedish names in
 * plausible combinations - no real person is referenced or implied. Emails
 * use the RFC 2606 reserved .example TLD ONLY, so synthetic contact data
 * can never collide with a real mailbox. Phone numbers are format-plausible
 * but synthetic.
 */

export const FI_GIVEN = [
  'Aino',
  'Anna',
  'Eevi',
  'Elina',
  'Hanna',
  'Helmi',
  'Ilona',
  'Kaisa',
  'Laura',
  'Liisa',
  'Maija',
  'Marja',
  'Minna',
  'Noora',
  'Oona',
  'Pihla',
  'Riikka',
  'Sanni',
  'Satu',
  'Tuuli',
  'Veera',
  'Aleksi',
  'Antero',
  'Eero',
  'Eetu',
  'Elias',
  'Ilmari',
  'Juhani',
  'Jukka',
  'Kalle',
  'Lauri',
  'Matti',
  'Mikael',
  'Mikko',
  'Olavi',
  'Onni',
  'Pekka',
  'Sampo',
  'Tapio',
  'Timo',
  'Toivo',
  'Veikko',
] as const;

export const FI_FAMILY = [
  'Virtanen',
  'Korhonen',
  'Mäkinen',
  'Nieminen',
  'Mäkelä',
  'Hämäläinen',
  'Laine',
  'Heikkinen',
  'Koskinen',
  'Järvinen',
  'Lehtonen',
  'Lehtinen',
  'Saarinen',
  'Salminen',
  'Heinonen',
  'Niemi',
  'Heikkilä',
  'Kinnunen',
  'Salonen',
  'Turunen',
  'Salo',
  'Laitinen',
  'Tuominen',
  'Rantanen',
  'Karjalainen',
  'Jokinen',
  'Mattila',
  'Savolainen',
  'Lahtinen',
  'Ahonen',
] as const;

export const SV_GIVEN = [
  'Alva',
  'Astrid',
  'Ebba',
  'Elsa',
  'Freja',
  'Greta',
  'Ingrid',
  'Karin',
  'Linnea',
  'Maja',
  'Saga',
  'Sigrid',
  'Stina',
  'Tove',
  'Wilma',
  'Anders',
  'Axel',
  'Björn',
  'Erik',
  'Gustav',
  'Henrik',
  'Johan',
  'Lars',
  'Magnus',
  'Mats',
  'Nils',
  'Olof',
  'Per',
  'Sven',
  'Torbjörn',
] as const;

export const SV_FAMILY = [
  'Andersson',
  'Johansson',
  'Karlsson',
  'Nilsson',
  'Eriksson',
  'Larsson',
  'Olsson',
  'Persson',
  'Svensson',
  'Gustafsson',
  'Pettersson',
  'Jonsson',
  'Lindberg',
  'Lindström',
  'Lindqvist',
  'Lindgren',
  'Axelsson',
  'Berg',
  'Bergström',
  'Lundberg',
  'Lundgren',
  'Lundqvist',
  'Sandberg',
  'Forsberg',
  'Holmberg',
] as const;

export const FI_STREETS = [
  'Mannerheimintie',
  'Kirkkokatu',
  'Koulukatu',
  'Rantatie',
  'Asemakatu',
  'Puistokatu',
  'Satamakatu',
  'Teollisuuskatu',
  'Kauppakatu',
  'Hämeentie',
  'Pitkäkatu',
  'Myllytie',
] as const;

export const SV_STREETS = [
  'Storgatan',
  'Kyrkogatan',
  'Skolgatan',
  'Strandvägen',
  'Järnvägsgatan',
  'Parkgatan',
  'Hamngatan',
  'Köpmangatan',
  'Kvarnvägen',
  'Långgatan',
] as const;

export const FI_CITIES = [
  ['00100', 'Helsinki'],
  ['02100', 'Espoo'],
  ['33100', 'Tampere'],
  ['20100', 'Turku'],
  ['90100', 'Oulu'],
  ['65100', 'Vaasa'],
  ['40100', 'Jyväskylä'],
  ['70100', 'Kuopio'],
] as const;

export const SV_CITIES = [
  ['111 20', 'Stockholm'],
  ['411 03', 'Göteborg'],
  ['211 19', 'Malmö'],
  ['753 10', 'Uppsala'],
  ['582 22', 'Linköping'],
  ['903 26', 'Umeå'],
] as const;

/**
 * Symptom vocabulary - EN codes matching the taxonomy in docs/glossary.md
 * (Finnish-canonical there; codes here are the stable identifiers).
 */
export const SYMPTOMS = [
  'nausea',
  'vomiting',
  'fatigue',
  'fever',
  'neuropathy',
  'decreased_appetite',
  'skin_change',
  'joint_pain',
  'diarrhea',
  'constipation',
  'swelling',
  'cough',
  'shortness_of_breath',
  'dry_mouth',
  'oral_mucosal_damage',
  'pain',
  'cold_sensitivity',
  'other_symptoms',
] as const;

export type SymptomCode = (typeof SYMPTOMS)[number];

/** Treatment program templates, matching the designed catalog (T2). */
export const PROGRAM_TEMPLATES = [
  { key: 'breast-fec', name: 'Breast ca adjuvant FEC', detail: '6 cycles, 3-week interval' },
  { key: 'colorectal-folfox', name: 'Colorectal FOLFOX', detail: '12 cycles, 2-week interval' },
  { key: 'prostate-rt', name: 'Prostate radiotherapy', detail: 'External beam, 20 fractions' },
  { key: 'prostate-docetaxel', name: 'Prostate docetaxel', detail: '6 cycles, 3-week interval' },
  {
    key: 'immuno-follow-up',
    name: 'Immunotherapy follow-up',
    detail: 'Pembrolizumab, 6-week interval',
  },
  { key: 'lymphoma-rchop', name: 'Lymphoma R-CHOP', detail: '6 cycles, 3-week interval' },
] as const;

/**
 * Survey templates. NOTE: no licensed instrument content is fabricated here
 * (register R11) - the quality-of-life survey is a house-built stand-in
 * named as such, never QLQ-C30 items.
 */
export const SURVEY_TEMPLATES = [
  { key: 'weekly-symptoms', name: 'Weekly symptom survey', cadence: 'weekly' },
  { key: 'chemo-symptoms', name: 'Chemotherapy symptom survey', cadence: 'weekly' },
  { key: 'wellbeing', name: 'Wellbeing check (house QoL)', cadence: 'monthly' },
  { key: 'psa-reporting', name: 'PSA reporting', cadence: 'monthly-then-quarterly' },
  { key: 'neuropathy-follow-up', name: 'Neuropathy follow-up survey', cadence: 'biweekly' },
] as const;

export const TEAM_NAMES = [
  'Oncology ward 4',
  'Oncology outpatient',
  'Urology outpatient',
  'Radiotherapy unit',
  'Day hospital',
  'Hematology ward',
  'Breast cancer unit',
  'Palliative support',
] as const;
