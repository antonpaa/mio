import { useMutation } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  addDays,
  expandSchedule,
  formatDate,
  parseDate,
  type ScheduleSegment,
} from '@mio/schedule';
import { Button, StatusChip } from '@mio/ui';

/**
 * T3 recurrence dialog. The SAME expander the server materialises with
 * renders the live preview, so what the clinician sees is what the
 * calendar gets - no client-side reimplementation to drift.
 */

type Mode = 'once' | 'weekly' | 'monthly' | 'phased';
const KINDS = ['visit', 'lab', 'infusion', 'survey', 'other'] as const;

interface PhaseDraft {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: string;
  count: string;
}

const inputClass =
  'mt-1.5 w-full rounded-inner border border-border bg-surface px-3 py-2.5 text-sm text-ink';

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function ScheduleDialog({
  treatmentId,
  onClose,
  onCreated,
}: {
  treatmentId: string;
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const intl = useIntl();
  const [mode, setMode] = useState<Mode>('once');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('visit');
  const [location, setLocation] = useState('');
  const [anchorDate, setAnchorDate] = useState(localToday());
  const [timeOfDay, setTimeOfDay] = useState('');
  const [phases, setPhases] = useState<PhaseDraft[]>([
    { freq: 'monthly', interval: '1', count: '6' },
  ]);
  const [answerWindowDays, setAnswerWindowDays] = useState('7');
  const [reminderAfterDays, setReminderAfterDays] = useState('3');
  const [escalateUnanswered, setEscalateUnanswered] = useState(false);

  // Weekly/Monthly are the phased editor with a single fixed-frequency row.
  const segments: ScheduleSegment[] = useMemo(() => {
    const drafts =
      mode === 'phased'
        ? phases
        : [
            {
              freq: mode === 'weekly' ? ('weekly' as const) : ('monthly' as const),
              interval: phases[0]?.interval ?? '1',
              count: phases[0]?.count ?? '6',
            },
          ];
    return drafts.map((phase) => ({
      freq: phase.freq,
      interval: Math.max(1, Number(phase.interval) || 1),
      count: Math.max(1, Number(phase.count) || 1),
    }));
  }, [mode, phases]);

  const preview = useMemo(() => {
    if (mode === 'once') return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) return { error: true as const, dates: [] };
    try {
      const horizon = formatDate(addDays(parseDate(anchorDate), 365));
      const dates = expandSchedule({ anchorDate, segments }, { to: horizon, max: 400 });
      return { error: dates.length === 0, dates };
    } catch {
      return { error: true as const, dates: [] };
    }
  }, [mode, anchorDate, segments]);

  const create = useMutation({
    mutationFn: async () => {
      const url =
        mode === 'once'
          ? `/api/staff/treatments/${treatmentId}/activities`
          : `/api/staff/treatments/${treatmentId}/schedules`;
      const body =
        mode === 'once'
          ? {
              title,
              kind,
              date: anchorDate,
              ...(location ? { location } : {}),
              ...(timeOfDay ? { timeOfDay } : {}),
            }
          : {
              anchorDate,
              segments,
              payload: {
                title,
                kind,
                ...(location ? { location } : {}),
                ...(timeOfDay ? { timeOfDay } : {}),
              },
              ...(kind === 'survey'
                ? {
                    answerWindowDays: Number(answerWindowDays) || undefined,
                    reminderAfterDays: Number(reminderAfterDays) || undefined,
                    escalateUnanswered,
                  }
                : {}),
            };
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`create: ${response.status}`);
    },
    onSuccess: () => {
      onCreated();
      onClose();
    },
  });

  const valid =
    title.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(anchorDate) &&
    (mode === 'once' || (preview !== undefined && !preview.error));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-card bg-surface p-6 shadow-raised">
        <h2 id="schedule-dialog-title" className="font-display text-lg italic text-ink">
          <FormattedMessage id="schedule.dialogTitle" />
        </h2>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="schedule.repeats" />
          </legend>
          <div
            className="mt-1.5 flex flex-wrap gap-2"
            role="radiogroup"
            aria-label={intl.formatMessage({ id: 'schedule.repeats' })}
          >
            {(['once', 'weekly', 'monthly', 'phased'] as const).map((option) => (
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
                {intl.formatMessage({ id: `schedule.mode.${option}` })}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="col-span-2 block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="schedule.titleLabel" />
            <input
              className={inputClass}
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </label>
          <label className="block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="schedule.kind" />
            <select
              className={inputClass}
              value={kind}
              onChange={(event) => setKind(event.currentTarget.value as (typeof KINDS)[number])}
            >
              {KINDS.map((option) => (
                <option key={option} value={option}>
                  {intl.formatMessage({ id: `activity.kind.${option}` })}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="schedule.location" />
            <input
              className={inputClass}
              value={location}
              onChange={(event) => setLocation(event.currentTarget.value)}
            />
          </label>
          <label className="block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id={mode === 'once' ? 'schedule.date' : 'schedule.starts'} />
            <input
              type="date"
              className={inputClass}
              value={anchorDate}
              onChange={(event) => setAnchorDate(event.currentTarget.value)}
            />
          </label>
          <label className="block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="schedule.time" />
            <input
              type="time"
              className={inputClass}
              value={timeOfDay}
              onChange={(event) => setTimeOfDay(event.currentTarget.value)}
            />
          </label>
        </div>

        {mode !== 'once' ? (
          <div className="mt-4 flex flex-col gap-2">
            {(mode === 'phased' ? phases : phases.slice(0, 1)).map((phase, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-inner border border-hairline bg-paper px-3.5 py-2.5"
              >
                {mode === 'phased' ? (
                  <span className="text-xs font-medium uppercase tracking-wide text-muted">
                    <FormattedMessage id="schedule.phase" values={{ n: index + 1 }} />
                  </span>
                ) : null}
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
                {mode === 'phased' ? (
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
                      <option value="monthly">
                        {intl.formatMessage({ id: 'schedule.months' })}
                      </option>
                    </select>
                  </label>
                ) : (
                  <span className="text-sm text-secondary">
                    <FormattedMessage
                      id={mode === 'weekly' ? 'schedule.weeks' : 'schedule.months'}
                    />
                  </span>
                )}
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
                {mode === 'phased' && phases.length > 1 ? (
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
            {mode === 'phased' ? (
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
            ) : null}
          </div>
        ) : null}

        {mode !== 'once' && kind === 'survey' ? (
          <div className="mt-4 grid grid-cols-2 items-end gap-3">
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
        ) : null}

        {preview !== undefined ? (
          <div className="mt-4 rounded-inner border border-hairline bg-paper px-3 py-2.5">
            {preview.error ? (
              <p className="text-sm text-red">
                <FormattedMessage id="schedule.invalid" />
              </p>
            ) : (
              <>
                <p className="text-sm text-ink">
                  <FormattedMessage
                    id="schedule.next"
                    values={{
                      date: intl.formatDate(`${preview.dates[0] ?? ''}T12:00:00`, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      }),
                    }}
                  />
                </p>
                <p className="mt-1 text-xs text-muted">
                  <FormattedMessage
                    id="schedule.occurrences"
                    values={{ count: preview.dates.length }}
                  />
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="schedule-preview">
                  {preview.dates.slice(0, 8).map((date) => (
                    <li key={date}>
                      <StatusChip tone="neutral">
                        {intl.formatDate(`${date}T12:00:00`, {
                          day: 'numeric',
                          month: 'short',
                          year: '2-digit',
                        })}
                      </StatusChip>
                    </li>
                  ))}
                  {preview.dates.length > 8 ? (
                    <li className="self-center text-xs text-muted">+{preview.dates.length - 8}</li>
                  ) : null}
                </ul>
              </>
            )}
          </div>
        ) : null}

        {create.isError ? (
          <p className="mt-3 text-sm text-red" role="alert">
            <FormattedMessage id="schedule.createFailed" />
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onPress={onClose}>
            <FormattedMessage id="common.cancel" />
          </Button>
          <Button isDisabled={!valid || create.isPending} onPress={() => void create.mutate()}>
            <FormattedMessage id="schedule.create" />
          </Button>
        </div>
      </div>
    </div>
  );
}
