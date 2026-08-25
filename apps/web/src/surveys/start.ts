import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

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
