export interface OversightChat {
  id: string;
  type: 'DIRECT' | 'GROUP' | 'ARCHIVE';
  title: string | null;
  lastMessageAt: string | null;
  members: { userId: string; fullName: string }[];
}

/** A group is named by its title; a direct chat by the two people in it. */
export const oversightTitle = (c: { type: string; title: string | null; members: { fullName: string }[] }, untitled: string) =>
  c.type !== 'DIRECT' ? c.title ?? untitled : c.members.map((m) => m.fullName).join(' — ') || untitled;
