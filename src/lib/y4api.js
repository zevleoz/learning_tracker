// Y4 综合测评 API 客户端。
// 浏览器只调用同源 /api/y4/* 代理；API Key 由服务端注入，此处不持有任何密钥。
// 代理要求导师及以上登录态，请求携带 Supabase access_token。

import { getAccessToken } from './supabase.js';

const BASE = '/api/y4';

export class Y4ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'Y4ApiError';
    this.status = status;
  }
}

const STATUS_MESSAGES = {
  401: '登录状态无效或已过期，请重新登录后重试；若仍失败请联系管理员检查 Y4 密钥',
  403: '仅导师及以上账号可使用 Y4 相关功能',
  404: 'Y4 中未找到该资源（学生或报告可能不存在 / 报告文件已被清理）',
  429: 'Y4 请求过于频繁（每分钟上限 60 次），请稍后重试',
  503: '服务端尚未完成配置（Y4 密钥或登录校验环境变量），请联系管理员',
};

async function request(path, { signal } = {}) {
  let res;
  try {
    const token = await getAccessToken();
    res = await fetch(`${BASE}/${path}`, {
      method: 'GET',
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Y4ApiError('无法连接 Y4 代理，请检查网络后重试', 0);
  }

  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    let message = STATUS_MESSAGES[res.status] || '';
    try {
      if (contentType.includes('application/json')) {
        const data = await res.json();
        message = message || (data && data.error) || `Y4 请求失败（HTTP ${res.status}）`;
      }
    } catch {
      /* 保留默认消息 */
    }
    throw new Y4ApiError(message || `Y4 请求失败（HTTP ${res.status}）`, res.status);
  }

  return res;
}

/**
 * Y4 学生列表。query 非空时在客户端按姓名做包含过滤（API 无搜索参数）。
 * @returns {Promise<Array>}
 */
export async function listStudents(query = '', { signal } = {}) {
  const res = await request('students', { signal });
  const data = await res.json();
  const students = Array.isArray(data.students) ? data.students : [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return students;
  return students.filter((s) => String(s.name || '').toLowerCase().includes(q));
}

/**
 * 指定 Y4 学生的报告列表（按创建时间倒序）。
 * @returns {Promise<Array<{id:number, report_date:string, created_at:string, interpretation?:string}>>}
 */
export async function listReports(y4StudentId, { signal } = {}) {
  if (!y4StudentId) throw new Y4ApiError('缺少 Y4 学生 ID', 400);
  const res = await request(`students/${encodeURIComponent(y4StudentId)}/reports`, { signal });
  const data = await res.json();
  return Array.isArray(data.reports) ? data.reports : [];
}

/**
 * 实时生成并拉取 E4 评估协议 Markdown（10-30 秒，可通过 signal 取消）。
 * @returns {Promise<string>} markdown 全文
 */
export async function fetchProtocol(y4ReportId, { signal } = {}) {
  if (!y4ReportId) throw new Y4ApiError('缺少 Y4 报告 ID', 400);
  const res = await request(`reports/${encodeURIComponent(y4ReportId)}/e4-protocol`, { signal });
  return res.text();
}

/**
 * 人类可读的 Y4 报告 Markdown（备选参考）。
 * @returns {Promise<string>}
 */
export async function fetchY4Markdown(y4ReportId, { includeRaw = true, signal } = {}) {
  if (!y4ReportId) throw new Y4ApiError('缺少 Y4 报告 ID', 400);
  const suffix = includeRaw ? '?include_raw=1' : '';
  const res = await request(`reports/${encodeURIComponent(y4ReportId)}/y4-md${suffix}`, { signal });
  return res.text();
}
