// 学生管理 · 卡片视图：沿用原来的卡片，加一行填写情况（新生：昨天 / 今天 + 小方块；其他：N/7 + 小方块）。

import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Button } from '../ui/button.jsx';
import { Badge } from '../ui/badge.jsx';
import { Card } from '../ui/card.jsx';
import { consultantColor, consultantKey, parseConsultant } from '../../utils/consultant.js';
import { formatInactivity } from '../../utils/inactivity.js';
import { DayTag, FillStrip, StudentLink } from './FillStrip.jsx';
import { newbieDayStatus } from './fillInfo.js';

function StudentCard({ s, group, info, selected, a, inactive }) {
  const conn = a.connections[s.id];
  const status = conn?.status ?? -1;
  const alias = conn?.mentor_alias || '';
  const isDeleting = a.deleteBusyId === s.id;
  const isAliasEditing = a.editingAliasId === s.id;
  const meta = a.statusMeta(status);
  // 备注名括号里是顾问归属（区头已表达），卡片主标题只显示干净姓名
  const { cleanName } = parseConsultant(alias);
  const displayName = cleanName || alias || s.full_name || '(未命名)';
  const avatarColor = consultantColor(group.consultant);
  const nb = newbieDayStatus(info);

  return (
    <Card
      data-sid={s.id}
      className={`mentor-student-card group ${selected ? 'is-selected' : ''}`}
      onClick={() => a.onOpen(s.id)}
      style={{ opacity: isDeleting ? 0.55 : 1 }}
    >
      <div className="mentor-student-card__top">
        <div className="mentor-student-avatar" style={{ background: `${avatarColor}14`, color: avatarColor }}>
          {(displayName || '?').charAt(0).toUpperCase()}
        </div>
        <div className="mentor-student-card__id">
          <div className="mentor-student-card__name-row">
            <StudentLink id={s.id} onOpen={a.onOpen} className="mentor-student-card__name">{displayName}</StudentLink>
            <DayTag info={info} />
            {alias && <span className="mentor-student-card__tag">备注</span>}
          </div>
          <div className="mentor-student-card__meta">
            {alias && <span>本名：{s.full_name || '-'}</span>}
            <span>{s.school_name || '未设置学校'}</span>
          </div>
        </div>
      </div>

      {info.connected && (
        <div className="mt-card-fill">
          {nb ? (
            <span className="mt-card-days">
              {nb.yesterday && <span className={`mt-dayst mt-dayst--${nb.yesterday.tone}`}><i />{nb.yesterday.text}</span>}
              <span className={`mt-dayst mt-dayst--${nb.today.tone}`}><i />{nb.today.text}</span>
            </span>
          ) : (
            <span className="mt-card-n"><b>{info.summary.count}/7</b> 近 7 天</span>
          )}
          <FillStrip summary={info.summary} showCount={false} />
        </div>
      )}

      <div className="mentor-student-card__foot">
        <div className="mentor-student-card__left">
          <span className={`mentor-status mentor-status--${meta.key}`}>
            <span className="mentor-status-dot" />
            {meta.label}
          </span>
          {/* 新生的「昨天」一行已经说明了没填，不再重复「N 天未填写」 */}
          {!info.isNew && inactive && (
            <span className="mentor-inactive">
              <span className="mentor-inactive-dot" />
              {formatInactivity(inactive)}
            </span>
          )}
        </div>
        <div className="mentor-student-card__actions" onClick={(e) => e.stopPropagation()}>
          {!a.isAdmin && status === -1 && <Button size="sm" onClick={() => a.sendInvite(s.id)}>邀请</Button>}
          {!a.isAdmin && status === 0 && (
            <>
              <Button size="sm" variant="outline" onClick={() => a.withdrawInvite(s.id)}>撤回</Button>
              <Button size="sm" onClick={() => a.sendInvite(s.id)}>重发</Button>
            </>
          )}
          {!a.isAdmin && status === 2 && <Button size="sm" onClick={() => a.sendInvite(s.id)}>再次邀请</Button>}
          {!a.isAdmin && status === 1 && (
            <Button size="sm" variant="outline" onClick={() => a.disconnectStudent(s.id)}>断开</Button>
          )}
          {/* 备注名：status === 1（含 admin 自动连接）可编辑 */}
          {status === 1 && !isAliasEditing && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { a.setEditingAliasId(s.id); a.setEditingAliasValue(alias); }}
            >{alias ? '改备注' : '备注名'}</Button>
          )}
          {/* 编辑学校 / 永久删除：admin only */}
          {a.isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { a.setEditingSchoolId(s.id); a.setEditingSchoolValue(s.school_name || ''); }}
            >编辑学校</Button>
          )}
          {a.isAdmin && (
            <Button
              size="sm"
              variant="destructive"
              className="mentor-btn-delete"
              disabled={isDeleting}
              onClick={() => { if (!isDeleting) a.deleteStudent(s.id); }}
            >{isDeleting ? '删除中…' : '删除'}</Button>
          )}
        </div>
      </div>

      {isAliasEditing && (
        <motion.div
          className="mentor-alias-editor"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          onClick={(e) => e.stopPropagation()}
        >
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
        </motion.div>
      )}

      {a.editingSchoolId === s.id && (
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
      )}
    </Card>
  );
}

export default function StudentCards({ groups, infoOf, selectedId, collapsedGroups, onToggleGroup, actions, inactiveByStudent }) {
  return (
    <div className="mentor-groups">
      {groups.map((group) => {
        const key = consultantKey(group.consultant);
        const collapsed = collapsedGroups.has(key);
        const color = consultantColor(group.consultant);
        return (
          <section key={key} className="mentor-group">
            <header className="mentor-group-header">
              <button type="button" className="mentor-group-toggle" onClick={() => onToggleGroup(key)} aria-expanded={!collapsed}>
                <span className="mentor-group-monogram" style={{ background: `${color}14`, color }}>
                  {(group.consultant || '未').charAt(0).toUpperCase()}
                </span>
                <span className="mentor-group-name">{group.consultant || '未分配'}</span>
                <ChevronDown className={`mentor-group-chevron ${collapsed ? 'is-collapsed' : ''}`} />
              </button>
              <Badge variant="secondary" className="mentor-group-count">{group.students.length} 位学生</Badge>
            </header>
            {!collapsed && (
              <div className="mentor-group-grid">
                {group.students.map((s) => (
                  <StudentCard
                    key={s.id}
                    s={s}
                    group={group}
                    info={infoOf(s.id)}
                    selected={selectedId === s.id}
                    a={actions}
                    inactive={inactiveByStudent?.[s.id]}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
