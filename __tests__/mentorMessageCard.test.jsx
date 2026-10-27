import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MessageCard, { kindLabelOf, kindToneOf } from '../src/components/mentor/MessageCard.jsx';
import MessageQueue from '../src/components/mentor/MessageQueue.jsx';
import WeekBoard from '../src/components/mentor/WeekBoard.jsx';

// WS-4：待发消息卡片、待发面板、这周谁记了。dr 用 C3 形状的桩，不 import useDrafts。

const TODAY = '2026-10-26'; // 周一

const PERSON = {
  id: 'zhou',
  name: '周以宁',
  stageText: '首月 · 第 13 天',
  school: '上海中学国际部',
  consultant: 'Angela',
  mentorName: '陈老师',
};

const OTHER = {
  id: 'wang',
  name: '王可欣',
  stageText: '每周看',
  school: '平和双语',
  consultant: 'Angela',
  mentorName: '李老师',
};

const SESSIONS = {
  's-1': {
    id: 's-1',
    session_date: '2026-10-25',
    category: 3,
    grade_label: 'B+',
    course: { name: '物理 · 牛顿定律' },
  },
};

function makeDraft(over = {}) {
  return {
    id: 'd-1',
    student_id: 'zhou',
    kind: 'daily',
    status: 'draft',
    body: '昨天物理记了两条，牛顿第二定律先复习，再做斜面那组练习。',
    edited_body: null,
    evidence: [{ id: 's-1' }],
    handled_by: null,
    handled_at: null,
    snooze_until: null,
    skip_reason: null,
    meta: {
      why: '昨天记了 2 条',
      facts: ['昨天记了 2 条：物理、数学'],
      alts: ['另一个说法'],
      lint: [],
    },
    ...over,
  };
}

function makeDr(over = {}) {
  return {
    status: 'ready',
    drafts: [],
    sessionById: SESSIONS,
    busy: {},
    errors: {},
    handlerName: jest.fn(() => '你'),
    copyAndSend: jest.fn().mockResolvedValue('copied'),
    undo: jest.fn(),
    saveEdit: jest.fn().mockResolvedValue(true),
    snooze: jest.fn(),
    skip: jest.fn(),
    setSkipReason: jest.fn(),
    nextAlt: jest.fn(() => null),
    regenerate: jest.fn(),
    loadHistory: jest.fn().mockResolvedValue([]),
    reload: jest.fn(),
    ...over,
  };
}

function renderCard(props = {}) {
  const dr = props.dr || makeDr();
  const utils = render(
    <MessageCard
      draft={makeDraft(props.draft || {})}
      person={props.person || PERSON}
      dr={dr}
      todayIso={TODAY}
      onOpenStudent={props.onOpenStudent || jest.fn()}
      showMentor={props.showMentor}
      variant={props.variant}
    />,
  );
  return { ...utils, dr };
}

