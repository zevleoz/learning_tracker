export const COURSE_TYPE = {
  INTERNAL: 1,
  EXTERNAL: 2,
};

export function getCourseTypeLabel(type) {
  if (type === COURSE_TYPE.EXTERNAL) {
    return '校外课程';
  }
  return '校内课程';
}

export function getCourseTypeShortLabel(type) {
  if (type === COURSE_TYPE.EXTERNAL) {
    return '校外';
  }
  return '校内';
}

export function getCourseTypeColor(type) {
  if (type === COURSE_TYPE.EXTERNAL) {
    return '#f59e0b';
  }
  return '#64748b';
}

export function validateCourseName(name) {
  if (!name || !name.trim()) {
    return '请填写课程名称';
  }
  if (name.trim().length > 100) {
    return '课程名称不能超过100个字符';
  }
  return null;
}

export function validateCourseType(type) {
  if (type !== COURSE_TYPE.INTERNAL && type !== COURSE_TYPE.EXTERNAL) {
    return '请选择课程类型';
  }
  return null;
}