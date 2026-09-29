// E4 平台数据访问层（Supabase）。RLS 已限定仅导师/管理员可读写。
import { supabase } from './supabase.js';
import { prepMeetingPatch } from './e4MeetingSync.js';

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
      .order('created_at', { ascending: false }),
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
    next_meeting_type: 'first',
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

// ---- E4 报告 ----

// 报告保存后把「下次复盘时间」同步到学生档案，供待办事项使用。
// 数据库补丁（schema.patch-e4-next-meeting.sql）未执行时静默降级，不影响报告保存。
async function syncNextMeetingFromForm(e4StudentId, formData) {
  if (!e4StudentId) return;
  const raw = formData?.section07?.nextReviewDate;
  if (!raw) return;
  // 支持 'yyyy-MM-dd' 和 'yyyy-MM-dd~yyyy-MM-dd' 两种格式；范围取起始日期
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return;
  try {
    await supabase
      .from('e4_students')
      .update({ next_meeting_date: m[1], next_meeting_type: 'progress' })
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
  await syncNextMeetingFromForm(e4StudentId, formData);
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
  await syncNextMeetingFromForm(e4StudentId, formData);
  return data;
}

export async function updateReport(id, patch) {
  const data = await unwartch(
    supabase.from('e4_reports').update(patch).eq('id', id).select().single(),
    '保存报告'
  );
  if (patch?.form_data && ['first', 'progress'].includes(data?.report_type)) {
    await syncNextMeetingFromForm(data.e4_student_id, patch.form_data);
  } else if (patch?.form_data && data?.report_type === 'prep') {
    await syncPrepMeetingDate(data.e4_student_id, patch.form_data);
  }
  return data;
}

export async function deleteReport(id) {
  const { error } = await supabase.from('e4_reports').delete().eq('id', id);
  if (error) throw new E4StoreError(`删除报告失败：${error.message}`);
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
        .order('created_at', { ascending: false }),
      '读取待办学生'
    ),
    unwartch(
      supabase
        .from('e4_reports')
        .select('id, e4_student_id, report_type, created_at')
        .order('created_at', { ascending: false }),
      '读取触达记录'
    ),
  ]);
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

// ---- 一表人才学生（可选关联）----

export async function listTrackerStudents(keyword = '') {
  let query = supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 1)
    .order('full_name')
    .limit(200);
  if (keyword) query = query.ilike('full_name', `%${keyword}%`);
  return unwartch(query, '读取一表人才学生');
}
