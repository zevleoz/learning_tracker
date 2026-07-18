import { COURSE_TYPE, getCourseTypeLabel, getCourseTypeShortLabel, getCourseTypeColor, validateCourseName, validateCourseType } from '../src/utils/courseUtils';

describe('courseUtils', () => {
  describe('COURSE_TYPE', () => {
    it('should define INTERNAL as 1', () => {
      expect(COURSE_TYPE.INTERNAL).toBe(1);
    });

    it('should define EXTERNAL as 2', () => {
      expect(COURSE_TYPE.EXTERNAL).toBe(2);
    });
  });

  describe('getCourseTypeLabel', () => {
    it('should return 校内课程 for INTERNAL type', () => {
      expect(getCourseTypeLabel(COURSE_TYPE.INTERNAL)).toBe('校内课程');
    });

    it('should return 校外课程 for EXTERNAL type', () => {
      expect(getCourseTypeLabel(COURSE_TYPE.EXTERNAL)).toBe('校外课程');
    });

    it('should return 校内课程 for unknown type', () => {
      expect(getCourseTypeLabel(3)).toBe('校内课程');
      expect(getCourseTypeLabel(null)).toBe('校内课程');
      expect(getCourseTypeLabel(undefined)).toBe('校内课程');
    });
  });

  describe('getCourseTypeShortLabel', () => {
    it('should return 校内 for INTERNAL type', () => {
      expect(getCourseTypeShortLabel(COURSE_TYPE.INTERNAL)).toBe('校内');
    });

    it('should return 校外 for EXTERNAL type', () => {
      expect(getCourseTypeShortLabel(COURSE_TYPE.EXTERNAL)).toBe('校外');
    });

    it('should return 校内 for unknown type', () => {
      expect(getCourseTypeShortLabel(3)).toBe('校内');
    });
  });

  describe('getCourseTypeColor', () => {
    it('should return gray for INTERNAL type', () => {
      expect(getCourseTypeColor(COURSE_TYPE.INTERNAL)).toBe('#64748b');
    });

    it('should return amber for EXTERNAL type', () => {
      expect(getCourseTypeColor(COURSE_TYPE.EXTERNAL)).toBe('#f59e0b');
    });

    it('should return gray for unknown type', () => {
      expect(getCourseTypeColor(3)).toBe('#64748b');
    });
  });

  describe('validateCourseName', () => {
    it('should return error for empty name', () => {
      expect(validateCourseName('')).toBe('请填写课程名称');
      expect(validateCourseName('   ')).toBe('请填写课程名称');
      expect(validateCourseName(null)).toBe('请填写课程名称');
      expect(validateCourseName(undefined)).toBe('请填写课程名称');
    });

    it('should return null for valid name', () => {
      expect(validateCourseName('数学')).toBeNull();
      expect(validateCourseName('高等数学')).toBeNull();
      expect(validateCourseName('  物理实验  ')).toBeNull();
    });

    it('should return error for name exceeding 100 characters', () => {
      const longName = 'a'.repeat(101);
      expect(validateCourseName(longName)).toBe('课程名称不能超过100个字符');
    });

    it('should return null for name exactly 100 characters', () => {
      const exactName = 'a'.repeat(100);
      expect(validateCourseName(exactName)).toBeNull();
    });
  });

  describe('validateCourseType', () => {
    it('should return null for INTERNAL type', () => {
      expect(validateCourseType(COURSE_TYPE.INTERNAL)).toBeNull();
    });

    it('should return null for EXTERNAL type', () => {
      expect(validateCourseType(COURSE_TYPE.EXTERNAL)).toBeNull();
    });

    it('should return error for invalid type', () => {
      expect(validateCourseType(0)).toBe('请选择课程类型');
      expect(validateCourseType(3)).toBe('请选择课程类型');
      expect(validateCourseType(null)).toBe('请选择课程类型');
      expect(validateCourseType(undefined)).toBe('请选择课程类型');
    });
  });
});