describe('消息卡片 · 待发', () => {
  it('显示名字、阶段、类型、理由和正文', () => {
    renderCard();
    expect(screen.getByRole('button', { name: '周以宁' })).toBeInTheDocument();
    expect(screen.getByText(/首月 · 第 13 天 · 上海中学国际部 · Angela/)).toBeInTheDocument();
    expect(screen.getByText('每日表扬')).toBeInTheDocument();
    expect(screen.getByText('昨天记了 2 条')).toBeInTheDocument();
    expect(screen.getByText(/牛顿第二定律先复习/)).toBeInTheDocument();
  });

  it('点名字调用 onOpenStudent，不自己跳转', () => {
    const onOpenStudent = jest.fn();
    renderCard({ onOpenStudent });
    fireEvent.click(screen.getByRole('button', { name: '周以宁' }));
    expect(onOpenStudent).toHaveBeenCalledWith('zhou');
  });

  it('复制调用 copyAndSend，并把正文元素传过去', async () => {
    const dr = makeDr();
    renderCard({ dr });
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(dr.copyAndSend).toHaveBeenCalledTimes(1));
    const [draftArg, fallback] = dr.copyAndSend.mock.calls[0];
    expect(draftArg.id).toBe('d-1');
    expect(fallback).toBeInstanceOf(HTMLElement);
  });

  it('改一下 → 保存调用 saveEdit', async () => {
    const dr = makeDr();
    renderCard({ dr });
    fireEvent.click(screen.getByRole('button', { name: '改一下' }));
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: '改过的正文' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(dr.saveEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'd-1' }), '改过的正文'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('过几天再说只给 3/5/7 天，标出建议，并把天数传给 snooze', () => {
    const dr = makeDr();
    const draft = makeDraft({ meta: { ...makeDraft().meta, recommend_snooze: 3, system_push_date: '2026-10-25' } });
    render(
      <MessageCard draft={draft} person={PERSON} dr={dr} todayIso={TODAY} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '过几天再说' }));
    expect(screen.getByText('到时候按最新的记录重新写一条')).toBeInTheDocument();
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('3 天后');
    expect(items[0].textContent).toContain('建议');
    expect(items[0].textContent).toContain('10/29 周四');
    expect(items[2].textContent).toContain('11/2 周一');
    fireEvent.click(screen.getByRole('menuitem', { name: /5 天后/ }));
    expect(dr.snooze).toHaveBeenCalledWith(draft, 5);
  });

  it('不用发调用 skip', () => {
    const dr = makeDr();
    renderCard({ dr });
    fireEvent.click(screen.getByRole('button', { name: '不用发' }));
    expect(dr.skip).toHaveBeenCalledTimes(1);
  });

  it('换个说法先走 nextAlt；用完了再 regenerate', () => {
    const nextAlt = jest.fn(() => '另一个说法');
    const dr = makeDr({ nextAlt });
    const { unmount } = renderCard({ dr });
    fireEvent.click(screen.getByRole('button', { name: '换个说法' }));
    expect(nextAlt).toHaveBeenCalledTimes(1);
    expect(dr.regenerate).not.toHaveBeenCalled();
    unmount();

    const exhausted = makeDr({ nextAlt: jest.fn(() => null) });
    renderCard({ dr: exhausted });
    fireEvent.click(screen.getByRole('button', { name: '换个说法' }));
    expect(exhausted.regenerate).toHaveBeenCalledTimes(1);
  });

  it('依据展开后显示 meta.facts 和记录', () => {
    renderCard();
    expect(screen.queryByText('昨天记了 2 条：物理、数学')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '依据' }));
    expect(screen.getByText('昨天记了 2 条：物理、数学')).toBeInTheDocument();
    expect(screen.getByText(/物理 · 牛顿定律 · 练习 · B\+/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起依据' }));
    expect(screen.queryByText('昨天记了 2 条：物理、数学')).toBeNull();
  });

  it('显示系统推送提示和 lint 提示', () => {
    const draft = makeDraft({
      meta: {
        why: '上周记了 4 天 · 之后 4 天没记',
        facts: [],
        lint: ['等第 A+ 找不到'],
        system_push_date: '2026-10-25',
        recommend_snooze: 3,
      },
    });
    render(<MessageCard draft={draft} person={PERSON} dr={makeDr()} todayIso={TODAY} />);
    expect(screen.getByText(/系统 10\/25 已经推送过一次/)).toBeInTheDocument();
    expect(screen.getByText(/过 3 天再说/)).toBeInTheDocument();
    expect(screen.getByText('这条可能有和记录对不上的地方，发之前看一眼')).toBeInTheDocument();
  });

  it('detail 变体不显示头像和名字行，正文仍从左边开始', () => {
    const { container } = render(
      <MessageCard draft={makeDraft()} person={PERSON} dr={makeDr()} todayIso={TODAY} variant="detail" />,
    );
    expect(screen.queryByRole('button', { name: '周以宁' })).toBeNull();
    expect(container.querySelector('.md-av')).toBeNull();
    expect(screen.getByText('每日表扬')).toBeInTheDocument();
  });
});

