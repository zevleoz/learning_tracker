// E4 平台数据访问层（Supabase）。RLS 已限定仅导师/管理员可读写。
import { supabase, timeoutSignal } from './supabase.js';
import { prepMeetingPatch, extractNextReviewDate } from './e4MeetingSync.js';

export class E4StoreError extends Error {}

async function unwartch(promise, label) {
  const { data, error } = await promise;
  if (error) throw new E4StoreError(`${label}失败：${error.message}`);
  return data;
}

// ---- 工作区偏好 ----

export async function updateWorkspace(userId, workspace) {
  if (!['e4', 'tracker'].includes(workspace)) throw new E4StoreError('非法的工作区偏好值');
  const { error } = await supabase
    .from('profiles')
    .update({ default_workspace: workspace, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw new E4StoreError(`保存偏好失败：${error.message}`);
}

// ---- E4 学生 ----

export async function listE4Students() {
  return unwartch(
    supabase
      .from('e4_students')
      .select('*, advisor:advisor_id(full_name), tracker:tracker_profile_id(full_name)')
      .order('created_at', { ascending: false })
      .limit(500), // 防御性上限；共享池规模到了再做真正分页（E4-1）
    '读取 E4 学生列表'
  );
}

export async function getE4Student(id) {
  const data = await unwartch(
    supabase
      .from('e4_students')
      .select('*, advisor:advisor_id(full_name), tracker:tracker_profile_id(full_name)')
      .eq('id', id)
      .maybeSingle(),
    '读取 E4 学生'
  );
  return data;
}

export async function listReportsForStudent(e4StudentId) {
  return unwartch(
    supabase
      .from('e4_reports')
      .select('*')
      .eq('e4_student_id', e4StudentId)
      .order('created_at', { ascending: false }),
    '读取报告列表'
  );
}

export async function createE4Student(input) {
  const row = {
    display_name: input.display_name?.trim(),
    next_meeting_type: input.next_meeting_type === 'progress' ? 'progress' : 'first',
    next_meeting_date: input.next_meeting_date || null,
    gender: input.gender || null,
    grade: input.grade || null,
    school: input.school || null,
    advisor_id: input.advisor_id || null,
    tracker_profile_id: input.tracker_profile_id || null,
    notes: input.notes || null,
    created_by: input.created_by || null,
  };
  if (!row.display_name) throw new E4StoreError('学生姓名不能为空');
  return unwartch(supabase.from('e4_students').insert(row).select().single(), '创建 E4 学生');
}

export async function updateE4Student(id, patch) {
  return unwartch(
    supabase.from('e4_students').update(patch).eq('id', id).select().single(),
    '更新 E4 学生'
  );
}

// 软归档（E4-2）：误建档的学生不硬删除，默认从列表/待办中隐藏
export async function setE4StudentArchived(id, archived = true) {
  const { error } = await supabase.rpc(
    archived ? 'archive_e4_student' : 'unarchive_e4_student',
    { p_student_id: id }
  );
  if (error) {
    const hint = /function|schema cache|archive_e4_student/i.test(error.message || '')
      ? '（数据库未执行 007 迁移）'
      : '';
    throw new E4StoreError(`归档操作失败：${error.message}${hint}`);
  }
}

// ---- E4 报告 ----

// 报告保存后把「下次复盘时间」同步到学生档案，供待办事项使用。
// 字段按报告类型分派（first 在 section07、progress 在 p8，见 e4MeetingSync）。
// 数据库补丁（schema.patch-e4-next-meeting.sql）未执行时静默降级，不影响报告保存。
async function syncNextMeetingFromForm(e4StudentId, reportType, formData) {
  if (!e4StudentId) return;
  const date = extractNextReviewDate(reportType, formData);
  if (!date) return;
  try {
    await supabase
      .from('e4_students')
      .update({ next_meeting_date: date, next_meeting_type: 'progress' })
      .eq('id', e4StudentId);
  } catch {}
}

// 会前准备保存后把会议日期同步到学生档案：待办事项从「待安排」变为已排期。
// 仅当学生仍处于 first 阶段时更新；已进入 progress 阶段不被会前日期覆盖。
async function syncPrepMeetingDate(e4StudentId, formData) {
  if (!e4StudentId) return;
  try {
    const { data: student } = await supabase
      .from('e4_students')
      .select('next_meeting_date, next_meeting_type')
      .eq('id', e4StudentId)
      .maybeSingle();
    const patch = prepMeetingPatch(formData, student);
    if (!patch) return;
    await supabase.from('e4_students').update(patch).eq('id', e4StudentId);
  } catch {}
}

export async function createFirstReport({ e4StudentId, createdBy, protocolMd, formData }) {
  const data = await unwartch(
    supabase
      .from('e4_reports')
      .insert({
        e4_student_id: e4StudentId,
        report_type: 'first',
        status: 'draft',
        protocol_md: protocolMd,
        protocol_fetched_at: new Date().toISOString(),
        form_data: formData || {},
        created_by: createdBy,
      })
      .select()
      .single(),
    '创建报告记录'
  );
  await syncNextMeetingFromForm(e4StudentId, 'first', formData);
  return data;
}

export async function getReport(id) {
  return unwartch(
    supabase.from('e4_reports').select('*').eq('id', id).maybeSingle(),
    '读取报告'
  );
}

// ---- 会前准备（report_type='prep'，复用 e4_reports）----

export async function createPrepReport({ e4StudentId, createdBy, protocolMd, formData }) {
  const data = await unwartch(
    supabase
      .from('e4_reports')
      .insert({
        e4_student_id: e4StudentId,
        report_type: 'prep',
        status: 'draft',
        protocol_md: protocolMd,
        protocol_fetched_at: new Date().toISOString(),
        form_data: formData || {},
        created_by: createdBy,
      })
      .select()
      .single(),
    '创建会前准备'
  );
  await syncPrepMeetingDate(e4StudentId, formData);
  return data;
}

export async function createProgressReport({ e4StudentId, createdBy, formData, reportDate }) {
  const data = await unwartch(
    supabase
      .from('e4_reports')
      .insert({
        e4_student_id: e4StudentId,
        report_type: 'progress',
        status: 'draft',
        report_date: reportDate || null,
        form_data: formData || {},
        created_by: createdBy,
      })
      .select()
      .single(),
    '创建过程报告'
  );
  await syncNextMeetingFromForm(e4StudentId, 'progress', formData);
  return data;
}

export async function updateReport(id, patch) {
  const data = await unwartch(
    supabase.from('e4_reports').update(patch).eq('id', id).select().single(),
    '保存报告'
  );
  if (patch?.form_data && ['first', 'progress'].includes(data?.report_type)) {
    await syncNextMeetingFromForm(data.e4_student_id, data.report_type, patch.form_data);
  } else if (patch?.form_data && data?.report_type === 'prep') {
    await syncPrepMeetingDate(data.e4_student_id, patch.form_data);
  }
  return data;
}

export async function deleteReport(id) {
  const { data, error } = await supabase.from('e4_reports').delete().eq('id', id).select('id');
  if (error) throw new E4StoreError(`删除报告失败：${error.message}`);
  if (!data || data.length === 0) throw new E4StoreError('删除失败：报告不存在或没有删除权限');
}

// ---- 待办事项（upcoming 会议）----

// 返回每位学生的下次会议信息 + 已触达次数（first/progress 报告数）+
// 跳转目标（最新会前准备 / 最新报告），按会议日期升序，未安排日期的排在最后。
export async function listUpcomingMeetings() {
  const [students, reports] = await Promise.all([
    unwartch(
      supabase
        .from('e4_students')
        .select('id, display_name, grade, school, next_meeting_date, next_meeting_type')
        .order('created_at', { ascending: false })
        .limit(500)
        .abortSignal(timeoutSignal(30000)),
      '读取待办学生'
    ),
    unwartch(
      supabase
        .from('e4_reports')
        .select('id, e4_student_id, report_type, created_at')
        .order('created_at', { ascending: false })
        .limit(2000) // 触达计数只需报告条数，加防御上限（E4-1）
        .abortSignal(timeoutSignal(30000)),
      '读取触达记录'
    ),
  ]);
  // 已归档学生不进待办：单独取归档标记（007 迁移未执行时静默跳过过滤）
  const archivedIds = new Set();
  const archRes = await supabase
    .from('e4_students')
    .select('id, archived_at')
    .limit(500);
  if (!archRes.error) {
    for (const r of archRes.data || []) if (r.archived_at) archivedIds.add(r.id);
  }

  const touchCounts = {};
  const latestPrepId = {};
  const latestReportId = {};
  for (const r of reports || []) {
    if (['first', 'progress'].includes(r.report_type)) {
      touchCounts[r.e4_student_id] = (touchCounts[r.e4_student_id] || 0) + 1;
      if (!latestReportId[r.e4_student_id]) latestReportId[r.e4_student_id] = r.id;
    } else if (r.report_type === 'prep' && !latestPrepId[r.e4_student_id]) {
      latestPrepId[r.e4_student_id] = r.id;
    }
  }
  return (students || [])
    .filter((s) => !archivedIds.has(s.id))
    .map((s) => ({
      ...s,
      touch_count: touchCounts[s.id] || 0,
      latest_prep_id: latestPrepId[s.id] || null,
      latest_report_id: latestReportId[s.id] || null,
    }))
    .sort((a, b) => {
      if (!a.next_meeting_date && !b.next_meeting_date) return 0;
      if (!a.next_meeting_date) return 1;
      if (!b.next_meeting_date) return -1;
      return a.next_meeting_date < b.next_meeting_date ? -1 : 1;
    });
}

// ---- 成长地图 PDF（Storage 私有 bucket，见 migrations/006）----

const GROWTH_MAP_BUCKET = 'e4-growth-maps';

// 路径约定：{e4_student_id}/{report_id}/{安全文件名}
export function growthMapPath({ e4StudentId, reportId, fileName }) {
  const safe = String(fileName || 'growth-map.pdf')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_') // 保留中英文/数字/._-，其余（空格、斜杠等）替换
    .slice(-80);
  return `${e4StudentId}/${reportId}/${safe}`;
}

export async function uploadGrowthMap({ e4StudentId, reportId, file }) {
  if (!file) throw new E4StoreError('未选择文件');
  const path = growthMapPath({ e4StudentId, reportId, fileName: file.name });
  const { error } = await supabase.storage
    .from(GROWTH_MAP_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || 'application/pdf' });
  if (error) throw new E4StoreError(`上传成长地图失败：${error.message}`);
  return path;
}

// 生成短时签名链接（预览 / 下载）
export async function growthMapUrl(path, { download = false, fileName } = {}) {
  if (!path) return '';
  const options = download ? { download: fileName || true } : undefined;
  const { data, error } = await supabase.storage
    .from(GROWTH_MAP_BUCKET)
    .createSignedUrl(path, 60 * 60, options);
  if (error) throw new E4StoreError(`获取成长地图链接失败：${error.message}`);
  return data?.signedUrl || '';
}

export async function removeGrowthMap(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(GROWTH_MAP_BUCKET).remove([path]);
  if (error) throw new E4StoreError(`删除成长地图失败：${error.message}`);
}

// ---- 一表人才学生（可选关联）----

// PostgREST ilike 的 % _ \ 需要转义，否则用户输入会被当作通配符
function escapeIlike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listTrackerStudents(keyword = '') {
  let query = supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 1)
    .order('full_name')
    .limit(200);
  if (keyword) query = query.ilike('full_name', `%${escapeIlike(keyword)}%`);
  return unwartch(query, '读取一表人才学生');
}
