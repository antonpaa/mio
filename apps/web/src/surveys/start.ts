import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

/** The shared surveys disclosure (one key with P1 and P3): the shell's
 * nav badge reads the due count from the same cache, staleTime-bounded
 * like the messages badge. */
export const PATIENT_SURVEYS_QUERY = {
  queryKey: ['patient-surveys'] as const,
  queryFn: async (): Promise<{ due: unknown[]; drafts: unknown[] }> => {
    const response = await fetch('/api/patient/surveys', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`surveys: ${response.status}`);
    return (await response.json()) as { due: unknown[]; drafts: unknown[] };
  },
  staleTime: 60_000,
  retry: false,
};

/** Start (or resume) the fill for a due survey occurrence and land in
 * P4 - shared by the P3 due list and the landing's Action needed card,
 * so "Start" means the same thing wherever it appears. */
export function useFillOccurrence(): ReturnType<
  typeof useMutation<{ responseId: string }, Error, string>
> {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (activityId: string) => {
      const response = await fetch(`/api/patient/activities/${activityId}/fill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: '{}',
      });
      if (!response.ok) throw new Error(`fill: ${response.status}`);
      return (await response.json()) as { responseId: string };
    },
    onSuccess: (data) =>
      void navigate({ to: '/surveys/fill/$responseId', params: { responseId: data.responseId } }),
  });
}
