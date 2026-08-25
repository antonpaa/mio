import { useState, type ReactElement } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, ErrorState, Skeleton, useModalFocus } from '@mio/ui';
import { SurveyFillScreen } from './fill.js';

/**
 * On-behalf survey entry (PP "Report" -> "Fill a survey"): the clinician
 * records answers the patient gave by phone or in clinic. The screen is
 * the patient's own fill screen - same questions, same order, same
 * validation - under a banner that never lets the clinician forget whose
 * answers these are. Provenance is the server's job; saying so plainly
 * is this component's.
 */

interface FillableOption {
  activity_id: string | null;
  treatment_id: string;
  survey_id: string;
  survey_name: string;
  treatment_name: string;
  due_date: string | null;
  draft_id: string | null;
}

export function FillOnBehalfButton({ patientId }: { patientId: string }): ReactElement {
  const intl = useIntl();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const modalRef = useModalFocus<HTMLDivElement>();
  const [choice, setChoice] = useState('');

  const options = useQuery({
    queryKey: ['fillable', patientId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/patients/${patientId}/fillable`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`fillable: ${response.status}`);
      return (await response.json()) as FillableOption[];
    },
    enabled: open,
    retry: false,
  });

  const start = useMutation({
    mutationFn: async () => {
      const picked = (options.data ?? [])[Number(choice)];
      if (!picked) throw new Error('no option picked');
      const response = await fetch(`/api/staff/patients/${patientId}/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          treatmentId: picked.treatment_id,
          surveyId: picked.survey_id,
          ...(picked.activity_id !== null ? { activityId: picked.activity_id } : {}),
        }),
      });
      if (!response.ok) throw new Error(`start: ${response.status}`);
      return (await response.json()) as { responseId: string };
    },
    onSuccess: (result) => {
      setOpen(false);
      void navigate({
        to: '/patients/$patientId/fill/$responseId',
        params: { patientId, responseId: result.responseId },
      });
    },
  });

  const label = (option: FillableOption): string =>
    option.activity_id !== null && option.due_date !== null
      ? intl.formatMessage(
          { id: 'onBehalf.optionDue' },
          {
            survey: option.survey_name,
            date: intl.formatDate(option.due_date, { day: 'numeric', month: 'short' }),
          },
        )
      : intl.formatMessage(
          { id: 'onBehalf.optionAdHoc' },
          { survey: option.survey_name, program: option.treatment_name },
        );

  return (
    <>
      <Button size="sm" variant="quiet" onPress={() => setOpen(true)}>
        <FormattedMessage id="onBehalf.fillSurvey" />
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="fill-on-behalf-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <div ref={modalRef} className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
            <h2 id="fill-on-behalf-title" className="font-display text-lg italic text-ink">
              <FormattedMessage id="onBehalf.fillSurvey" />
            </h2>
            <p className="mt-1 text-xs text-muted">
              <FormattedMessage id="onBehalf.dialogNote" />
            </p>
            {options.isPending ? (
              <Skeleton className="mt-4 h-24 w-full" />
            ) : options.isError ? (
              <ErrorState onRetry={() => void options.refetch()} />
            ) : options.data.length === 0 ? (
              <p className="mt-4 text-sm text-secondary">
                <FormattedMessage id="onBehalf.noneFillable" />
              </p>
            ) : (
              <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
                <FormattedMessage id="onBehalf.pickSurvey" />
                <select
                  className="mt-1 w-full rounded-inner border border-border bg-surface px-3 py-2 text-sm text-ink"
                  value={choice}
                  onChange={(event) => setChoice(event.currentTarget.value)}
                >
                  <option value="" />
                  {options.data.map((option, index) => (
                    <option
                      key={`${option.treatment_id}:${option.activity_id ?? option.survey_id}`}
                      value={String(index)}
                    >
                      {label(option)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="quiet" onPress={() => setOpen(false)}>
                <FormattedMessage id="common.cancel" />
              </Button>
              <Button
                isDisabled={choice === '' || start.isPending}
                onPress={() => void start.mutate()}
              >
                <FormattedMessage id="onBehalf.begin" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** The on-behalf fill page: the patient's fill screen, under a banner. */
export function OnBehalfFillPage(): ReactElement {
  const navigate = useNavigate();
  const { patientId, responseId } = useParams({ strict: false }) as {
    patientId: string;
    responseId: string;
  };
  const back = (): void => {
    void navigate({ to: '/patients/$patientId', params: { patientId } });
  };
  return (
    <SurveyFillScreen
      responseId={responseId}
      transport={{
        loadUrl: `/api/staff/responses/${responseId}/fill`,
        saveUrl: `/api/staff/responses/${responseId}/answers`,
        submitUrl: `/api/staff/responses/${responseId}/submit`,
        onSubmitted: back,
        onSaveExit: back,
      }}
      banner={
        <div className="mx-auto mb-4 max-w-xl rounded-card border border-amber-chip-border bg-amber-tint px-4 py-3">
          <p className="text-sm font-medium text-ink">
            <FormattedMessage id="onBehalf.bannerTitle" />
          </p>
          <p className="mt-0.5 text-xs text-secondary">
            <FormattedMessage id="onBehalf.bannerBody" />
          </p>
        </div>
      }
    />
  );
}
