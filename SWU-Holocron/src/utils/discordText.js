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
  const heading = lines[0];
  const total = lines.at(-1);
  const body = lines.slice(1, -1).filter((l, i) => !(i === 0 && l === ''));
  // Room for "<heading> (part NN of NN)\n\n" and, on the last part, "\n<total>".
  const room = limit - heading.length - ' (part 99 of 99)'.length - 2;
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
    const out = [`${heading} (part ${i + 1} of ${chunks.length})`, '', ...chunk];
    if (i === chunks.length - 1) out.push(total);
    return out.join('\n');
  });
}
