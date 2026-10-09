import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import E4IntakePage from '../src/pages/e4/E4IntakePage.jsx';
import Y4LinkModal from '../src/components/e4/Y4LinkModal.jsx';

// R1/R2 回归：建档时必须把 Y4 关联一起落库，且已关联的学生不必重选。
jest.mock('../src/lib/useAuth.js', () => ({
  useAuth: () => ({ profile: { id: 'mentor-1', role: 2 }, user: { id: 'mentor-1' }, loading: false }),
}));

jest.mock('../src/lib/y4api.js', () => {
  class Y4ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  return {
    listStudents: jest.fn(),
    listReports: jest.fn(),
    fetchProtocol: jest.fn(),
    Y4ApiError,
  };
});

jest.mock('../src/lib/e4Store.js', () => ({
  createE4Student: jest.fn(),
  createFirstReport: jest.fn(),
  updateE4Student: jest.fn(),
}));

import { listStudents, listReports, fetchProtocol, Y4ApiError } from '../src/lib/y4api.js';
import { createE4Student, createFirstReport, updateE4Student } from '../src/lib/e4Store.js';

const SEAN = { id: 48, name: 'Sean', gender: '男', grade: '初一', school: 'Shsid', report_count: 1 };
const REPORT = { id: 46, report_date: '2026-10-08', created_at: '2026-10-08T06:56:30' };

beforeEach(() => {
  jest.clearAllMocks();
  listStudents.mockResolvedValue([SEAN]);
  listReports.mockResolvedValue([REPORT]);
  createE4Student.mockResolvedValue({ id: 'e4-1' });
  createFirstReport.mockResolvedValue({ id: 'r-1' });
  updateE4Student.mockResolvedValue({ id: 'e4-1' });
});

function renderIntake() {
  return render(
    <MemoryRouter>
      <E4IntakePage />
    </MemoryRouter>,
  );
}

// 走到 Step 2（已选 Y4 学生、报告列表已就绪）
async function goToStep2() {
  renderIntake();
  fireEvent.change(screen.getByPlaceholderText(/输入学生名字/), { target: { value: 'Sean' } });
  const candidate = await screen.findByText('Sean', {}, { timeout: 3000 });
  fireEvent.click(candidate);
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  await screen.findByText('Y4 报告 #46');
}

describe('建档时持久化 Y4 关联（R1）', () => {
  it('选好报告后建档：四个 y4_* 字段一起写入', async () => {
    await goToStep2();
    fireEvent.click(screen.getByRole('button', { name: '建档并自动提取 E4 数据' }));

    await waitFor(() => expect(createE4Student).toHaveBeenCalledTimes(1));
    expect(createE4Student.mock.calls[0][0]).toMatchObject({
      display_name: 'Sean',
      y4_student_id: 48,
      y4_report_id: 46,
      y4_student_name: 'Sean',
      y4_report_date: '2026-10-08',
    });
  });

  it('协议拉取失败后，档案里仍保留 Y4 关联（关页面也不用重选）', async () => {
    fetchProtocol.mockRejectedValue(new Y4ApiError('上游超时', 502));
    await goToStep2();
    fireEvent.click(screen.getByRole('button', { name: '建档并自动提取 E4 数据' }));

    await screen.findByText('上游超时');
    expect(createE4Student.mock.calls[0][0]).toMatchObject({ y4_student_id: 48, y4_report_id: 46 });
  });
});

describe('报告列表拉不到时的兜底（R2b）', () => {
  it('列表失败时给出「先建档，稍后选报告」，只写 Y4 学生不写报告', async () => {
    listReports.mockRejectedValue(new Y4ApiError('Y4 报告列表加载失败', 502));
    renderIntake();
    fireEvent.change(screen.getByPlaceholderText(/输入学生名字/), { target: { value: 'Sean' } });
    fireEvent.click(await screen.findByText('Sean', {}, { timeout: 3000 }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    const fallback = await screen.findByRole('button', { name: '先建档，稍后选报告' });
    fireEvent.click(fallback);

    await waitFor(() => expect(createE4Student).toHaveBeenCalledTimes(1));
    const payload = createE4Student.mock.calls[0][0];
    expect(payload).toMatchObject({ display_name: 'Sean', y4_student_id: 48, y4_student_name: 'Sean' });
    expect(payload).not.toHaveProperty('y4_report_id');
  });
});

describe('Y4LinkModal 的 initialY4Student（R2b）', () => {
  it('已有 Y4 学生时打开即进选报告那一步，无需再搜学生', async () => {
    render(
      <Y4LinkModal
        open
        student={{ id: 'e4-1', display_name: 'Sean' }}
        initialY4Student={{ id: 48, name: 'Sean' }}
        onClose={() => {}}
      />,
    );

    await screen.findByText('Y4 报告 #46');
    expect(listReports).toHaveBeenCalledWith(48);
    // 跳过 Step 1：没有学生搜索框
    expect(screen.queryByPlaceholderText('按姓名搜索 Y4 学生')).toBeNull();
  });
});
