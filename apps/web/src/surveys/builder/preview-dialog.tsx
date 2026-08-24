import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  evaluateResponse,
  progressOf,
  visibleQuestions,
  type Answers,
  type LocaleBundle,
  type SurveyDefinition,
} from '@mio/survey-schema';
import { Button, SeverityChip, useModalFocus } from '@mio/ui';
import { QuestionInput } from '../fill.js';

/**
 * Builder preview: the ACTUAL fill inputs driven by the ACTUAL engine -
 * answering reveals follow-ups exactly as the patient will see them, and
 * the verdict strip runs the SAME rule evaluator the server runs on
 * submit. Staff surface only: patients never see rules or severities.
 */
export function PreviewDialog({
  definition,
  bundle,
  onClose,
}: {
  definition: SurveyDefinition;
  bundle: LocaleBundle;
  onClose: () => void;
}): ReactElement {
  const modalRef = useModalFocus<HTMLDivElement>();
  const intl = useIntl();
  const [answers, setAnswers] = useState<Answers>({});
  const visible = visibleQuestions(definition, answers);
  const progress = progressOf(definition, answers);
  const evaluation = evaluateResponse(definition, answers);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        ref={modalRef}
        className="flex max-h-full w-full max-w-lg flex-col rounded-card bg-surface shadow-raised"
      >
        <header className="flex items-baseline justify-between border-b border-hairline px-6 py-4">
          <h2 id="preview-title" className="font-display text-lg italic text-ink">
            <FormattedMessage id="builder.previewTitle" values={{ title: bundle.title }} />
          </h2>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="surveys.progressLabel"
              values={{ answered: progress.answered, total: progress.total }}
            />
          </p>
        </header>
        <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5">
          {visible.length === 0 ? (
            <p className="text-sm text-muted">
              <FormattedMessage id="builder.previewEmpty" />
            </p>
          ) : (
            visible.map((question) => {
              const text = bundle.questions[question.id];
              return (
                <section key={question.id}>
                  <h3 className="text-sm font-medium text-ink">
                    {text?.label || question.id}
                    {question.required !== true ? (
                      <span className="ml-2 text-xs font-normal text-muted">
                        {intl.formatMessage({ id: 'surveys.optional' })}
                      </span>
                    ) : null}
                  </h3>
                  {text?.description ? (
                    <p className="mt-0.5 text-xs text-secondary">{text.description}</p>
                  ) : null}
                  <div className="mt-2">
                    <QuestionInput
                      question={question}
                      text={text}
                      value={answers[question.id]}
                      onChange={(next) => setAnswers({ ...answers, [question.id]: next })}
                    />
                  </div>
                </section>
              );
            })
          )}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-hairline px-6 py-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {evaluation.severity !== null ? (
              <>
                <SeverityChip
                  severity={evaluation.severity}
                  label={intl.formatMessage({ id: `severity.${evaluation.severity}` })}
                />
                <span className="text-secondary">
                  <FormattedMessage
                    id="builder.previewWouldAlert"
                    values={{ count: evaluation.fired.length }}
                  />
                </span>
              </>
            ) : evaluation.fired.length > 0 ? (
              <span className="text-secondary">
                <FormattedMessage
                  id="builder.previewRecorded"
                  values={{ count: evaluation.fired.length }}
                />
              </span>
            ) : (
              <span className="text-muted">
                <FormattedMessage id="builder.previewNoRules" />
              </span>
            )}
          </div>
          <Button variant="quiet" onPress={onClose}>
            <FormattedMessage id="builder.closePreview" />
          </Button>
        </footer>
      </div>
    </div>
  );
}
