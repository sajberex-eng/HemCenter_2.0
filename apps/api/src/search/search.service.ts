import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SEARCH_MIN_LENGTH, SEARCH_PAGE_SIZE, type MessageDto } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { REPLY_INCLUDE, toMessageDto } from '../chats/mappers';
import { escapeLike, normalizeQuery } from './search-rules';

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly log = new Logger(SearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Search is case-insensitive only if the database knows Cyrillic and Kazakh letters (a UTF-8 locale). */
  async onModuleInit() {
    try {
      const [r] = await this.prisma.$queryRaw<{ ok: boolean }[]>`SELECT ('Қазақ Жұмыс' ILIKE 'қазақ жұмыс') AS ok`;
      if (!r?.ok) this.log.warn('The database ignores case for Cyrillic only in a UTF-8 locale: search for "приказ" will not find "Приказ". Create the database with a UTF-8 locale (e.g. en_US.UTF-8).');
    } catch {
      /* the check itself must never stop the server */
    }
  }

  /**
   * Messages the caller may read that contain the text (any substring, case-insensitive), match a Russian word form
   * ("приказ" finds "приказы"), or carry a file whose name contains it. Visibility comes from the membership join,
   * so other people's chats can never appear, whatever is typed.
   */
  async messages(userId: string, rawQuery: string, opts: { chatId?: string; offset?: number } = {}): Promise<{ hits: MessageDto[]; hasMore: boolean }> {
    const term = normalizeQuery(rawQuery);
    if (term.length < SEARCH_MIN_LENGTH) throw new BadRequestException('QUERY_TOO_SHORT');
    if (term.length > 100) throw new BadRequestException('QUERY_TOO_LONG');
    const like = `%${escapeLike(term)}%`;
    const limit = SEARCH_PAGE_SIZE;
    const offset = Math.max(opts.offset ?? 0, 0);

    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT m.id
      FROM "Message" m
      JOIN "ChatMember" cm ON cm."chatId" = m."chatId" AND cm."userId" = ${userId}
      WHERE m."deletedAt" IS NULL
        ${opts.chatId ? Prisma.sql`AND m."chatId" = ${opts.chatId}` : Prisma.empty}
        AND (
          m.body ILIKE ${like} ESCAPE '!'
          OR to_tsvector('russian', COALESCE(m.body, '')) @@ plainto_tsquery('russian', ${term})
          OR EXISTS (SELECT 1 FROM "Attachment" a WHERE a."messageId" = m.id AND a."deletedAt" IS NULL AND a.name ILIKE ${like} ESCAPE '!')
        )
      ORDER BY m."createdAt" DESC, m.id DESC
      LIMIT ${limit + 1} OFFSET ${offset}`);

    const hasMore = rows.length > limit;
    const ids = rows.slice(0, limit).map((r) => r.id);
    if (ids.length === 0) return { hits: [], hasMore: false };
    const found = await this.prisma.message.findMany({ where: { id: { in: ids } }, include: REPLY_INCLUDE });
    const order = new Map(ids.map((id, i) => [id, i]));
    return { hits: found.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map(toMessageDto), hasMore };
  }
}
