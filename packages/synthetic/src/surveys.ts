import type { LocaleBundle, SurveyDefinition } from '@mio/survey-schema';

/**
 * The synthetic survey catalog - real definitions for the five template
 * keys the world generator already hands out (pools.SURVEY_TEMPLATES).
 * House-built content only: the quality-of-life survey is a stand-in named
 * as such, never licensed instrument items (register R11).
 */

export interface SyntheticSurvey {
  key: string;
  name: string;
  kind: 'generic' | 'symptom';
  licensedSource?: string;
  definition: SurveyDefinition;
  locales: LocaleBundle[];
}

const SYMPTOM_CORE: SurveyDefinition = {
  kind: 'symptom',
  pages: [
    {
      id: 'symptoms',
      questions: [
        {
          id: 'nausea',
          type: 'choice_single',
          required: true,
          options: [{ id: 'none' }, { id: 'mild' }, { id: 'severe' }],
          // WP-21: the answer lands in the symptom register, graded
          symptomMap: { code: 'nausea', severities: { mild: 'mild', severe: 'severe' } },
          // WP-18 single-response rules straight off the canvas: severe
          // nausea alerts high, "2 times or more" moderate, heavy impact
          // moderate; considerable fatigue is RECORD-ONLY - stored for
          // trends, nothing raised.
          rules: [
            {
              id: 'r-nausea-severe',
              when: { kind: 'option', optionId: 'severe' },
              outcomes: [{ kind: 'alert', severity: 'high' }],
            },
          ],
          followUps: [
            {
              id: 'nausea-frequency',
              type: 'choice_single',
              required: true,
              condition: { questionId: 'nausea', op: 'in', value: ['mild', 'severe'] },
              options: [{ id: 'once' }, { id: 'twice-or-more' }],
              rules: [
                {
                  id: 'r-nausea-frequent',
                  when: { kind: 'option', optionId: 'twice-or-more' },
                  outcomes: [{ kind: 'alert', severity: 'moderate' }],
                },
              ],
              followUps: [
                {
                  id: 'nausea-impact',
                  type: 'scale',
                  required: true,
                  scale: { min: 0, max: 10 },
                  condition: {
                    questionId: 'nausea-frequency',
                    op: 'equals',
                    value: 'twice-or-more',
                  },
                  rules: [
                    {
                      id: 'r-nausea-impact',
                      when: { kind: 'at_least', value: 7 },
                      outcomes: [{ kind: 'alert', severity: 'moderate' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'fatigue',
          type: 'choice_single',
          required: true,
          options: [{ id: 'none' }, { id: 'slight' }, { id: 'moderate' }, { id: 'considerable' }],
          symptomMap: {
            code: 'fatigue',
            severities: { slight: 'mild', moderate: 'moderate', considerable: 'severe' },
          },
          rules: [
            {
              id: 'r-fatigue-considerable',
              when: { kind: 'option', optionId: 'considerable' },
              outcomes: [],
            },
          ],
        },
        {
          id: 'temperature',
          type: 'text',
          validation: { pattern: '\\d{2}([.,]\\d)?', maxLength: 6 },
        },
      ],
    },
  ],
};

const SYMPTOM_CORE_TEXT = {
  en: {
    nausea: {
      label: 'Nausea over the past week',
      options: { none: 'None', mild: 'Mild', severe: 'Severe' },
    },
    'nausea-frequency': {
      label: 'How often did nausea occur?',
      options: { once: 'Once', 'twice-or-more': '2 times or more' },
    },
    'nausea-impact': {
      label: 'How much did it affect your day?',
      scaleMinLabel: 'Not at all',
      scaleMaxLabel: 'Severely',
    },
    fatigue: {
      label: 'Fatigue',
      options: {
        none: 'None',
        slight: 'Slight',
        moderate: 'Moderate',
        considerable: 'Considerable',
      },
    },
    temperature: {
      label: 'Highest measured temperature (°C)',
      description: 'Leave empty if you did not measure.',
      patternMessage: 'Give the temperature like 38.5',
    },
  },
  fi: {
    nausea: {
      label: 'Pahoinvointi viimeisen viikon aikana',
      options: { none: 'Ei lainkaan', mild: 'Lievää', severe: 'Voimakasta' },
    },
    'nausea-frequency': {
      label: 'Kuinka usein pahoinvointia esiintyi?',
      options: { once: 'Kerran', 'twice-or-more': '2 kertaa tai useammin' },
    },
    'nausea-impact': {
      label: 'Kuinka paljon se haittasi päivääsi?',
      scaleMinLabel: 'Ei lainkaan',
      scaleMaxLabel: 'Erittäin paljon',
    },
    fatigue: {
      label: 'Väsymys',
      options: {
        none: 'Ei lainkaan',
        slight: 'Vähäistä',
        moderate: 'Kohtalaista',
        considerable: 'Huomattavaa',
      },
    },
    temperature: {
      label: 'Korkein mitattu lämpö (°C)',
      description: 'Jätä tyhjäksi, jos et mitannut.',
      patternMessage: 'Kirjoita lämpö muodossa 38,5',
    },
  },
  sv: {
    nausea: {
      label: 'Illamående under den senaste veckan',
      options: { none: 'Inget', mild: 'Milt', severe: 'Kraftigt' },
    },
    'nausea-frequency': {
      label: 'Hur ofta förekom illamående?',
      options: { once: 'En gång', 'twice-or-more': '2 gånger eller fler' },
    },
    'nausea-impact': {
      label: 'Hur mycket påverkade det din dag?',
      scaleMinLabel: 'Inte alls',
      scaleMaxLabel: 'Mycket',
    },
    fatigue: {
      label: 'Trötthet',
      options: { none: 'Ingen', slight: 'Lätt', moderate: 'Måttlig', considerable: 'Betydande' },
    },
    temperature: {
      label: 'Högsta uppmätta temperatur (°C)',
      description: 'Lämna tomt om du inte mätte.',
      patternMessage: 'Ange temperaturen som 38,5',
    },
  },
} as const;

function symptomLocales(titles: { en: string; fi: string; sv: string }): LocaleBundle[] {
  return (['en', 'fi', 'sv'] as const).map((locale) => ({
    locale,
    title: titles[locale],
    questions: { ...SYMPTOM_CORE_TEXT[locale] },
  }));
}

export const SYNTHETIC_SURVEYS: SyntheticSurvey[] = [
  {
    key: 'weekly-symptoms',
    name: 'Weekly symptom survey',
    kind: 'symptom',
    definition: SYMPTOM_CORE,
    locales: symptomLocales({
      en: 'Weekly symptom survey',
      fi: 'Viikoittainen oirekysely',
      sv: 'Veckovis symtomenkät',
    }),
  },
  {
    key: 'chemo-symptoms',
    name: 'Chemotherapy symptom survey',
    kind: 'symptom',
    definition: {
      kind: 'symptom',
      pages: [
        {
          id: 'symptoms',
          questions: [
            ...SYMPTOM_CORE.pages[0]!.questions,
            {
              id: 'skin-change',
              type: 'choice_single',
              required: true,
              options: [{ id: 'no' }, { id: 'yes' }],
              followUps: [
                {
                  id: 'skin-change-map',
                  type: 'body_map',
                  required: true,
                  condition: { questionId: 'skin-change', op: 'equals', value: 'yes' },
                  // template-critical areas per the canvas (B3): chest, neck.
                  // Stripped from every patient-facing payload.
                  criticalRegions: ['chest', 'neck'],
                  symptomMap: { code: 'skin_change', severity: 'moderate' },
                  // B3's three rule kinds: critical area, any other area,
                  // count threshold ("3 or more areas")
                  rules: [
                    {
                      id: 'r-skin-critical',
                      when: { kind: 'critical_region' },
                      outcomes: [{ kind: 'alert', severity: 'high' }],
                    },
                    {
                      id: 'r-skin-other',
                      when: { kind: 'other_region' },
                      outcomes: [{ kind: 'alert', severity: 'low' }],
                    },
                    {
                      id: 'r-skin-spread',
                      when: { kind: 'region_count', value: 3 },
                      outcomes: [{ kind: 'alert', severity: 'moderate' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    locales: (['en', 'fi', 'sv'] as const).map((locale) => ({
      locale,
      title: {
        en: 'Chemotherapy symptom survey',
        fi: 'Solunsalpaajahoidon oirekysely',
        sv: 'Symtomenkät vid cytostatikabehandling',
      }[locale],
      questions: {
        ...SYMPTOM_CORE_TEXT[locale],
        'skin-change': {
          label: {
            en: 'Any new skin changes?',
            fi: 'Onko iholla uusia muutoksia?',
            sv: 'Några nya hudförändringar?',
          }[locale],
          options: {
            no: { en: 'No', fi: 'Ei', sv: 'Nej' }[locale],
            yes: { en: 'Yes', fi: 'Kyllä', sv: 'Ja' }[locale],
          },
        },
        'skin-change-map': {
          label: {
            en: 'Mark where on the body',
            fi: 'Merkitse mihin kohtaan kehoa',
            sv: 'Markera var på kroppen',
          }[locale],
        },
      },
    })),
  },
  {
    key: 'wellbeing',
    name: 'Wellbeing check (house QoL)',
    kind: 'generic',
    definition: {
      pages: [
        {
          id: 'wellbeing',
          questions: [
            { id: 'overall', type: 'scale', required: true, scale: { min: 0, max: 10 } },
            { id: 'sleep', type: 'scale', required: true, scale: { min: 0, max: 10 } },
            {
              id: 'daily-activity',
              type: 'choice_single',
              required: true,
              options: [{ id: 'as-usual' }, { id: 'somewhat-limited' }, { id: 'mostly-resting' }],
            },
          ],
        },
      ],
    },
    locales: (['en', 'fi', 'sv'] as const).map((locale) => ({
      locale,
      title: { en: 'Wellbeing check', fi: 'Vointikysely', sv: 'Måendekontroll' }[locale],
      questions: {
        overall: {
          label: {
            en: 'Overall wellbeing this week',
            fi: 'Yleinen vointi tällä viikolla',
            sv: 'Allmänt mående denna vecka',
          }[locale],
          scaleMinLabel: { en: 'Very poor', fi: 'Erittäin huono', sv: 'Mycket dåligt' }[locale],
          scaleMaxLabel: { en: 'Excellent', fi: 'Erinomainen', sv: 'Utmärkt' }[locale],
        },
        sleep: {
          label: {
            en: 'How well have you slept?',
            fi: 'Kuinka hyvin olet nukkunut?',
            sv: 'Hur bra har du sovit?',
          }[locale],
          scaleMinLabel: { en: 'Very poorly', fi: 'Erittäin huonosti', sv: 'Mycket dåligt' }[
            locale
          ],
          scaleMaxLabel: { en: 'Very well', fi: 'Erittäin hyvin', sv: 'Mycket bra' }[locale],
        },
        'daily-activity': {
          label: {
            en: 'Daily activity',
            fi: 'Päivittäinen toimintakyky',
            sv: 'Daglig aktivitet',
          }[locale],
          options: {
            'as-usual': { en: 'As usual', fi: 'Tavalliseen tapaan', sv: 'Som vanligt' }[locale],
            'somewhat-limited': {
              en: 'Somewhat limited',
              fi: 'Jonkin verran rajoittunut',
              sv: 'Något begränsad',
            }[locale],
            'mostly-resting': {
              en: 'Mostly resting',
              fi: 'Enimmäkseen levossa',
              sv: 'Mest vilande',
            }[locale],
          },
        },
      },
    })),
  },
  {
    key: 'psa-reporting',
    name: 'PSA reporting',
    kind: 'generic',
    definition: {
      pages: [
        {
          id: 'psa',
          questions: [
            {
              id: 'psa-value',
              type: 'number',
              required: true,
              validation: { min: 0, max: 10000, decimals: 2, unit: 'µg/l' },
            },
            { id: 'lab-date', type: 'date', required: true },
            { id: 'lab-location', type: 'text', validation: { maxLength: 120 } },
          ],
        },
      ],
    },
    locales: (['en', 'fi', 'sv'] as const).map((locale) => ({
      locale,
      title: { en: 'PSA reporting', fi: 'PSA-arvon ilmoitus', sv: 'PSA-rapportering' }[locale],
      questions: {
        'psa-value': {
          label: { en: 'PSA value', fi: 'PSA-arvo', sv: 'PSA-värde' }[locale],
          description: {
            en: 'From your latest laboratory result.',
            fi: 'Viimeisimmästä laboratoriotuloksestasi.',
            sv: 'Från ditt senaste laboratoriesvar.',
          }[locale],
        },
        'lab-date': {
          label: { en: 'Date of the test', fi: 'Näytteenottopäivä', sv: 'Provtagningsdatum' }[
            locale
          ],
        },
        'lab-location': {
          label: {
            en: 'Laboratory (optional)',
            fi: 'Laboratorio (valinnainen)',
            sv: 'Laboratorium (valfritt)',
          }[locale],
        },
      },
    })),
  },
  {
    key: 'neuropathy-follow-up',
    name: 'Neuropathy follow-up survey',
    kind: 'symptom',
    definition: {
      kind: 'symptom',
      pages: [
        {
          id: 'neuropathy',
          questions: [
            {
              id: 'numbness',
              type: 'choice_single',
              required: true,
              options: [{ id: 'none' }, { id: 'mild' }, { id: 'severe' }],
              symptomMap: { code: 'neuropathy', severities: { mild: 'mild', severe: 'severe' } },
              followUps: [
                {
                  id: 'numbness-areas',
                  type: 'choice_multi',
                  required: true,
                  condition: { questionId: 'numbness', op: 'in', value: ['mild', 'severe'] },
                  options: [{ id: 'hands' }, { id: 'feet' }, { id: 'other' }],
                },
              ],
            },
            {
              id: 'pain',
              type: 'scale',
              required: true,
              scale: { min: 0, max: 10 },
              rules: [
                {
                  id: 'r-pain-severe',
                  when: { kind: 'at_least', value: 8 },
                  outcomes: [{ kind: 'alert', severity: 'moderate' }],
                },
              ],
            },
          ],
        },
      ],
    },
    locales: (['en', 'fi', 'sv'] as const).map((locale) => ({
      locale,
      title: {
        en: 'Neuropathy follow-up',
        fi: 'Neuropatian seurantakysely',
        sv: 'Uppföljning av neuropati',
      }[locale],
      questions: {
        numbness: {
          label: {
            en: 'Numbness or tingling',
            fi: 'Puutumista tai pistelyä',
            sv: 'Domningar eller stickningar',
          }[locale],
          options: {
            none: { en: 'None', fi: 'Ei lainkaan', sv: 'Inga' }[locale],
            mild: { en: 'Mild', fi: 'Lievää', sv: 'Milda' }[locale],
            severe: { en: 'Severe', fi: 'Voimakasta', sv: 'Kraftiga' }[locale],
          },
        },
        'numbness-areas': {
          label: { en: 'Where?', fi: 'Missä?', sv: 'Var?' }[locale],
          options: {
            hands: { en: 'Hands', fi: 'Käsissä', sv: 'Händerna' }[locale],
            feet: { en: 'Feet', fi: 'Jaloissa', sv: 'Fötterna' }[locale],
            other: { en: 'Elsewhere', fi: 'Muualla', sv: 'Annanstans' }[locale],
          },
        },
        pain: {
          label: {
            en: 'Nerve pain right now',
            fi: 'Hermosärky juuri nyt',
            sv: 'Nervsmärta just nu',
          }[locale],
          scaleMinLabel: { en: 'None', fi: 'Ei lainkaan', sv: 'Ingen' }[locale],
          scaleMaxLabel: { en: 'Worst imaginable', fi: 'Pahin mahdollinen', sv: 'Värsta tänkbara' }[
            locale
          ],
        },
      },
    })),
  },
];
