import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  allQuestions,
  missingTranslations,
  type LocaleBundle,
  type Question,
  type SurveyDefinition,
} from '@mio/survey-schema';
import { Button, ConfirmDialog, ErrorState, Skeleton, StatusChip } from '@mio/ui';
import { QuestionCard, type QuestionText } from './question-card.js';
import { TrendRulesPanel } from './trend-rules.js';
import { PreviewDialog } from './preview-dialog.js';

/**
 * The survey builder (B2/B4/B5/B6): edits ONE version. Drafts save;
 * publishing freezes the version forever - stated in the UI, enforced by
 * the service and the storage trigger. Structure is language-neutral; the
 * language tabs edit the per-locale text over the same ids.
 */

interface VersionPayload {
  id: string;
  survey_id: string;
  version: number;
  state: 'draft' | 'published' | 'archived';
  definition: SurveyDefinition;
  locales: LocaleBundle[];
  name: string;
  kind: string;
  licensed_source: string | null;
}

type Locale = 'en' | 'fi' | 'sv';

function updateInTree(questions: Question[], id: string, next: Question | null): Question[] {
  const out: Question[] = [];
  for (const question of questions) {
    if (question.id === id) {
      if (next) out.push(next);
      continue;
    }
    const followUps = question.followUps ? updateInTree(question.followUps, id, next) : undefined;
    out.push({
      ...question,
      ...(followUps && followUps.length > 0 ? { followUps } : {}),
      ...(followUps && followUps.length === 0 ? {} : {}),
    });
    if (followUps && followUps.length === 0) delete (out[out.length - 1] as Question).followUps;
  }
  return out;
}

