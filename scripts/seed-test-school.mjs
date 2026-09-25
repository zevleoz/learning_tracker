// 为 test@school.edu 生成 UI 测试假数据（课程树 + 4 周学习记录 + 待补填 + 成绩）
// 用法: node scripts/seed-test-school.mjs
// 读取 .env 的 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（不打印密钥）
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  ['.env.local', '.env']
    .flatMap((f) => { try { return readFileSync(join(root, f), 'utf8').split('\n'); } catch { return []; } })
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
    .reverse() // .env 的 VITE_* 覆盖 .env.local 同名（后者本来也没有）
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const EMAIL = 'test@school.edu';
const PASSWORD = '111111';

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dateStr(d); };
const t = (h, m) => `${pad(h)}:${pad(m)}:00`;

async function main() {
  // 1. 登录
  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signInErr) {
    console.error('登录失败:', signInErr.message, '（请确认账号已在该 Supabase 项目注册）');
    process.exit(1);
  }
  const uid = signIn.user.id;
  console.log('登录成功, uid =', uid);

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', uid).maybeSingle();
  const schoolId = profile?.school_id || null;

  // 2. 课程树（幂等：按 name+created_by 跳过已存在）
  const COURSE_TREE = [
    { name: '数学', type: 1, chapters: [['函数与导数', ['函数概念与性质', '导数及其应用']], ['三角函数', ['诱导公式', '图像与性质']], ['数列', ['等差数列', '等比数列']]] },
    { name: '物理', type: 1, chapters: [['牛顿运动定律', ['受力分析', '牛二应用']], ['电磁学', ['电场', '电路基础']]] },
    { name: '英语', type: 1, chapters: [['阅读理解', ['细节理解题', '推理判断题']], ['写作', ['应用文', '读后续写']]] },
    { name: '化学', type: 1, chapters: [['氧化还原', ['基本概念', '方程式配平']], ['有机化学', ['烃', '烃的衍生物']]] },
    { name: '数学培优班', type: 2, chapters: [['竞赛专题', ['不等式', '平面几何']]] },
  ];

  const { data: existing } = await supabase.from('courses').select('id, name').eq('created_by', uid).is('deleted_at', null);
  const existingNames = new Set((existing || []).map((c) => c.name));
  const courseIds = {}; // name -> { id, chapters: { chName: { id, units: { uName: id } } } }

  for (const c of COURSE_TREE) {
    if (existingNames.has(c.name)) { console.log('课程已存在，跳过:', c.name); continue; }
    const { data: course, error } = await supabase
      .from('courses')
      .insert({ name: c.name, subject: '', course_type: c.type, school_id: schoolId, created_by: uid })
      .select('id').single();
    if (error) { console.error('建课失败', c.name, error.message); continue; }
    courseIds[c.name] = { id: course.id, chapters: {} };
    for (let ci = 0; ci < c.chapters.length; ci++) {
      const [chName, units] = c.chapters[ci];
      const { data: ch } = await supabase.from('chapters').insert({ course_id: course.id, name: chName, order_idx: ci + 1 }).select('id').single();
      courseIds[c.name].chapters[chName] = { id: ch.id, units: {} };
      for (let ui = 0; ui < units.length; ui++) {
        const { data: u } = await supabase.from('units').insert({ chapter_id: ch.id, name: units[ui], order_idx: ui + 1 }).select('id').single();
        courseIds[c.name].chapters[chName].units[units[ui]] = u.id;
      }
    }
    console.log('建课完成:', c.name);
  }

  // 已有课程也要拿到 id（供记录引用）
  const { data: allCourses } = await supabase
    .from('courses')
    .select('id, name, chapters(id, name, units(id, name))')
    .eq('created_by', uid).is('deleted_at', null);
  const byName = {};
  for (const c of allCourses || []) {
    byName[c.name] = { id: c.id, chapters: {} };
    for (const ch of c.chapters || []) {
      byName[c.name].chapters[ch.name] = { id: ch.id, units: Object.fromEntries((ch.units || []).map((u) => [u.name, u.id])) };
    }
  }

  // 3. 清空旧记录
  await supabase.from('learning_sessions').delete().eq('student_id', uid);
  await supabase.from('exam_scores').delete().eq('student_id', uid);
  console.log('已清空旧学习记录与成绩');

  // 4. 生成 4 周学习记录
  // ref(name) 返回 { course_id, chapter_id, unit_id }，从每门课第一章第一节取样
  const ref = (name, chIdx = 0, uIdx = 0) => {
    const c = byName[name];
    if (!c) return { course_id: null };
    const chs = Object.values(c.chapters);
    const ch = chs[Math.min(chIdx, chs.length - 1)];
    const us = ch ? Object.values(ch.units) : [];
    return { course_id: c.id, chapter_id: ch?.id || null, unit_id: us[Math.min(uIdx, Math.max(us.length - 1, 0))] || null };
  };

  const FORMS = { 1: ['自主预习', '学校课堂', '校外线上', '校外线下'], 2: ['自主复习', '错题重做'], 3: ['学校作业', '自主练习', '课外刷题'] };
  const GRADES = ['C+', 'B-', 'B', 'B', 'B+', 'B+', 'A-', 'A-', 'A'];
  const SELF = [60, 80, 80, 80, 100];

  const sessions = [];
  let rng = 42;
  const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const CORE = ['数学', '物理', '英语', '化学'];
  for (let ago = 27; ago >= 0; ago--) {
    // 每周随机 1-2 天休息
    if (rand() < 0.22) continue;
    const nSessions = 2 + Math.floor(rand() * 3); // 每天 2-4 条
    let hour = 15 + Math.floor(rand() * 3);
    for (let s = 0; s < nSessions; s++) {
      const courseName = rand() < 0.15 ? '数学培优班' : CORE[Math.floor(rand() * CORE.length)];
      const category = rand() < 0.5 ? 1 : rand() < 0.6 ? 2 : 3;
      const dur = 25 + Math.floor(rand() * 8) * 5; // 25-60
      const startH = hour; hour += 1 + Math.floor(rand() * 2);
      const endMin = Math.floor(rand() * 60);
      const r = ref(courseName, Math.floor(rand() * 2), Math.floor(rand() * 2));
      const base = {
        student_id: uid,
        ...r,
        category,
        form: pick(FORMS[category]),
        duration_minutes: dur,
        session_date: daysAgo(ago),
        start_time: t(Math.min(startH, 22), Math.floor(rand() * 60)),
        end_time: t(Math.min(startH + Math.floor(dur / 60), 23), endMin),
        self_rating: pick(SELF),
        notes: null,
      };
      if (category === 3) {
        // 练习：默认给客观等第；待补填在生成后确定性指定
        base.eval_type = 2; base.grade_label = pick(GRADES);
      } else {
        base.eval_type = 1; base.grade_label = null;
      }
      sessions.push(base);
    }
  }

  // 最近 2 天各补一条「待补填」练习（category=3 且无客观评价）
  [['数学', 1], ['物理', 0]].forEach(([courseName, ago], i) => {
    const r = ref(courseName);
    if (!r.course_id) return;
    sessions.push({
      student_id: uid,
      ...r,
      category: 3,
      form: '课外刷题',
      eval_type: 1,
      grade_label: null,
      duration_minutes: 35 + i * 10,
      session_date: daysAgo(ago),
      start_time: t(20 + i, 30),
      end_time: t(21 + i, 15),
      self_rating: 80,
      notes: null,
    });
  });
  const { error: sessErr } = await supabase.from('learning_sessions').insert(sessions);
  if (sessErr) { console.error('学习记录插入失败:', sessErr.message); process.exit(1); }
  console.log(`已插入 ${sessions.length} 条学习记录（含 ${sessions.filter((s) => s.category === 3 && !s.grade_label).length} 条待补填）`);

  // 5. 校内课程成绩
  const EXAMS = ['9月月考', '10月期中', '11月月考', '12月模拟'];
  const scores = [];
  for (const name of CORE) {
    const c = byName[name];
    if (!c) continue;
    const base = { 数学: 82, 物理: 68, 英语: 75, 化学: 79 }[name] || 75;
    EXAMS.forEach((exam_name, i) => {
      const score = Math.min(100, base + i * 2 + Math.floor(rand() * 5));
      scores.push({
        student_id: uid,
        course_id: c.id,
        exam_name,
        exam_date: daysAgo(90 - i * 25),
        score,
        grade_label: score >= 90 ? 'A' : score >= 85 ? 'A-' : score >= 80 ? 'B+' : score >= 75 ? 'B' : score >= 70 ? 'B-' : 'C+',
        notes: null,
      });
    });
  }
  const { error: scoreErr } = await supabase.from('exam_scores').insert(scores);
  if (scoreErr) { console.error('成绩插入失败:', scoreErr.message); process.exit(1); }
  console.log(`已插入 ${scores.length} 条成绩`);

  console.log('=== 完成 ===');
}

main().catch((e) => { console.error(e); process.exit(1); });
