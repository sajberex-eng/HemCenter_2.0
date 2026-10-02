import type { Locale } from '@hemcenter/shared';
import { buildDocx, type Para } from './docx-builder';

/** The kinds that come with the system. The secretary may add more and rename these. */
export const DEFAULT_KINDS = [
  { code: 'PROTOCOL', nameRu: 'Протокол совещания', nameKk: 'Кеңес хаттамасы', prefix: 'П' },
  { code: 'ORDER', nameRu: 'Приказ по основной деятельности', nameKk: 'Негізгі қызмет бойынша бұйрық', prefix: 'ПР' },
  { code: 'MEMO', nameRu: 'Служебная записка', nameKk: 'Қызметтік хат', prefix: 'СЗ' },
  { code: 'DIRECTIVE', nameRu: 'Распоряжение', nameKk: 'Өкім', prefix: 'Р' },
] as const;
export type DefaultKindCode = (typeof DEFAULT_KINDS)[number]['code'];

const L = (text: string): Para => ({ text });
const H = (text: string): Para => ({ text, bold: true, align: 'center', after: 10 });
const loop = (name: string) => L(`{#${name}}`);
const end = (name: string) => L(`{/${name}}`);
const approvalSheet = (title: string): Para[] => [
  loop('hasApprovals'),
  { text: title, bold: true, align: 'left', after: 6 },
  loop('approvals'),
  { text: `{n}. {name} — {result}, {at}. {comment}`, size: 11, after: 2 },
  end('approvals'),
  end('hasApprovals'),
];

type Texts = {
  protocol: string;
  order: string;
  memo: string;
  directive: string;
  no: string;
  from: string;
  chair: string;
  secretary: string;
  present: string;
  agenda: string;
  decided: string;
  assign: string;
  responsible: string;
  due: string;
  command: string;
  control: string;
  to: string;
  author: string;
  signature: string;
  sheet: string;
};

const TEXT: Record<Locale, Texts> = {
  ru: {
    protocol: 'ПРОТОКОЛ', order: 'ПРИКАЗ', memo: 'СЛУЖЕБНАЯ ЗАПИСКА', directive: 'РАСПОРЯЖЕНИЕ',
    no: '№', from: 'от', chair: 'Председатель', secretary: 'Секретарь', present: 'Присутствовали:', agenda: 'Повестка дня:',
    decided: 'РЕШИЛИ:', assign: 'ПОРУЧИТЬ:', responsible: 'ответственный', due: 'срок', command: 'ПРИКАЗЫВАЮ:',
    control: 'Контроль за исполнением настоящего документа оставляю за собой.', to: 'Кому:', author: 'От:', signature: 'Подпись',
    sheet: 'Лист согласования',
  },
  kk: {
    protocol: 'ХАТТАМА', order: 'БҰЙРЫҚ', memo: 'ҚЫЗМЕТТІК ХАТ', directive: 'ӨКІМ',
    no: '№', from: 'күні', chair: 'Төраға', secretary: 'Хатшы', present: 'Қатысқандар:', agenda: 'Күн тәртібі:',
    decided: 'ШЕШТІК:', assign: 'ТАПСЫРУ:', responsible: 'жауапты', due: 'мерзімі', command: 'БҰЙЫРАМЫН:',
    control: 'Осы құжаттың орындалуын бақылауды өзіме қалдырамын.', to: 'Кімге:', author: 'Кімнен:', signature: 'Қолы',
    sheet: 'Келісу парағы',
  },
};

function itemsBlock(t: Texts, heading: string | null): Para[] {
  return [
    loop('hasItems'),
    ...(heading ? [{ text: heading, bold: true, after: 4 } as Para] : []),
    loop('items'),
    { text: `{n}. {text} (${t.responsible}: {responsible}; ${t.due}: {due})`, align: 'both' as const },
    end('items'),
    end('hasItems'),
  ];
}

function header(t: Texts, name: string): Para[] {
  return [
    H('{org}'),
    H(`${name} ${t.no} {number}`),
    { text: `${t.from} {date}`, align: 'center', after: 10 },
    { text: '{title}', bold: true, align: 'center', after: 12 },
  ];
}

export function buildDefaultTemplate(code: DefaultKindCode, lang: Locale): Buffer {
  const t = TEXT[lang];
  let body: Para[];
  switch (code) {
    case 'PROTOCOL':
      body = [
        ...header(t, t.protocol),
        { text: `${t.chair}: {chair}`, after: 2 },
        { text: `${t.secretary}: {secretary}`, after: 8 },
        loop('hasParticipants'), { text: t.present, bold: true, after: 2 }, loop('participants'), L('{n}. {name}'), end('participants'), end('hasParticipants'),
        loop('hasAgenda'), { text: t.agenda, bold: true, after: 2 }, loop('agenda'), L('{n}. {text}'), end('agenda'), end('hasAgenda'),
        loop('hasBody'), { text: '{body}', align: 'both' }, end('hasBody'),
        loop('hasDecisions'), { text: t.decided, bold: true, after: 2 }, loop('decisions'), { text: '{n}. {text}', align: 'both' }, end('decisions'), end('hasDecisions'),
        ...itemsBlock(t, t.assign),
        { text: `${t.chair}: {chair}        ${t.signature}: ____________`, after: 4 },
        { text: `${t.secretary}: {secretary}        ${t.signature}: ____________`, after: 12 },
        ...approvalSheet(t.sheet),
      ];
      break;
    case 'MEMO':
      body = [
        { text: '{org}', bold: true, align: 'left', after: 10 },
        { text: `${t.to} {recipient}`, align: 'right', after: 2 },
        { text: `${t.author} {author}`, align: 'right', after: 14 },
        H(`${t.memo}`),
        { text: `${t.no} {number} ${t.from} {date}`, align: 'center', after: 8 },
        { text: '{title}', bold: true, align: 'center', after: 12 },
        loop('hasPreamble'), { text: '{preamble}', align: 'both' }, end('hasPreamble'),
        loop('hasBody'), { text: '{body}', align: 'both' }, end('hasBody'),
        ...itemsBlock(t, null),
        { text: `{author}        ${t.signature}: ____________`, after: 12 },
        ...approvalSheet(t.sheet),
      ];
      break;
    default: {
      const name = code === 'ORDER' ? t.order : t.directive;
      body = [
        ...header(t, name),
        loop('hasPreamble'), { text: '{preamble}', align: 'both', after: 10 }, end('hasPreamble'),
        { text: t.command, bold: true, after: 6 },
        loop('hasBody'), { text: '{body}', align: 'both' }, end('hasBody'),
        ...itemsBlock(t, null),
        L(t.control),
        { text: `{signer}        ${t.signature}: ____________`, after: 12 },
        ...approvalSheet(t.sheet),
      ];
    }
  }
  return buildDocx(body);
}
