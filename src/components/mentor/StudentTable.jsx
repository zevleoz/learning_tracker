// 学生管理 · 全部学生：按顾问分组，一行一位学生（约 42px）。
// 行内操作只在悬停 / 键盘聚焦时出现；删除、编辑学校放在 ··· 菜单里（仅管理员）。

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { Button } from '../ui/button.jsx';
import { consultantColor, consultantKey, parseConsultant } from '../../utils/consultant.js';
import { Avatar, FillStrip, StageTag, StudentLink } from './FillStrip.jsx';

const INK = '#1C1C1E';
const INK_2 = '#48484A';
const INK_3 = '#6E6E73';
const CELL = { color: INK_2, fontSize: 14 };
const HEAD = { color: INK_3, fontSize: 12.5, fontWeight: 500 };
// 学校列不再吃掉剩余宽度；「最后一次记录」要放得下「10/24 · 13 天前」，不截断
const SCHOOL_W = 200;
const LAST_W = 150;

/** ··· 菜单：点按钮展开；点外面或按 Esc 收起。菜单内容始终在 DOM 里，用样式显隐。 */
function RowMenu({ children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <span className={`mt-menu ${open ? 'is-open' : ''}`} ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="mt-more"
        aria-label="更多操作"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={15} />
      </button>
      <span className="mt-menu-pop" onClick={() => setOpen(false)}>{children}</span>
    </span>
  );
}

export function GroupHead({ group, total, collapsed, onToggle }) {
  const color = consultantColor(group.consultant);
  return (
    <header className="mt-group-head">
      <button type="button" className="mt-group-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="mentor-group-monogram" style={{ background: `${color}14`, color }}>
          {(group.consultant || '未').charAt(0).toUpperCase()}
        </span>
        <span className="mentor-group-name">{group.consultant || '未分配'}</span>
        <span className="mt-group-meta">
          <span>{total} 人</span>
          {!group.consultant && <span>备注名里没写顾问</span>}
        </span>
        <ChevronDown className={`mentor-group-chevron ${collapsed ? 'is-collapsed' : ''}`} />
      </button>
    </header>
  );
}

function RowActions({ s, status, a }) {
  const { isAdmin } = a;
  const alias = a.connections[s.id]?.mentor_alias || '';
  const isDeleting = a.deleteBusyId === s.id;
  return (
    <div className="mt-acts" onClick={(e) => e.stopPropagation()}>
      {!isAdmin && status === -1 && <Button size="sm" onClick={() => a.sendInvite(s.id)}>邀请</Button>}
      {!isAdmin && status === 0 && (
        <>
          <Button size="sm" variant="outline" onClick={() => a.withdrawInvite(s.id)}>撤回</Button>
          <Button size="sm" onClick={() => a.sendInvite(s.id)}>重发</Button>
        </>
      )}
      {!isAdmin && status === 2 && <Button size="sm" onClick={() => a.sendInvite(s.id)}>再次邀请</Button>}
      {!isAdmin && status === 1 && (
        <Button size="sm" variant="outline" onClick={() => a.disconnectStudent(s.id)}>断开</Button>
      )}
      {status === 1 && a.editingAliasId !== s.id && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => { a.setEditingAliasId(s.id); a.setEditingAliasValue(alias); }}
        >{alias ? '改备注' : '备注名'}</Button>
      )}
      {isAdmin && (
        <RowMenu>
          <button
            type="button"
            className="mt-menu-item"
            onClick={() => { a.setEditingSchoolId(s.id); a.setEditingSchoolValue(s.school_name || ''); }}
          >编辑学校</button>
          <Button
            size="sm"
            variant="destructive"
            className="mentor-btn-delete mt-menu-item"
            disabled={isDeleting}
            onClick={() => { if (!isDeleting) a.deleteStudent(s.id); }}
          >{isDeleting ? '删除中…' : '删除'}</Button>
        </RowMenu>
      )}
    </div>
  );
}

