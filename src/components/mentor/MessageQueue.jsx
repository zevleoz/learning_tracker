// 「待发」面板：待发的草稿在前，今天已经处理过的折叠行在后。
// 空状态按 dr.status 区分：加载中 / 表还没更新 / 加载失败 / 今天没有要发的。

import '../../styles/mentor-desk.css';
import MessageCard from './MessageCard.jsx';

function personOf(persons, id) {
  if (!persons) return undefined;
  return typeof persons === 'function' ? persons(id) : persons[id];
}

function emptyText(dr) {
  if (dr?.status === 'loading') return '加载中…';
  if (dr?.status === 'unavailable') return '消息草稿暂时不可用。';
  if (dr?.status === 'error') return '草稿暂时加载失败，刷新页面再试。';
  return '没有待发的消息。';
}

/**
 * @param {object} props
 * @param {Array} props.drafts 未处理的草稿 + 今天处理过的行（C3）
 * @param {object|Function} props.persons 学生 id → person（C4）
 * @param {object} props.dr useDrafts() 的返回值
 * @param {string} [props.todayIso]
 * @param {boolean} [props.showMentor]
 * @param {(id: string) => void} [props.onOpenStudent]
 */
export default function MessageQueue({
  drafts = [], persons, dr, todayIso, showMentor = false, onOpenStudent, mutes = {},
}) {
  // 被隐藏 / 暂停的学生连今天处理过的行也不占位置
  const visible = drafts.filter((d) => !mutes[d.student_id]);
  const open = visible.filter((d) => d.status === 'draft');
  const handled = visible.filter((d) => d.status !== 'draft' && d.status !== 'dropped');
  const list = [...open, ...handled];

  return (
    <section className="md-root md-queue" aria-label="待发消息">
      <div className="md-sec-h">
        <h2>待发</h2>
        {open.length > 0 && <span className="md-n">{open.length} 条</span>}
        <span className="md-aside">复制就算已发，可撤销</span>
      </div>
      <div className="md-panel">
        {list.length === 0 ? (
          <div className="md-empty">{emptyText(dr)}</div>
        ) : (
          list.map((draft) => (
            <MessageCard
              key={draft.id}
              draft={draft}
              person={personOf(persons, draft.student_id)}
              dr={dr}
              todayIso={todayIso}
              showMentor={showMentor}
              onOpenStudent={onOpenStudent}
            />
          ))
        )}
      </div>
    </section>
  );
}
