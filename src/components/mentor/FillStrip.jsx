// 近 7 天填写小方块、阶段标签、需关注文字、名字链接、小头像（列表 / 卡片 / 手机 / 今日反馈共用）

/** 7 个小方块：实心 = 当天有记录；空心 = 没有；今天虚线边框。title = 日期。 */
export function FillStrip({ summary, showCount = true }) {
  if (!summary) return <span className="fs-none">—</span>;
  const last = summary.days.length - 1;
  return (
    <span className="fs-wrap">
      <span className="fs-strip" role="img" aria-label={`近 7 天 ${summary.count}/7`}>
        {summary.days.map((d, i) => (
          <span
            key={d.date}
            className={`fs-sq ${d.filled ? 'is-filled' : ''} ${i === last ? 'is-today' : ''}`}
            title={i === last ? `${d.date}（今天）` : d.date}
          />
        ))}
      </span>
      {showCount && <span className="fs-count">{summary.count}/7</span>}
    </span>
  );
}

/** 阶段：首月灰色标签；每周灰字；未连接 — */
export function StageTag({ info }) {
  if (!info?.connected) return <span className="fs-none">—</span>;
  return <span className="fs-stage">{info.stage}</span>;
}

/** 需关注列：绿 / 红 / 琥珀文字（语义色只用在文字或小点上） */
export function AttentionText({ info }) {
  if (!info?.connected || !info.cell) return null;
  return (
    <span className={`fs-attn fs-attn--${info.cell.tone}`}>
      <span className="fs-attn-dot" />
      {info.cell.text}
    </span>
  );
}

/** 「第 N 天」小标（卡片名字旁；仅首月） */
export function DayTag({ info }) {
  if (!info?.connected || !info.isNew) return null;
  return <span className="fs-daytag">第 {info.day} 天</span>;
}

/**
 * 学生名字链接：左键打开这位学生的数据分析；带修饰键 / 中键时交给浏览器。
 * href 用 /mentor?view=analytics&student=<id>；旧页面也会按 ?student= 落到数据分析。
 */
export function StudentLink({ id, onOpen, className = '', title, children }) {
  return (
    <a
      href={`/mentor?view=analytics&student=${encodeURIComponent(id)}`}
      className={`mt-namelink ${className}`}
      title={title}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        onOpen?.(id);
      }}
    >
      {children}
    </a>
  );
}

/** 小头像：顾问色底 + 名字首字 */
export function Avatar({ name, color, size = 22 }) {
  return (
    <span
      className="mt-avatar"
      style={{ width: size, height: size, background: `${color}14`, color, fontSize: Math.round(size * 0.5) }}
      aria-hidden="true"
    >
      {(name || '?').charAt(0).toUpperCase()}
    </span>
  );
}