function StudentRow({ s, info, selected, isAdmin, a }) {
  const conn = a.connections[s.id];
  const status = conn?.status ?? -1;
  const meta = a.statusMeta(status);
  const alias = conn?.mentor_alias || '';
  const { consultant, cleanName } = parseConsultant(alias);
  const displayName = cleanName || alias || s.full_name || '(未命名)';
  const showRealName = !!(s.full_name && displayName !== s.full_name);
  const isDeleting = a.deleteBusyId === s.id;
  const mentorName = a.mentorNameOf?.(s.id) || s.mentorName || '—';

  return (
    <>
      <tr
        data-sid={s.id}
        className={`mt-row ${selected ? 'is-selected' : ''} ${isDeleting ? 'is-busy' : ''}`}
        onClick={() => a.onOpen(s.id)}
      >
        <td className="mt-c-name" style={CELL}>
          <span className="mt-name-cell">
            <Avatar name={displayName} color={consultantColor(consultant)} />
            <span style={{ display: 'block', minWidth: 0 }}>
              <StudentLink id={s.id} onOpen={a.onOpen} className="mt-name">{displayName}</StudentLink>
              {showRealName && (
                <small style={{ display: 'block', color: INK_3, fontSize: 12, marginTop: 1 }}>本名 {s.full_name}</small>
              )}
            </span>
          </span>
        </td>
        {isAdmin && <td style={CELL}>{mentorName}</td>}
        <td style={CELL}><span style={{ color: s.school_name ? INK_2 : INK_3 }}>{s.school_name || '未设置学校'}</span></td>
        <td style={CELL}><StageTag info={info} /></td>
        <td style={CELL}><FillStrip summary={info.connected ? info.summary : null} /></td>
        <td className="mt-c-last" style={CELL}>{info.connected ? info.lastText : '—'}</td>
        <td style={CELL}>
          <span className={`mentor-status mentor-status--${meta.key}`}>
            <span className="mentor-status-dot" />
            {meta.label}
          </span>
        </td>
        <td className="mt-c-act"><RowActions s={s} status={status} a={a} /></td>
      </tr>
      {a.editingAliasId === s.id && (
        <tr className="mt-edit-row">
          <td colSpan={isAdmin ? 8 : 7}>
            <div className="mentor-alias-editor" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                placeholder="输入备注名（留空清除）"
                value={a.editingAliasValue}
                onChange={(e) => a.setEditingAliasValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); a.saveStudentAlias(s.id, a.editingAliasValue); }
                  if (e.key === 'Escape') { a.setEditingAliasId(null); a.setEditingAliasValue(''); }
                }}
                autoFocus
                className="mentor-alias-input"
              />
              <div className="mentor-alias-actions">
                <Button size="sm" variant="ghost" onClick={() => { a.setEditingAliasId(null); a.setEditingAliasValue(''); }}>取消</Button>
                <Button size="sm" onClick={() => a.saveStudentAlias(s.id, a.editingAliasValue)}>保存</Button>
              </div>
            </div>
          </td>
        </tr>
      )}
      {a.editingSchoolId === s.id && (
        <tr className="mt-edit-row">
          <td colSpan={isAdmin ? 8 : 7}>
            <div className="mentor-alias-editor" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                placeholder="输入学校名称"
                value={a.editingSchoolValue}
                onChange={(e) => a.setEditingSchoolValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); a.saveSchoolName(s.id, a.editingSchoolValue); }
                  if (e.key === 'Escape') { a.setEditingSchoolId(null); a.setEditingSchoolValue(''); }
                }}
                autoFocus
                className="mentor-alias-input"
              />
              <div className="mentor-alias-actions">
                <Button size="sm" variant="ghost" onClick={() => { a.setEditingSchoolId(null); a.setEditingSchoolValue(''); }}>取消</Button>
                <Button size="sm" onClick={() => a.saveSchoolName(s.id, a.editingSchoolValue)}>保存</Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * @param {object} props
 * @param {Array<{consultant: string|null, students: Array}>} props.groups 已排好序的分组
 * @param {(id: string) => object} props.infoOf
 * @param {string|null} props.selectedId
 * @param {Set<string>} props.collapsedGroups
 * @param {(key: string) => void} props.onToggleGroup
 * @param {object} props.actions 行内操作与编辑状态（来自 Mentor.jsx）
 */
export default function StudentTable({ groups, infoOf, selectedId, collapsedGroups, onToggleGroup, actions }) {
  const isAdmin = !!actions.isAdmin;
  const cols = isAdmin
    ? ['学生', '导师', '学校', '阶段', '近 7 天', '最后一次记录', '连接', '']
    : ['学生', '学校', '阶段', '近 7 天', '最后一次记录', '连接', ''];
  const colWidths = isAdmin
    ? [
      { key: 'name', className: 'mt-col-name' },
      { key: 'mentor', width: 96 },
      { key: 'school', width: SCHOOL_W },
      { key: 'stage', className: 'mt-col-stage' },
      { key: 'strip', className: 'mt-col-strip' },
      { key: 'last', width: LAST_W },
      { key: 'conn', className: 'mt-col-conn' },
      { key: 'act', className: 'mt-col-act' },
    ]
    : [
      { key: 'name', className: 'mt-col-name' },
      { key: 'school', width: SCHOOL_W },
      { key: 'stage', className: 'mt-col-stage' },
      { key: 'strip', className: 'mt-col-strip' },
      { key: 'last', width: LAST_W },
      { key: 'conn', className: 'mt-col-conn' },
      { key: 'act', className: 'mt-col-act' },
    ];

  return (
    <div className="mt-groups">
      {groups.map((group) => {
        const key = consultantKey(group.consultant);
        const collapsed = collapsedGroups.has(key);
        return (
          <section key={key} className="mt-group">
            <GroupHead group={group} total={group.students.length} collapsed={collapsed} onToggle={() => onToggleGroup(key)} />
            {!collapsed && (
              <table className="mt-table">
                <colgroup>
                  {colWidths.map((c) => (
                    <col key={c.key} className={c.className} style={c.width ? { width: c.width } : undefined} />
                  ))}
                </colgroup>
                <thead>
                  <tr>{cols.map((c, i) => <th key={i} scope="col" style={HEAD}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {group.students.map((s) => (
                    <StudentRow
                      key={s.id}
                      s={s}
                      info={infoOf(s.id)}
                      selected={selectedId === s.id}
                      isAdmin={isAdmin}
                      a={actions}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
