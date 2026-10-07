/**
 * Copied lists go into Discord: escape what Discord would read as formatting,
 * and split anything over a message's 2000 characters into parts, each with
 * the heading (marked "part N of M") and the total on the last.
 * Text shape: heading line, blank line, card lines, total line.
 */
export const DISCORD_LIMIT = 2000;

export const escapeDiscord = (text) => String(text).replace(/([*_~|`])/g, '\\$1');

export function splitForDiscord(text, limit = DISCORD_LIMIT) {
  if (text.length <= limit) return [text];
  const lines = text.split('\n');
  // A heading is a first line followed by a blank one; the surplus trade text
  // has none, and its first card must not be repeated as one.
  const heading = lines.length > 2 && lines[1] === '' ? lines[0] : null;
  const total = lines.at(-1);
  const body = heading === null ? lines.slice(0, -1) : lines.slice(2, -1);
  const label = (i, n) => (heading === null ? `Part ${i} of ${n}` : `${heading} (part ${i} of ${n})`);
  // Room for "<label>\n\n" and, on the last part, "\n<total>".
  const room = limit - label(99, 99).length - 2;
  const chunks = [];
  let current = [];
  let size = 0;
  for (const line of body) {
    if (current.length && size + line.length + 1 > room) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  chunks.push(current);
  // The total must fit on the last part.
  if (size + total.length + 1 > room) chunks.push([]);
  return chunks.map((chunk, i) => {
    const out = [label(i + 1, chunks.length), '', ...chunk];
    if (i === chunks.length - 1) out.push(total);
    return out.join('\n');
  });
}
