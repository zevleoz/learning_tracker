import {
  parseConsultant,
  groupByConsultant,
  consultantColor,
  consultantKey,
} from '../src/utils/consultant';

describe('parseConsultant', () => {
  it('解析半角括号', () => {
    expect(parseConsultant('Cathryn(Angela)')).toEqual({ consultant: 'Angela', cleanName: 'Cathryn' });
  });

  it('解析全角括号', () => {
    expect(parseConsultant('Samson（Jason）')).toEqual({ consultant: 'Jason', cleanName: 'Samson' });
  });

  it('容忍括号内外的空格', () => {
    expect(parseConsultant('Chloe (Jason)')).toEqual({ consultant: 'Jason', cleanName: 'Chloe' });
    expect(parseConsultant('Chloe（ Jason ）')).toEqual({ consultant: 'Jason', cleanName: 'Chloe' });
  });

  it('多对括号时取最后一对', () => {
    const r = parseConsultant('Amy(Lan)(Gary)');
    expect(r.consultant).toBe('Gary');
    expect(r.cleanName).toBe('Amy');
  });

  it('无括号时顾问为空、名字原样', () => {
    expect(parseConsultant('Jeff')).toEqual({ consultant: null, cleanName: 'Jeff' });
  });

  it('空 / null / undefined alias', () => {
    expect(parseConsultant('')).toEqual({ consultant: null, cleanName: '' });
    expect(parseConsultant('   ')).toEqual({ consultant: null, cleanName: '' });
    expect(parseConsultant(null)).toEqual({ consultant: null, cleanName: '' });
    expect(parseConsultant(undefined)).toEqual({ consultant: null, cleanName: '' });
  });

  it('空括号视为无顾问', () => {
    expect(parseConsultant('Jeff()')).toEqual({ consultant: null, cleanName: 'Jeff' });
  });
});

describe('groupByConsultant', () => {
  const conn = (alias) => ({ mentor_alias: alias });
  const students = [
    { id: 's1', full_name: 'Cathryn', created_at: '2024-01-01' },
    { id: 's2', full_name: 'Samson', created_at: '2024-01-02' },
    { id: 's3', full_name: 'Chloe', created_at: '2024-01-03' },
    { id: 's4', full_name: 'Jeff', created_at: '2024-01-04' },
    { id: 's5', full_name: 'Noa', created_at: '2024-01-05' },
  ];
  const connections = {
    s1: conn('Cathryn(Angela)'),
    s2: conn('Samson（Jason）'),
    s3: conn('Chloe (Jason)'),
    s4: conn('Jeff'),
    s5: conn('Noa(angela)'),
  };

  it('大小写归一合并，显示首个出现的写法', () => {
    const groups = groupByConsultant(students, connections);
    const angela = groups.find((g) => consultantKey(g.consultant) === 'angela');
    expect(angela).toBeTruthy();
    // s1(Angela) 与 s5(angela) 归一为同一组，显示首个出现的写法 'Angela'
    expect(angela.consultant).toBe('Angela');
    expect(groups.filter((g) => consultantKey(g.consultant) === 'angela')).toHaveLength(1);
    // 组内 created_at 倒序：s5(01-05) 在 s1(01-01) 之前
    expect(angela.students.map((s) => s.id)).toEqual(['s5', 's1']);
  });

  it('组按人数降序，未分配组排最后', () => {
    const groups = groupByConsultant(students, connections);
    const counts = groups.filter((g) => g.consultant).map((g) => g.students.length);
    expect(counts).toEqual([...counts].sort((a, b) => b - a)); // 非递增
    expect(groups[0].students.length).toBe(2);
    expect(groups[groups.length - 1].consultant).toBeNull(); // 未分配
  });

  it('组内按 created_at 倒序', () => {
    const groups = groupByConsultant(students, connections);
    const jason = groups.find((g) => g.consultant === 'Jason');
    expect(jason.students.map((s) => s.id)).toEqual(['s3', 's2']);
  });

  it('空输入返回空数组', () => {
    expect(groupByConsultant([], {})).toEqual([]);
    expect(groupByConsultant(null, null)).toEqual([]);
  });
});

describe('consultantColor', () => {
  it('同一顾问稳定同色', () => {
    expect(consultantColor('Angela')).toBe(consultantColor('Angela'));
    expect(consultantColor('Angela')).toBe(consultantColor('angela'));
  });

  it('未分配返回中性灰', () => {
    expect(consultantColor(null)).toBe('#64748B');
  });

  it('避开品牌红', () => {
    ['Angela', 'Lan', 'Gary', 'Jason', 'Zoe', 'Mia'].forEach((c) => {
      expect(consultantColor(c).toUpperCase()).not.toBe('#B91C1C');
    });
  });
});
