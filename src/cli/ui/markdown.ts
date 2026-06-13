/**
 * @module cli/ui/markdown
 * Markdown-to-terminal rendering for CLI text.
 */

import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

// @ts-expect-error marked-terminal has not caught up with marked v16 renderer types.
marked.use({ renderer: new TerminalRenderer({ showSectionPrefix: false, tab: 2 }) });

/** Render Markdown text for terminal display. */
export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}