export function SurveyBuilderPage(): ReactElement {
  const { versionId } = useParams({ strict: false }) as { versionId: string };
  const payload = useQuery({
    queryKey: ['builder', versionId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/surveys/versions/${versionId}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`version: ${response.status}`);
      return (await response.json()) as VersionPayload;
    },
    retry: false,
    staleTime: Infinity,
  });
  if (payload.isPending) {
    return (
      <div className="flex flex-col gap-3 pt-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (payload.isError) return <ErrorState onRetry={() => void payload.refetch()} />;
  return <BuilderFrame initial={payload.data} versionId={versionId} />;
}

function BuilderFrame({
  initial,
  versionId,
}: {
  initial: VersionPayload;
  versionId: string;
}): ReactElement {
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [definition, setDefinition] = useState<SurveyDefinition>(initial.definition);
  const [locales, setLocales] = useState<LocaleBundle[]>(initial.locales);
  const [activeLocale, setActiveLocale] = useState<Locale>('en');
  const [activePage, setActivePage] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState<'publish' | 'archive' | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const readOnly = initial.state !== 'draft' || initial.licensed_source !== null;
  const bundle = locales.find((entry) => entry.locale === activeLocale)!;
  const page = definition.pages[Math.min(activePage, definition.pages.length - 1)];
  const ordered = allQuestions(definition);

  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/staff/surveys/versions/${versionId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ definition, locales }),
      });
      if (!response.ok) throw new Error(`save: ${response.status}`);
    },
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['survey-catalog'] });
    },
  });
  const transition = useMutation({
    mutationFn: async (verb: 'publish' | 'archive') => {
      const response = await fetch(`/api/staff/surveys/versions/${versionId}/${verb}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: '{}',
      });
      if (!response.ok) throw new Error(`${verb}: ${response.status}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['builder', versionId] });
      await queryClient.invalidateQueries({ queryKey: ['survey-catalog'] });
      await navigate({ to: '/surveys' });
    },
  });

  const patchDefinition = (next: SurveyDefinition): void => {
    setDefinition(next);
    setDirty(true);
  };
  const patchQuestionText = (questionId: string, next: QuestionText): void => {
    setLocales(
      locales.map((entry) =>
        entry.locale === activeLocale
          ? { ...entry, questions: { ...entry.questions, [questionId]: next } }
          : entry,
      ),
    );
    setDirty(true);
  };
  const nextId = (): string => {
    let n = 1;
    const ids = new Set(ordered.map((question) => question.id));
    while (ids.has(`q-${n}`)) n += 1;
    return `q-${n}`;
  };
  // rule ids are unique across the WHOLE survey - question rules and
  // trend rules share the namespace, so a trace names its rule
  // unambiguously
  const nextRuleId = (): string => {
    const ids = new Set([
      ...ordered.flatMap((question) => (question.rules ?? []).map((rule) => rule.id)),
      ...(definition.trendRules ?? []).map((rule) => rule.id),
    ]);
    let n = 1;
    while (ids.has(`r-${n}`)) n += 1;
    return `r-${n}`;
  };

  const renderTree = (questions: Question[], depth: number): ReactElement[] =>
    questions.flatMap((question) => {
      const index = ordered.findIndex((entry) => entry.id === question.id);
      const earlier = ordered.slice(0, index);
      const card = (
        <QuestionCard
          key={question.id}
          question={question}
          text={bundle.questions[question.id]}
          earlier={earlier}
          earlierTextOf={(id) => bundle.questions[id]}
          depth={depth}
          nextId={nextId}
          nextRuleId={nextRuleId}
          onChange={(next) =>
            patchDefinition({
              ...definition,
              pages: definition.pages.map((entry) => ({
                ...entry,
                questions: updateInTree(entry.questions, question.id, next),
              })),
            })
          }
          onChangeText={(next) => patchQuestionText(question.id, next)}
          onRemove={() =>
            patchDefinition({
              ...definition,
              pages: definition.pages.map((entry) => ({
                ...entry,
                questions: updateInTree(entry.questions, question.id, null),
              })),
            })
          }
        />
      );
      return [card, ...renderTree(question.followUps ?? [], depth + 1)];
    });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl italic text-ink">{initial.name}</h1>
        <StatusChip
          tone={
            initial.state === 'published'
              ? 'teal'
              : initial.state === 'archived'
                ? 'red'
                : 'neutral'
          }
        >
          {`v${initial.version} · ${intl.formatMessage({ id: `catalog.state.${initial.state}` })}`}
        </StatusChip>
        {initial.licensed_source ? (
          <StatusChip tone="amber">{intl.formatMessage({ id: 'assign.licensed' })}</StatusChip>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button variant="quiet" size="sm" onPress={() => setPreviewOpen(true)}>
            <FormattedMessage id="builder.preview" />
          </Button>
          {!readOnly ? (
            <>
              <Button
                size="sm"
                isDisabled={!dirty || save.isPending}
                onPress={() => void save.mutate()}
              >
                <FormattedMessage id={dirty ? 'builder.save' : 'builder.saved'} />
              </Button>
              <Button
                variant="quiet"
                size="sm"
                isDisabled={dirty || transition.isPending}
                onPress={() => setConfirming('publish')}
              >
                <FormattedMessage id="builder.publish" />
              </Button>
            </>
          ) : null}
          {initial.state !== 'archived' ? (
            <Button
              variant="danger"
              size="sm"
              isDisabled={transition.isPending}
              onPress={() => setConfirming('archive')}
            >
              <FormattedMessage id="builder.archive" />
            </Button>
          ) : null}
        </div>
      </header>

      {readOnly ? (
        <p className="rounded-inner bg-amber-tint px-3 py-2.5 text-sm text-ink">
          <FormattedMessage
            id={initial.licensed_source ? 'builder.licensedReadOnly' : 'builder.publishedReadOnly'}
          />
        </p>
      ) : null}
      {save.isError ? (
        <p role="alert" className="rounded-inner bg-red-tint px-3 py-2 text-sm text-red">
          <FormattedMessage id="builder.saveFailed" />
        </p>
      ) : null}
      {transition.isError ? (
        <p role="alert" className="rounded-inner bg-red-tint px-3 py-2 text-sm text-red">
          <FormattedMessage id="builder.publishFailed" />
        </p>
      ) : null}

      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label={intl.formatMessage({ id: 'assign.language' })}
      >
        {(['en', 'fi', 'sv'] as const).map((locale) => {
          const entry = locales.find((candidate) => candidate.locale === locale)!;
          const missing =
            missingTranslations(definition, entry).length + (entry.title.trim() === '' ? 1 : 0);
          return (
            <button
              key={locale}
              type="button"
              role="tab"
              aria-selected={activeLocale === locale}
              onClick={() => setActiveLocale(locale)}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                activeLocale === locale
                  ? 'border-teal bg-teal-tint font-medium text-teal'
                  : 'border-border bg-surface text-secondary hover:bg-surface-sunken hover:text-ink'
              }`}
            >
              {locale.toUpperCase()}
              {missing > 0 ? <span className="ml-1 text-xs text-red">*{missing}</span> : null}
            </button>
          );
        })}
      </div>

      <label className="block max-w-md text-sm font-medium text-ink-strong-secondary">
        <FormattedMessage id="builder.titleIn" values={{ locale: activeLocale.toUpperCase() }} />
        <input
          className="mt-1.5 w-full rounded-inner border border-border bg-surface px-3 py-2.5 text-sm text-ink"
          value={bundle.title}
          readOnly={readOnly}
          onChange={(event) => {
            setLocales(
              locales.map((entry) =>
                entry.locale === activeLocale
                  ? { ...entry, title: event.currentTarget.value }
                  : entry,
              ),
            );
            setDirty(true);
          }}
        />
      </label>

      {definition.pages.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          {definition.pages.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setActivePage(index)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                index === activePage
                  ? 'border-teal bg-teal-tint font-medium text-teal'
                  : 'border-border bg-surface text-secondary hover:bg-surface-sunken'
              }`}
            >
              <FormattedMessage id="builder.page" values={{ n: index + 1 }} />
            </button>
          ))}
        </div>
      ) : null}

      <div className={`flex flex-col gap-3 ${readOnly ? 'pointer-events-none opacity-60' : ''}`}>
        {page ? renderTree(page.questions, 0) : null}
        <TrendRulesPanel
          questions={ordered}
          rules={definition.trendRules ?? []}
          bundle={bundle}
          nextRuleId={nextRuleId}
          onChangeRules={(trendRules) => {
            const next: SurveyDefinition = { ...definition };
            if (trendRules.length > 0) next.trendRules = trendRules;
            else delete next.trendRules;
            patchDefinition(next);
          }}
          onChangeRuleText={(ruleId, partial) => {
            setLocales(
              locales.map((entry) => {
                if (entry.locale !== activeLocale) return entry;
                const current = entry.rules?.[ruleId] ?? {};
                const merged = { ...current, ...partial };
                const cleaned = Object.fromEntries(
                  Object.entries(merged).filter(([, value]) => value !== undefined),
                );
                return { ...entry, rules: { ...entry.rules, [ruleId]: cleaned } };
              }),
            );
            setDirty(true);
          }}
        />
      </div>

      {!readOnly ? (
        <div className="flex gap-2">
          <Button
            variant="quiet"
            size="sm"
            onPress={() => {
              if (!page) return;
              patchDefinition({
                ...definition,
                pages: definition.pages.map((entry, index) =>
                  index === activePage
                    ? {
                        ...entry,
                        questions: [
                          ...entry.questions,
                          { id: nextId(), type: 'choice_single', options: [{ id: 'o-1' }] },
                        ],
                      }
                    : entry,
                ),
              });
            }}
          >
            <FormattedMessage id="builder.addQuestion" />
          </Button>
          <Button
            variant="quiet"
            size="sm"
            onPress={() => {
              let n = definition.pages.length + 1;
              while (definition.pages.some((entry) => entry.id === `page-${n}`)) n += 1;
              patchDefinition({
                ...definition,
                pages: [...definition.pages, { id: `page-${n}`, questions: [] }],
              });
              setActivePage(definition.pages.length);
            }}
          >
            <FormattedMessage id="builder.addPage" />
          </Button>
        </div>
      ) : null}

      {confirming !== null ? (
        <ConfirmDialog
          title={intl.formatMessage({ id: `builder.confirm.${confirming}.title` })}
          cancelLabel={intl.formatMessage({ id: 'confirm.keep' })}
          confirmLabel={intl.formatMessage({ id: `builder.${confirming}` })}
          danger={confirming === 'archive'}
          busy={transition.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            transition.mutate(confirming, { onSettled: () => setConfirming(null) });
          }}
        >
          <FormattedMessage id={`builder.confirm.${confirming}.body`} />
        </ConfirmDialog>
      ) : null}

      {previewOpen ? (
        <PreviewDialog
          definition={definition}
          bundle={bundle}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  );
}
