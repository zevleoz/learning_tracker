// 一表人才（/mentor）与 E4（/e4）是两套平台：切过去要回到上次停留的那一页，
// 刷新和打开 `/` 也要停在同一个平台。记忆按浏览器标签页存（sessionStorage），
// 隐私模式下读写会抛错，所以全部包在 try/catch 里，失败时退回平台首页。

export const WORKSPACES = { tracker: '/mentor', e4: '/e4' };

const PATH_KEY = (workspace) => `yb:ws-path:${workspace}`;
const LAST_KEY = 'yb:ws-last';

/** 把 pathname 归到平台：/mentor* → tracker，/e4* → e4，其余 null。 */
export function workspaceOfPath(pathname) {
  const p = String(pathname || '').split(/[?#]/)[0];
  if (p === '/mentor' || p.startsWith('/mentor/')) return 'tracker';
  if (p === '/e4' || p.startsWith('/e4/')) return 'e4';
  return null;
}

/** 记住这个平台最后停留的页面（path + search）；不属于该平台的路径忽略。 */
export function rememberWorkspacePath(workspace, pathWithSearch) {
  if (!WORKSPACES[workspace]) return;
  if (workspaceOfPath(pathWithSearch) !== workspace) return;
  try {
    sessionStorage.setItem(PATH_KEY(workspace), String(pathWithSearch));
    sessionStorage.setItem(LAST_KEY, workspace);
  } catch { /* 隐私模式：不记忆，切平台时回平台首页 */ }
}

/** 该平台上次停留的页面；没有记录或记录已损坏时回平台首页。 */
export function lastWorkspacePath(workspace) {
  const fallback = WORKSPACES[workspace] || '/';
  try {
    const saved = sessionStorage.getItem(PATH_KEY(workspace));
    if (saved && workspaceOfPath(saved) === workspace) return saved;
  } catch { /* 隐私模式：按没有记录处理 */ }
  return fallback;
}

/** 本标签页最后使用的平台；没有记录时 null。 */
export function lastWorkspace() {
  try {
    const saved = sessionStorage.getItem(LAST_KEY);
    if (saved === 'tracker' || saved === 'e4') return saved;
  } catch { /* 隐私模式：按没有记录处理 */ }
  return null;
}

/** `/` 落到哪个平台：本标签页上次用过的优先，其次 profile.default_workspace（默认 E4）。 */
export function rootWorkspace(profile) {
  return lastWorkspace() || (profile?.default_workspace === 'tracker' ? 'tracker' : 'e4');
}
