/** LIKE patterns use '!' as the escape character (see the query), so '%', '_' and '!' typed by a user are plain text. */
export function escapeLike(term: string): string {
  return term.replace(/[!%_]/g, (c) => `!${c}`);
}

export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}
