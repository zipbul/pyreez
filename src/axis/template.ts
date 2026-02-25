/**
 * Simple template engine for deliberation prompts.
 * Replaces {{variable}} placeholders with values from a vars object.
 * Missing variables keep their placeholder unchanged.
 */

/**
 * Render a template string by replacing {{key}} placeholders with values.
 *
 * @param template - Template string containing {{key}} placeholders
 * @param vars - Key-value pairs for substitution
 * @returns Rendered string
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return vars[key] ?? match;
  });
}
