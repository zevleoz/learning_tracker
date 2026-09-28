import { useState } from 'react';
import { useAuth } from '../lib/useAuth.js';
import { updateWorkspace } from '../lib/e4Store.js';
import { toast } from '../lib/toast.js';

// 导师登录后的默认落地工作区：E4（默认）或 一表人才
export default function WorkspacePreference() {
  const { profile } = useAuth();
  const current = profile?.default_workspace === 'tracker' ? 'tracker' : 'e4';
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState(current);

  async function choose(next) {
    if (next === value || saving) return;
    setSaving(true);
    try {
      await updateWorkspace(profile.id, next);
      setValue(next);
      toast(next === 'e4' ? '已设为默认进入 E4 学习力平台' : '已设为默认进入 一表人才', { kind: 'success' });
    } catch (err) {
      toast(err.message || '保存失败', { kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="profile-card workspace-pref-card">
      <h3 className="profile-card__title">默认工作区</h3>
      <p className="workspace-pref-hint">登录后默认打开的平台，可随时在左侧栏一键切换。</p>
      <div className="workspace-pref-options">
        <button
          type="button"
          className={`workspace-pref-option ${value === 'e4' ? 'selected' : ''}`}
          onClick={() => choose('e4')}
          disabled={saving}
        >
          <span className="workspace-pref-name">E4 学习力平台</span>
          <span className="workspace-pref-desc">学生中心 · 学习力分析报告</span>
        </button>
        <button
          type="button"
          className={`workspace-pref-option ${value === 'tracker' ? 'selected' : ''}`}
          onClick={() => choose('tracker')}
          disabled={saving}
        >
          <span className="workspace-pref-name">一表人才</span>
          <span className="workspace-pref-desc">学习追踪 · 数据分析仪表盘</span>
        </button>
      </div>
    </div>
  );
}
