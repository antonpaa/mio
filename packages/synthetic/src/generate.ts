import {
  createRng,
  intBetween,
  pick,
  pickWeighted,
  sample,
  syntheticId,
  type Rng,
} from './random.js';
import {
  FI_CITIES,
  FI_FAMILY,
  FI_GIVEN,
  FI_STREETS,
  PROGRAM_TEMPLATES,
  SV_CITIES,
  SV_FAMILY,
  SV_GIVEN,
  SV_STREETS,
  SYMPTOMS,
  TEAM_NAMES,
} from './pools.js';
import {
  PROFILES,
  type Locale,
  type Profile,
  type Severity,
  type SyntheticAlert,
  type SyntheticPatient,
  type SyntheticResponse,
  type SyntheticStaff,
  type SyntheticTask,
  type SyntheticTeam,
  type SyntheticTreatment,
  type SyntheticValueEntry,
  type SyntheticWorld,
} from './world.js';

/** Fixed epoch so generated timestamps are deterministic. */
const EPOCH = Date.UTC(2026, 7, 21);

function isoDay(offsetDays: number): string {
  return new Date(EPOCH + offsetDays * 86_400_000).toISOString();
}

function normalizeEmailLocal(given: string, family: string): string {
  return `${given}.${family}`
    .toLowerCase()
    .replaceAll('ä', 'a')
    .replaceAll('ö', 'o')
    .replaceAll('å', 'a');
}

interface Person {
  givenName: string;
  familyName: string;
  locale: Locale;
  country: 'FI' | 'SE';
}

function makePerson(rng: Rng): Person {
  // FI-heavy mix with Swedish and a few English-preferring users - the
  // three product locales all appear in any non-trivial world.
  const flavor = pickWeighted(rng, [
    ['fi', 62],
    ['sv', 28],
    ['en', 10],
  ] as const);
  if (flavor === 'sv') {
    return {
      givenName: pick(rng, SV_GIVEN),
      familyName: pick(rng, SV_FAMILY),
      locale: 'sv',
      country: rng() < 0.5 ? 'FI' : 'SE',
    };
  }
  return {
    givenName: pick(rng, FI_GIVEN),
    familyName: pick(rng, FI_FAMILY),
    locale: flavor,
    country: 'FI',
  };
}

/** Symptom trajectory over consecutive weekly surveys. */
type Trend = 'stable_mild' | 'worsening' | 'easing' | 'spike' | 'none';

function levelFor(trend: Trend, week: number, weeks: number, rng: Rng): 0 | 1 | 2 | 3 {
  const progress = weeks <= 1 ? 1 : week / (weeks - 1);
  switch (trend) {
    case 'none':
      return 0;
    case 'stable_mild':
      return rng() < 0.85 ? 1 : 0;
    case 'worsening':
      return Math.min(3, Math.floor(progress * 3.6)) as 0 | 1 | 2 | 3;
    case 'easing':
      return Math.max(0, 2 - Math.floor(progress * 2.8)) as 0 | 1 | 2 | 3;
    case 'spike':
      return week === weeks - 1 ? 3 : rng() < 0.2 ? 1 : 0;
  }
}

