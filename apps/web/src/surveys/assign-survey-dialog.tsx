import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  addDays,
  expandSchedule,
  formatDate,
  parseDate,
  type ScheduleSegment,
} from '@mio/schedule';
import { Button, StatusChip, useModalFocus } from '@mio/ui';

/**
 * T4: attach a survey to this treatment and send it now, on a date, or on
 * a phased recurrence - previewed with the same expander the server
 * materialises with.
 */

interface CatalogRow {
  id: string;
  name: string;
  kind: string;
  licensed_source: string | null;
  versions: { id: string; version: number; state: string }[];
}

interface PhaseDraft {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: string;
  count: string;
}

type Mode = 'now' | 'scheduled' | 'recurring';

const inputClass =
  'mt-1.5 w-full rounded-inner border border-border bg-surface px-3 py-2.5 text-sm text-ink';

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function AssignSurveyDialog({
  treatmentId,
  onClose,
  onAssigned,
}: {
  treatmentId: string;
  onClose: () => void;
  onAssigned: () => void;
}): ReactElement {
  const modalRef = useModalFocus<HTMLDivElement>();
  const intl = useIntl();
  const catalog = useQuery({
    queryKey: ['survey-catalog'],
    queryFn: async () => {
      const response = await fetch('/api/staff/surveys', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`catalog: ${response.status}`);
      return (await response.json()) as CatalogRow[];
    },
  });
  const [surveyId, setSurveyId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [language, setLanguage] = useState('');
  const [mode, setMode] = useState<Mode>('now');
  const [date, setDate] = useState(localToday());
  const [anchorDate, setAnchorDate] = useState(localToday());
  const [phases, setPhases] = useState<PhaseDraft[]>([
    { freq: 'weekly', interval: '1', count: '8' },
  ]);
  const [answerWindowDays, setAnswerWindowDays] = useState('7');
  const [reminderAfterDays, setReminderAfterDays] = useState('3');
  const [escalateUnanswered, setEscalateUnanswered] = useState(false);

  const chosen = catalog.data?.find((row) => row.id === surveyId);
  const published = (chosen?.versions ?? []).filter((entry) => entry.state === 'published');

  const segments: ScheduleSegment[] = useMemo(
    () =>
      phases.map((phase) => ({
        freq: phase.freq,
        interval: Math.max(1, Number(phase.interval) || 1),
        count: Math.max(1, Number(phase.count) || 1),
      })),
    [phases],
  );
  const preview = useMemo(() => {
    if (mode !== 'recurring' || !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) return undefined;
    try {
      const horizon = formatDate(addDays(parseDate(anchorDate), 365));
      const dates = expandSchedule({ anchorDate, segments }, { to: horizon, max: 400 });
      return { error: dates.length === 0, dates };
    } catch {
      return { error: true as const, dates: [] };
    }
  }, [mode, anchorDate, segments]);

  const assign = useMutation({
    mutationFn: async () => {
      const body = {
        surveyId,
        ...(versionId ? { versionId } : {}),
        ...(language ? { language } : {}),
        mode,
        ...(mode === 'scheduled' ? { date } : {}),
        ...(mode === 'recurring'
          ? {
              anchorDate,
              segments,
              answerWindowDays: Number(answerWindowDays) || undefined,
              reminderAfterDays: Number(reminderAfterDays) || undefined,
              escalateUnanswered,
            }
          : {}),
      };
      const response = await fetch(`/api/staff/treatments/${treatmentId}/surveys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`assign: ${response.status}`);
    },
    onSuccess: () => {
      onAssigned();
      onClose();
    },
  });

  const valid =
    surveyId !== '' && (mode !== 'recurring' || (preview !== undefined && !preview.error));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-survey-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        ref={modalRef}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-card bg-surface p-6 shadow-raised"
      >
        <h2 id="assign-survey-title" className="font-display text-lg italic text-ink">
          <FormattedMessage id="assign.title" />
        </h2>

        <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
          <FormattedMessage id="assign.survey" />
          <select
            className={inputClass}
            value={surveyId}
            onChange={(event) => {
              setSurveyId(event.currentTarget.value);
              setVersionId('');
            }}
          >
            <option value="">—</option>
            {(catalog.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
                {row.licensed_source ? ` — ${intl.formatMessage({ id: 'assign.licensed' })}` : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="assign.version" />
            <select
              className={inputClass}
              value={versionId}
              onChange={(event) => setVersionId(event.currentTarget.value)}
            >
              <option value="">
                {intl.formatMessage(
                  { id: 'assign.newestVersion' },
                  { version: published[0]?.version ?? 1 },
                )}
              </option>
              {published.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  v{entry.version}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="assign.language" />
            <select
              className={inputClass}
              value={language}
              onChange={(event) => setLanguage(event.currentTarget.value)}
            >
              <option value="">{intl.formatMessage({ id: 'assign.patientsChoice' })}</option>
              <option value="en">English</option>
              <option value="fi">Suomi</option>
              <option value="sv">Svenska</option>
            </select>
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="assign.when" />
          </legend>
          <div
            className="mt-1.5 flex flex-wrap gap-2"
            role="radiogroup"
            aria-label={intl.formatMessage({ id: 'assign.when' })}
          >
            {(['now', 'scheduled', 'recurring'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                onClick={() => setMode(option)}
                className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                  mode === option
                    ? 'border-teal bg-teal-tint font-medium text-teal'
                    : 'border-border bg-surface text-secondary hover:bg-surface-sunken hover:text-ink'
                }`}
              >
                {intl.formatMessage({ id: `assign.mode.${option}` })}
              </button>
            ))}
          </div>
        </fieldset>

        {mode === 'scheduled' ? (
          <label className="mt-3 block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="assign.date" />
            <input
              type="date"
              className={`${inputClass} block max-w-52`}
              value={date}
              onChange={(event) => setDate(event.currentTarget.value)}
            />
          </label>
        ) : null}

        {mode === 'recurring' ? (
          <div className="mt-3 flex flex-col gap-3">
            <label className="block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="schedule.starts" />
              <input
                type="date"
                className={`${inputClass} block max-w-52`}
                value={anchorDate}
                onChange={(event) => setAnchorDate(event.currentTarget.value)}
              />
            </label>
            {phases.map((phase, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-inner border border-hairline bg-paper px-3.5 py-2.5"
              >
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  <FormattedMessage id="schedule.phase" values={{ n: index + 1 }} />
                </span>
                <label className="flex items-center gap-2 text-xs font-medium text-secondary">
                  <FormattedMessage id="schedule.every" />
                  <input
                    type="number"
                    min={1}
                    className="w-16 rounded-inner border border-border bg-surface px-2 py-1.5 text-sm text-ink"
                    value={phase.interval}
                    onChange={(event) => {
                      const next = [...phases];
                      next[index] = { ...phase, interval: event.currentTarget.value };
                      setPhases(next);
                    }}
                  />
                </label>
                <label className="flex items-center text-xs font-medium text-secondary">
                  <span className="sr-only">
                    <FormattedMessage id="schedule.unit" />
                  </span>
                  <select
                    className="rounded-inner border border-border bg-surface px-2 py-1.5 text-sm text-ink"
                    value={phase.freq}
                    onChange={(event) => {
                      const next = [...phases];
                      next[index] = {
                        ...phase,
                        freq: event.currentTarget.value as PhaseDraft['freq'],
                      };
                      setPhases(next);
                    }}
                  >
                    <option value="daily">{intl.formatMessage({ id: 'schedule.days' })}</option>
                    <option value="weekly">{intl.formatMessage({ id: 'schedule.weeks' })}</option>
                    <option value="monthly">{intl.formatMessage({ id: 'schedule.months' })}</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-secondary">
                  <FormattedMessage id="schedule.timesLabel" />
                  <input
                    type="number"
                    min={1}
                    className="w-16 rounded-inner border border-border bg-surface px-2 py-1.5 text-sm text-ink"
                    value={phase.count}
                    onChange={(event) => {
                      const next = [...phases];
                      next[index] = { ...phase, count: event.currentTarget.value };
                      setPhases(next);
                    }}
                  />
                </label>
                {phases.length > 1 ? (
                  <Button
                    variant="quiet"
                    size="sm"
                    onPress={() => setPhases(phases.filter((_, i) => i !== index))}
                  >
                    <FormattedMessage id="schedule.removePhase" />
                  </Button>
                ) : null}
              </div>
            ))}
            <div>
              <Button
                variant="quiet"
                size="sm"
                onPress={() =>
                  setPhases([...phases, { freq: 'monthly', interval: '3', count: '4' }])
                }
              >
                <FormattedMessage id="schedule.addPhase" />
              </Button>
            </div>

            <div className="grid grid-cols-2 items-end gap-3">
              <label className="block text-sm font-medium text-ink-strong-secondary">
                <FormattedMessage id="schedule.answerWindow" />
                <input
                  type="number"
                  min={1}
                  className={inputClass}
                  value={answerWindowDays}
                  onChange={(event) => setAnswerWindowDays(event.currentTarget.value)}
                />
              </label>
              <label className="block text-sm font-medium text-ink-strong-secondary">
                <FormattedMessage id="schedule.reminderAfter" />
                <input
                  type="number"
                  min={1}
                  className={inputClass}
                  value={reminderAfterDays}
                  onChange={(event) => setReminderAfterDays(event.currentTarget.value)}
                />
              </label>
              <label className="col-span-2 flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={escalateUnanswered}
                  onChange={(event) => setEscalateUnanswered(event.currentTarget.checked)}
                />
                <FormattedMessage id="schedule.escalate" />
              </label>
            </div>

            {preview !== undefined ? (
              <div className="rounded-inner border border-hairline bg-paper px-3 py-2.5">
                {preview.error ? (
                  <p className="text-sm text-red">
                    <FormattedMessage id="schedule.invalid" />
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted">
                      <FormattedMessage
                        id="schedule.occurrences"
                        values={{ count: preview.dates.length }}
                      />
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5" data-testid="assign-preview">
                      {preview.dates.slice(0, 8).map((entry) => (
                        <li key={entry}>
                          <StatusChip tone="neutral">
                            {intl.formatDate(`${entry}T12:00:00`, {
                              day: 'numeric',
                              month: 'short',
                              year: '2-digit',
                            })}
                          </StatusChip>
                        </li>
                      ))}
                      {preview.dates.length > 8 ? (
                        <li className="self-center text-xs text-muted">
                          +{preview.dates.length - 8}
                        </li>
                      ) : null}
                    </ul>
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {assign.isError ? (
          <p className="mt-3 text-sm text-red" role="alert">
            <FormattedMessage id="assign.failed" />
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onPress={onClose}>
            <FormattedMessage id="common.cancel" />
          </Button>
          <Button isDisabled={!valid || assign.isPending} onPress={() => void assign.mutate()}>
            <FormattedMessage id="assign.confirm" />
          </Button>
        </div>
      </div>
    </div>
  );
}
