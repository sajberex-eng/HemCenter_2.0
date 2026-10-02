import { describe, expect, it } from 'vitest';
import { protocolData, protocolTitle } from '../src/meetings/meeting-rules';

const src = {
  chair: 'Иванов И.',
  secretary: 'Петрова А.',
  participants: ['Иванов И.', 'Петрова А.', 'Сидоров Б.'],
  items: [
    { title: 'Реестр поставщиков', heard: 'Доклад Сидорова', resolutions: [{ kind: 'DECISION' as const, text: 'Утвердить реестр', responsible: null, due: null }, { kind: 'INSTRUCTION' as const, text: 'Разослать реестр', responsible: 'Сидоров Б.', due: '2026-11-01' }] },
    { title: 'График отпусков', heard: null, resolutions: [{ kind: 'DECISION' as const, text: 'Принять график', responsible: null, due: null }, { kind: 'INSTRUCTION' as const, text: 'Подготовить приказ', responsible: 'Петрова А.', due: '2026-11-05' }, { kind: 'INSTRUCTION' as const, text: 'Ознакомить', responsible: 'Иванов И.', due: '2026-11-10' }] },
    { title: 'Разное', heard: '  ', resolutions: [] },
  ],
};

describe('protocolData', () => {
  it('collects the agenda, what was heard, the decisions and the instructions, with the agenda point of each', () => {
    const d = protocolData(src, 'ru');
    expect(d.agenda).toEqual(['Реестр поставщиков', 'График отпусков', 'Разное']);
    expect(d.body).toBe('1. «Реестр поставщиков». Слушали: Доклад Сидорова');
    expect(d.decisions).toEqual(['Утвердить реестр (п. 1 повестки)', 'Принять график (п. 2 повестки)']);
    expect(d.items).toEqual([
      { text: 'Разослать реестр (п. 1 повестки)', responsible: 'Сидоров Б.', due: '2026-11-01' },
      { text: 'Подготовить приказ (п. 2 повестки)', responsible: 'Петрова А.', due: '2026-11-05' },
      { text: 'Ознакомить (п. 2 повестки)', responsible: 'Иванов И.', due: '2026-11-10' },
    ]);
    expect(d.chair).toBe('Иванов И.');
    expect(d.participants).toHaveLength(3);
  });
  it('speaks Kazakh for a Kazakh protocol', () => {
    const d = protocolData(src, 'kk');
    expect(d.body).toContain('Тыңдалды');
    expect(d.decisions![0]).toContain('күн тәртібінің 1-тармағы');
  });
  it('leaves out what is empty', () => {
    const d = protocolData({ chair: 'А', secretary: 'Б', participants: [], items: [] }, 'ru');
    expect(Object.keys(d).sort()).toEqual(['chair', 'secretary']);
  });
  it('titles the protocol with the subject and the date', () => {
    expect(protocolTitle('Планёрка', '2026-10-05', 'ru')).toBe('Протокол совещания «Планёрка» от 05.10.2026');
  });
});
