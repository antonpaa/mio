import axe from 'axe-core';

/**
 * Run axe on a rendered container and return violation summaries.
 * color-contrast is disabled: it needs real layout and canvas, which jsdom
 * does not provide - contrast is covered by the manual passes WP-31 owns
 * (automated tooling catches ~40% of WCAG; the docs say so and mean it).
 */
export async function axeViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} [${violation.nodes.map((n) => n.target.join(' ')).join('; ')}]`,
  );
}
