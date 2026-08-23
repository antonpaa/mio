import type { ReactElement } from 'react';

/**
 * Placeholder for the L0 launch screen. The designed splash (breathing mark,
 * "Opening your care space...") arrives with the UI kit in WP-03 and the
 * login flow in WP-08.
 */
export function Splash(): ReactElement {
  return (
    <main>
      <h1>mio</h1>
      <p>Care, together.</p>
    </main>
  );
}
