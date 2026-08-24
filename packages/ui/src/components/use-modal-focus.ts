import { useCallback, useRef } from 'react';

/**
 * Focus management for the hand-rolled dialogs (WP-31): on open, focus
 * moves INTO the dialog; Tab cycles inside it; on close, focus returns
 * to the element that opened it. React Aria overlays do all of this
 * themselves - this hook gives the plain role="dialog" boxes the same
 * contract (WCAG 2.1.2 no keyboard trap outside, 2.4.3 focus order).
 *
 * Returns a REF CALLBACK - attach it to the dialog BOX (the element
 * holding the fields and buttons). A callback, not an object ref,
 * because every dialog here renders inline behind a condition: the
 * callback fires exactly at open (node) and close (null), which is the
 * whole lifecycle this needs.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useModalFocus<T extends HTMLElement>(): (node: T | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((node: T | null) => {
    if (node === null) {
      cleanup.current?.();
      cleanup.current = null;
      return;
    }
    const opener = document.activeElement as HTMLElement | null;
    node.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const focusables = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', onKeyDown);
    cleanup.current = () => {
      node.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, []);
}
