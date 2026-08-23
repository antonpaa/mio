/**
 * Shared API contract types. From WP-06 onward this package is generated
 * OpenAPI-first (ADR-0004); until then it holds the hand-written seed types
 * that keep client and server honest about the same shapes.
 */

export const HEALTH_PATH = '/health' as const;

export interface HealthResponse {
  status: 'ok';
  /** ISO-8601 instant the API produced the response. */
  time: string;
}
