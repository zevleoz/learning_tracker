// 学生管理 · 列表视图：每位学生一行（约 42px），顾问分组，列在各组之间对齐（table-layout: fixed）。
// 行内操作只在悬停 / 键盘聚焦时出现；删除、编辑学校放在 ··· 菜单里（仅 admin）。

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { Button } from '../ui/button.jsx';
import { consultantColor, consultantKey, parseConsultant } from '../../utils/consultant.js';
import { AttentionText, Avatar, FillStrip, StageTag, StudentLink } from './FillStrip.jsx';
import { groupCounts } from './fillInfo.js';

const COLS = ['学生', '学校', '阶段', '近 7 天', '需关注', '最后记录', '待补填', '连接', ''];

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

export function GroupHead({ group, counts, collapsed, onToggle }) {
  const color = consultantColor(group.consultant);
  return (
    <header className="mt-group-head">
      <button type="button" className="mt-group-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="mentor-group-monogram" style={{ background: `${color}14`, color }}>
          {(group.consultant || '未').charAt(0).toUpperCase()}
        </span>
        <span className="mentor-group-name">{group.consultant || '未分配'}</span>
        <span className="mt-group-meta">
          <span>{counts.total} 人</span>
          {counts.newCount > 0 && <span>新生 {counts.newCount}</span>}
          {counts.newMissed > 0 && <span className="is-bad">新生昨天没填 {counts.newMissed}</span>}
          {counts.gapCount > 0 && <span className="is-bad">3 天以上没填 {counts.gapCount}</span>}
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

function StudentRow({ s, info, selected, a }) {
  const conn = a.connections[s.id];
  const status = conn?.status ?? -1;
  const meta = a.statusMeta(status);
  const alias = conn?.mentor_alias || '';
  const { consultant, cleanName } = parseConsultant(alias);
  const displayName = cleanName || alias || s.full_name || '(未命名)';
  const isDeleting = a.deleteBusyId === s.id;
  const pending = info.pending;

  return (
    <>
      <tr
        data-sid={s.id}
        className={`mt-row ${selected ? 'is-selected' : ''} ${isDeleting ? 'is-busy' : ''}`}
        onClick={() => a.onOpen(s.id)}
      >
        <td className="mt-c-name">
          <span className="mt-name-cell">
            <Avatar name={displayName} color={consultantColor(consultant)} />
            <StudentLink id={s.id} onOpen={a.onOpen} className="mt-name" title={alias ? `本名：${s.full_name || '-'}` : undefined}>{displayName}</StudentLink>
          </span>
        </td>
        <td className="mt-c-school"><span className={s.school_name ? '' : 'is-muted'}>{s.school_name || '未设置学校'}</span></td>
        <td><StageTag info={info} /></td>
        <td><FillStrip summary={info.connected ? info.summary : null} /></td>
        <td><AttentionText info={info} /></td>
        <td className="mt-c-last">{info.connected ? info.lastText : '—'}</td>
        <td className={`mt-c-pending ${pending > 0 ? 'is-warn' : ''}`}>{pending == null ? '—' : pending}</td>
        <td>
          <span className={`mentor-status mentor-status--${meta.key}`}>
            <span className="mentor-status-dot" />
            {meta.label}
          </span>
        </td>
        <td className="mt-c-act"><RowActions s={s} status={status} a={a} /></td>
      </tr>
      {a.editingAliasId === s.id && (
        <tr className="mt-edit-row">
          <td colSpan={COLS.length}>
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
          <td colSpan={COLS.length}>
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
  return (
    <div className="mt-groups">
      {groups.map((group) => {
        const key = consultantKey(group.consultant);
        const collapsed = collapsedGroups.has(key);
        const counts = groupCounts(group.students, infoOf);
        return (
          <section key={key} className="mt-group">
            <GroupHead group={group} counts={counts} collapsed={collapsed} onToggle={() => onToggleGroup(key)} />
            {!collapsed && (
              <table className="mt-table">
                <colgroup>
                  <col className="mt-col-name" />
                  <col className="mt-col-school" />
                  <col className="mt-col-stage" />
                  <col className="mt-col-strip" />
                  <col className="mt-col-attn" />
                  <col className="mt-col-last" />
                  <col className="mt-col-pending" />
                  <col className="mt-col-conn" />
                  <col className="mt-col-act" />
                </colgroup>
                <thead>
                  <tr>{COLS.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {group.students.map((s) => (
                    <StudentRow key={s.id} s={s} info={infoOf(s.id)} selected={selectedId === s.id} a={actions} />
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