describe('消息卡片 · 处理后的折叠行', () => {
  it('自己发的：已复制给 X，记为已发，可撤销', () => {
    const dr = makeDr({ handlerName: jest.fn(() => '你') });
    const draft = makeDraft({ status: 'sent', handled_by: 'me', handled_at: '2026-10-26T09:12:00' });
    render(<MessageCard draft={draft} person={PERSON} dr={dr} todayIso={TODAY} />);
    expect(screen.getByText(/已复制给/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(dr.undo).toHaveBeenCalledWith(draft);
  });

  it('别人发的：写上谁、几点，没有撤销', () => {
    const dr = makeDr({ handlerName: jest.fn(() => '李老师') });
    const draft = makeDraft({ status: 'sent', handled_by: 't-2', handled_at: '2026-10-26T09:12:00' });
    render(<MessageCard draft={draft} person={PERSON} dr={dr} todayIso={TODAY} />);
    expect(document.body.textContent).toMatch(/李老师\s*09:12\s*已发给/);
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
  });

  it('推迟：写明哪天重新写，提醒多一句自动撤掉', () => {
    const draft = makeDraft({ status: 'snoozed', kind: 'nudge', snooze_until: '2026-10-29' });
    render(<MessageCard draft={draft} person={PERSON} dr={makeDr()} todayIso={TODAY} />);
    expect(screen.getByText(/10\/29 周四 按那时的记录重新写一条/)).toBeInTheDocument();
    expect(screen.getByText(/这之前记了就不提醒了/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销' })).toBeInTheDocument();
  });

  it('不用发：给出三个原因，点一个就记下来', () => {
    const dr = makeDr();
    const draft = makeDraft({ status: 'skipped', skip_reason: null });
    render(<MessageCard draft={draft} person={PERSON} dr={dr} todayIso={TODAY} />);
    expect(screen.getByText(/不给/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '请假了' }));
    expect(dr.setSkipReason).toHaveBeenCalledWith(draft, '请假了');
  });

  it('已选的原因保持选中，再点一次取消', () => {
    const dr = makeDr();
    const draft = makeDraft({ status: 'skipped', skip_reason: '当面说过了' });
    render(<MessageCard draft={draft} person={PERSON} dr={dr} todayIso={TODAY} />);
    const chosen = screen.getByRole('button', { name: '当面说过了' });
    expect(chosen).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chosen);
    expect(dr.setSkipReason).toHaveBeenCalledWith(draft, null);
  });
});

describe('类型文案', () => {
  it('每日 / 周小结 / 周小结 + 提醒 / 提醒', () => {
    expect(kindLabelOf({ kind: 'daily' })).toBe('每日表扬');
    expect(kindLabelOf({ kind: 'weekly', meta: {} })).toBe('周小结');
    expect(kindLabelOf({ kind: 'weekly', meta: { nudge: true } })).toBe('周小结 + 提醒');
    expect(kindLabelOf({ kind: 'nudge' })).toBe('提醒');
    expect(kindToneOf({ kind: 'nudge' })).toBe('nudge');
    expect(kindToneOf({ kind: 'weekly', meta: { nudge: true } })).toBe('nudge');
    expect(kindToneOf({ kind: 'daily' })).toBe('praise');
  });
});

describe('待发面板', () => {
  it('待发在前，今天处理过的在后', () => {
    const open = makeDraft();
    const sent = makeDraft({
      id: 'd-2',
      student_id: 'wang',
      status: 'sent',
      handled_by: 'me',
      handled_at: '2026-10-26T09:12:00',
    });
    const persons = (id) => (id === 'zhou' ? PERSON : OTHER);
    const { container } = render(
      <MessageQueue drafts={[sent, open]} persons={persons} dr={makeDr()} todayIso={TODAY} />,
    );
    const cards = [...container.querySelectorAll('[data-draft-id]')];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('周以宁');
    expect(cards[1].textContent).toContain('王可欣');
  });

  it('空状态按 dr.status 给不同文案', () => {
    const { unmount } = render(<MessageQueue drafts={[]} persons={{}} dr={makeDr()} todayIso={TODAY} />);
    expect(screen.getByText('没有待发的消息。')).toBeInTheDocument();
    unmount();

    const loading = render(
      <MessageQueue drafts={[]} persons={{}} dr={makeDr({ status: 'loading' })} todayIso={TODAY} />,
    );
    expect(screen.getByText('加载中…')).toBeInTheDocument();
    loading.unmount();

    render(
      <MessageQueue drafts={[]} persons={{}} dr={makeDr({ status: 'unavailable' })} todayIso={TODAY} />,
    );
    expect(screen.getByText('消息草稿暂时不可用。')).toBeInTheDocument();
  });
});

function days(states) {
  return states.map((state, i) => ({ date: `2026-10-${20 + i}`, state }));
}

const BOARD_ROWS = [
  {
    id: 'wang',
    name: '王可欣',
    stageText: '每周看',
    school: '平和双语',
    mentorName: '李老师',
    days: days(['f', 'f', 'e', 'e', 'f', 'e', 't']),
    stateText: '4 天没记',
    warn: true,
    subText: '系统昨天推送过一次',
    lastText: '10/22 周四',
    draft: undefined,
  },
  {
    id: 'zhou',
    name: '周以宁',
    stageText: '首月 · 第 13 天',
    school: '上海中学国际部',
    mentorName: '陈老师',
    days: days(['f', 'e', 'f', 'e', 'f', 'f', 't']),
    stateText: '正常',
    warn: false,
    subText: '今天还没记',
    lastText: '10/25 昨天',
    draft: makeDraft(),
  },
];

describe('这周谁记了', () => {
  it('要跟进在前，正常在后；今天一列加粗', () => {
    const { container } = render(<WeekBoard rows={BOARD_ROWS} />);
    const warnGroup = screen.getByText('要跟进 · 1');
    const normalGroup = screen.getByText('正常 · 1');
    expect(
      warnGroup.compareDocumentPosition(normalGroup) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelectorAll('tbody .md-d')).toHaveLength(14);
    expect(container.querySelector('tbody .md-d--t')).not.toBeNull();
    const heads = [...container.querySelectorAll('.md-dayh span')];
    expect(heads[heads.length - 1]).toHaveTextContent('今');
    expect(heads[heads.length - 1]).toHaveClass('t');
  });

  it('点名字进数据分析，点今天的消息跳到卡片', () => {
    const onOpenStudent = jest.fn();
    const onJumpToDraft = jest.fn();
    render(<WeekBoard rows={BOARD_ROWS} onOpenStudent={onOpenStudent} onJumpToDraft={onJumpToDraft} />);
    fireEvent.click(screen.getByRole('button', { name: '王可欣' }));
    expect(onOpenStudent).toHaveBeenCalledWith('wang');
    fireEvent.click(screen.getByRole('button', { name: '每日表扬待发' }));
    expect(onJumpToDraft).toHaveBeenCalledWith('zhou');
  });

  it('管理员多一列导师；普通导师没有这一列', () => {
    const { unmount } = render(<WeekBoard rows={BOARD_ROWS} showMentor />);
    expect(screen.getByRole('columnheader', { name: '导师' })).toBeInTheDocument();
    expect(screen.getByText('李老师')).toBeInTheDocument();
    unmount();
    render(<WeekBoard rows={BOARD_ROWS} />);
    expect(screen.queryByRole('columnheader', { name: '导师' })).toBeNull();
  });

  it('没有学生时给空状态', () => {
    render(<WeekBoard rows={[]} />);
    expect(screen.getByText('没有学生')).toBeInTheDocument();
  });
});
