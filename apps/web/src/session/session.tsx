import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage } from 'react-intl';
import { Button } from '@mio/ui';
import { logout as apiLogout, whoami, type Realm, type SessionAccount } from '../lib/api.js';

export interface SessionState {
  loading: boolean;
  realm: Realm | null;
  account: SessionAccount | null;
  refresh: () => Promise<void>;
  /** Seed the session synchronously from a sign-in response - the cache
   * update lands in the same React batch as the follow-up navigation, so
   * the landing page never sees a stale signed-out state. */
  establish: (realm: Realm, account: SessionAccount) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}

/** Warn two minutes before the shortest idle window (staff: 15 min). */
const WARN_AFTER_MS = 13 * 60_000;

/** Shared between the provider's hook and the router's beforeLoad gate. */
export const SESSION_QUERY = {
  queryKey: ['session'] as const,
  queryFn: whoami,
  staleTime: 60_000,
  retry: false,
} as const;

export function SessionProvider({ children }: { children: ReactNode }): ReactElement {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery(SESSION_QUERY);
  const [warning, setWarning] = useState(false);
  const lastActivity = useRef(0);

  const account = sessionQuery.data?.account ?? null;
  const realm = sessionQuery.data?.realm ?? null;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['session'] });
    await sessionQuery.refetch();
  }, [queryClient, sessionQuery]);

  const establish = useCallback(
    (nextRealm: Realm, nextAccount: SessionAccount) => {
      queryClient.setQueryData(['session'], { realm: nextRealm, account: nextAccount });
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    if (realm) await apiLogout(realm);
    setWarning(false);
    queryClient.setQueryData(['session'], null);
  }, [realm, queryClient]);

  // S2: activity tracking -> warning dialog; "stay signed in" refetches,
  // which slides the idle window server-side.
  useEffect(() => {
    if (!account) return;
    lastActivity.current = performance.timeOrigin + performance.now();
    const markActivity = (): void => {
      lastActivity.current = performance.timeOrigin + performance.now();
    };
    const events = ['pointerdown', 'keydown'] as const;
    for (const event of events) window.addEventListener(event, markActivity);
    const timer = window.setInterval(() => {
      const now = performance.timeOrigin + performance.now();
      if (now - lastActivity.current > WARN_AFTER_MS) setWarning(true);
    }, 30_000);
    return () => {
      for (const event of events) window.removeEventListener(event, markActivity);
      window.clearInterval(timer);
    };
  }, [account]);

  const stay = useCallback(async () => {
    lastActivity.current = performance.timeOrigin + performance.now();
    setWarning(false);
    await refresh();
  }, [refresh]);

  const value = useMemo<SessionState>(
    () => ({ loading: sessionQuery.isPending, realm, account, refresh, establish, signOut }),
    [sessionQuery.isPending, realm, account, refresh, establish, signOut],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {warning && account ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="timeout-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
        >
          <div className="w-full max-w-sm rounded-card bg-surface p-6 shadow-raised">
            <h2 id="timeout-title" className="font-display text-lg italic text-ink">
              <FormattedMessage id="session.timeoutTitle" />
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              <FormattedMessage id="session.timeoutBody" />
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="quiet" onPress={() => void signOut()}>
                <FormattedMessage id="session.signOutNow" />
              </Button>
              <Button onPress={() => void stay()}>
                <FormattedMessage id="session.stay" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </SessionContext.Provider>
  );
}