export function generateWorld(profileName: 'demo' | 'perf', seed: number): SyntheticWorld {
  const profile: Profile = PROFILES[profileName];
  const rng = createRng(seed);

  // --- staff -------------------------------------------------------------
  const staff: SyntheticStaff[] = [];
  for (let i = 0; i < profile.staff; i++) {
    const person = makePerson(rng);
    const isAdmin = i < profile.administrators;
    // one auditor per world (P2): the oversight role exists everywhere
    const isAuditor = !isAdmin && i === profile.administrators;
    const isLead =
      !isAdmin && !isAuditor && i < profile.administrators + 1 + Math.ceil(profile.staff * 0.18);
    staff.push({
      id: syntheticId('staff', i),
      givenName: person.givenName,
      familyName: person.familyName,
      email: `${normalizeEmailLocal(person.givenName, person.familyName)}.${i}@staff.example`,
      role: isAdmin
        ? 'administrator'
        : isAuditor
          ? 'auditor'
          : isLead
            ? 'treatment_lead'
            : 'treatment_member',
      title: isAdmin
        ? 'Administrator'
        : isAuditor
          ? 'Auditor'
          : isLead
            ? pick(rng, ['Oncologist', 'Chief physician', 'Urologist'] as const)
            : pick(rng, ['Nurse', 'Care coordinator', 'Physiotherapist', 'Resident'] as const),
      locale: person.locale,
    });
  }
  const clinicians = staff.filter((s) => s.role !== 'administrator' && s.role !== 'auditor');
  const leads = staff.filter((s) => s.role === 'treatment_lead');

  // --- teams -------------------------------------------------------------
  const teams: SyntheticTeam[] = [];
  for (let i = 0; i < profile.teams; i++) {
    const teamLeads = sample(rng, leads, Math.max(1, intBetween(rng, 1, 2))).map((s) => s.id);
    const memberCount = intBetween(rng, 6, 14);
    const members = new Set<string>(teamLeads);
    for (const member of sample(rng, clinicians, memberCount)) members.add(member.id);
    teams.push({
      id: syntheticId('team', i),
      name: `${TEAM_NAMES[i % TEAM_NAMES.length] as string}${i >= TEAM_NAMES.length ? ` ${Math.floor(i / TEAM_NAMES.length) + 1}` : ''}`,
      memberIds: [...members],
      leadIds: teamLeads,
    });
  }

  // --- patients, treatments, care graph ----------------------------------
  const patients: SyntheticPatient[] = [];
  const treatments: SyntheticTreatment[] = [];
  const careRelationships = new Map<string, string[]>();

  for (let i = 0; i < profile.patients; i++) {
    const person = makePerson(rng);
    const [postalCode, city] =
      person.country === 'SE' ? pick(rng, SV_CITIES) : pick(rng, FI_CITIES);
    const street = person.country === 'SE' ? pick(rng, SV_STREETS) : pick(rng, FI_STREETS);
    const patient: SyntheticPatient = {
      id: syntheticId('patient', i),
      givenName: person.givenName,
      familyName: person.familyName,
      email: `${normalizeEmailLocal(person.givenName, person.familyName)}.${i}@patient.example`,
      phone:
        person.country === 'SE'
          ? `+46 70 ${String(1000000 + Math.floor(rng() * 8999999)).slice(0, 7)}`
          : `+358 40 ${String(1000000 + Math.floor(rng() * 8999999)).slice(0, 7)}`,
      dateOfBirth: new Date(
        Date.UTC(intBetween(rng, 1945, 1995), intBetween(rng, 0, 11), intBetween(rng, 1, 28)),
      )
        .toISOString()
        .slice(0, 10),
      locale: person.locale,
      address: {
        street: `${street} ${intBetween(rng, 1, 48)}`,
        postalCode,
        city,
        country: person.country,
      },
    };
    patients.push(patient);

    const programCount = pickWeighted(rng, [
      [1, 82],
      [2, 18],
    ] as const);
    const programKeys = sample(rng, PROGRAM_TEMPLATES, programCount);
    const carers = new Set<string>();
    for (const [t, template] of programKeys.entries()) {
      const team = pick(rng, teams);
      const active = rng() < 0.85;
      treatments.push({
        id: syntheticId('treat', i * 4 + t),
        templateKey: template.key,
        name: template.name,
        patientId: patient.id,
        teamId: team.id,
        state: active
          ? 'active'
          : pickWeighted(rng, [
              ['completed', 70],
              ['paused', 18],
              ['discontinued', 12],
            ] as const),
        startedAt: isoDay(-intBetween(rng, 30, 320)),
        surveyKeys: template.key.startsWith('prostate')
          ? ['chemo-symptoms', 'psa-reporting']
          : ['weekly-symptoms', 'wellbeing'],
      });
      // v1 rule (0005 migration): membership grants the relationship
      // regardless of lifecycle state - completed treatments keep access.
      for (const memberId of team.memberIds) carers.add(memberId);
    }
    careRelationships.set(patient.id, [...carers]);
  }

  const world: SyntheticWorld = {
    profile: profile.name,
    seed,
    patients,
    staff,
    teams,
    treatments,
    careRelationships,
    responses: [],
    alerts: [],
    messages: [],
    values: [],
    tasks: [],
  };

  if (!profile.histories) return world;

  // --- histories: responses with trends, alerts, messages, values, tasks --
  const teamById = new Map(teams.map((t) => [t.id, t]));
  let responseCounter = 0;
  let alertCounter = 0;
  let messageCounter = 0;
  let valueCounter = 0;
  let taskCounter = 0;

  for (const treatment of treatments.filter((t) => t.state === 'active')) {
    const team = teamById.get(treatment.teamId);
    if (!team) continue;
    const weeks = intBetween(rng, 5, 10);
    const trendPlan = new Map<string, Trend>();
    for (const symptom of SYMPTOMS) {
      trendPlan.set(
        symptom,
        pickWeighted(rng, [
          ['none', 55],
          ['stable_mild', 28],
          ['easing', 8],
          ['worsening', 6],
          ['spike', 3],
        ] as const),
      );
    }

    for (let week = 0; week < weeks; week++) {
      // Non-response is a signal too: ~8% of weeks go unanswered.
      if (rng() < 0.08) continue;
      const onBehalf = rng() < 0.05 ? pick(rng, team.memberIds) : undefined;
      const answers = SYMPTOMS.map((symptom) => ({
        symptom,
        level: levelFor(trendPlan.get(symptom) ?? 'none', week, weeks, rng),
      }));
      const worst = Math.max(...answers.map((a) => a.level));
      const severity: Severity | undefined =
        worst >= 3
          ? rng() < 0.7
            ? 'high'
            : 'moderate'
          : worst === 2 && rng() < 0.25
            ? 'moderate'
            : undefined;

      const response: SyntheticResponse = {
        id: syntheticId('resp', responseCounter++),
        surveyKey: treatment.surveyKeys[0] as string,
        treatmentId: treatment.id,
        patientId: treatment.patientId,
        week,
        answeredAt: isoDay(-7 * (weeks - week)),
        ...(onBehalf !== undefined ? { onBehalfOfStaffId: onBehalf } : {}),
        answers,
        ...(severity !== undefined ? { raisedSeverity: severity } : {}),
      };
      world.responses.push(response);

      if (severity) {
        const culprit = answers.filter((a) => a.level >= 2).map((a) => a.symptom);
        const state = pickWeighted(rng, [
          ['new', 30],
          ['acknowledged', 30],
          ['resolved', 40],
        ] as const);
        world.alerts.push({
          id: syntheticId('alert', alertCounter++),
          patientId: treatment.patientId,
          treatmentId: treatment.id,
          responseId: response.id,
          severity,
          reason: `${culprit.join(', ')} above the program's expected range`,
          state,
          ...(state !== 'new' ? { assigneeStaffId: pick(rng, team.memberIds) } : {}),
          raisedAt: response.answeredAt,
        } satisfies SyntheticAlert);
        if (state !== 'resolved' && rng() < 0.5) {
          world.tasks.push({
            id: syntheticId('task', taskCounter++),
            treatmentId: treatment.id,
            title: 'Call the patient about the latest alert',
            dueOffsetDays: intBetween(rng, 0, 3),
            state: 'unclaimed',
          } satisfies SyntheticTask);
        }
      }
    }

    // Low seed of always-present low-severity alerts so every severity is
    // represented even in small worlds.
    if (rng() < 0.15) {
      world.alerts.push({
        id: syntheticId('alert', alertCounter++),
        patientId: treatment.patientId,
        treatmentId: treatment.id,
        severity: 'low',
        reason: 'mild symptoms persisting across check-ins',
        state: 'resolved',
        assigneeStaffId: pick(rng, team.memberIds),
        raisedAt: isoDay(-intBetween(rng, 5, 40)),
      });
    }

    // Messages: patient question + staff reply (+ internal note sometimes).
    const patientMsg = rng() < 0.7;
    if (patientMsg) {
      world.messages.push({
        id: syntheticId('msg', messageCounter++),
        threadTreatmentId: treatment.id,
        authorId: treatment.patientId,
        authorKind: 'patient',
        internalNote: false,
        body: pick(rng, [
          'I have had more nausea than usual after this cycle. Is that expected?',
          'Can I move next week’s appointment to the afternoon?',
          'The tingling in my fingers is a bit stronger this week.',
          'Thank you, that helps a lot.',
        ] as const),
        sentAt: isoDay(-intBetween(rng, 1, 12)),
      });
      world.messages.push({
        id: syntheticId('msg', messageCounter++),
        threadTreatmentId: treatment.id,
        authorId: pick(rng, team.memberIds),
        authorKind: 'staff',
        internalNote: false,
        body: 'Thank you for telling us - some increase can happen in this phase. Record it in your survey so we can follow it, and call us if it gets worse.',
        sentAt: isoDay(-intBetween(rng, 0, 1)),
      });
      if (rng() < 0.4) {
        world.messages.push({
          id: syntheticId('msg', messageCounter++),
          threadTreatmentId: treatment.id,
          authorId: pick(rng, team.memberIds),
          authorKind: 'staff',
          internalNote: true,
          body: 'Trending up across cycles - if the next survey confirms, discuss medication change at the next visit.',
          sentAt: isoDay(0),
        });
      }
    }

    // Values for prostate programs: a drifting PSA series + stable testosterone.
    if (treatment.templateKey.startsWith('prostate')) {
      const base = 2.4 + rng() * 2;
      for (let m = 0; m < 6; m++) {
        world.values.push({
          id: syntheticId('value', valueCounter++),
          patientId: treatment.patientId,
          series: 'psa',
          unit: 'µg/l',
          value: Math.round((base + m * (rng() < 0.6 ? 0.25 : -0.05) + rng() * 0.2) * 10) / 10,
          measuredAt: isoDay(-30 * (6 - m)),
          ...(rng() < 0.25 ? { onBehalfOfStaffId: pick(rng, team.memberIds) } : {}),
        } satisfies SyntheticValueEntry);
      }
    }
  }

  return world;
}
