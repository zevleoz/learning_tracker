export default {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(js|jsx|mjs)$': 'babel-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // identity-obj-proxy 并未安装，改用已有的空桩，否则任何 import '*.css' 的组件都无法被测试
    '\\.(css|less|scss|sass)$': '<rootDir>/src/__mocks__/fileMock.js',
    '\\.(png|jpg|jpeg|gif|svg)$': '<rootDir>/src/__mocks__/fileMock.js',
    '^../lib/supabase$': '<rootDir>/src/__mocks__/supabase.js',
    '^../lib/supabase.js$': '<rootDir>/src/__mocks__/supabase.js',
    // src/components/<dir>/ 下的组件
    '^../../lib/supabase(\\.js)?$': '<rootDir>/src/__mocks__/supabase.js',
    '^../lib/useAuth$': '<rootDir>/src/__mocks__/useAuth.js',
    '^../lib/useAuth.js$': '<rootDir>/src/__mocks__/useAuth.js',
    // push.js 含 import.meta.env（jest 的 CJS 转换无法解析），统一换成空桩；
    // 需要断言推送行为的测试用 jest.mock('../src/lib/push.js', factory) 覆盖（映射后同一路径）。
    // push.js 自己的单测（push.test.js）直接读源码，不受影响。
    '(^|/)lib/push(\\.js)?$': '<rootDir>/src/__mocks__/push.js',
    '^./push(\\.js)?$': '<rootDir>/src/__mocks__/push.js',
    // src/lib 内部文件互相引用时写的是 ./supabase / ./useAuth
    '^./supabase$': '<rootDir>/src/__mocks__/supabase.js',
    '^./supabase.js$': '<rootDir>/src/__mocks__/supabase.js',
    '^./useAuth$': '<rootDir>/src/__mocks__/useAuth.js',
    '^./useAuth.js$': '<rootDir>/src/__mocks__/useAuth.js',
  },
  setupFiles: ['<rootDir>/src/__mocks__/setupEnv.js'],
  // 懒加载页面 + 高负载机器：单个用例上限放宽到 15 秒（见 setupCache.js 的 asyncUtilTimeout）
  testTimeout: 15000,
  setupFilesAfterEnv: ['@testing-library/jest-dom', '<rootDir>/src/__mocks__/setupCache.js'],
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/__tests__/**/*.test.jsx',
    '**/*.test.js',
    '**/*.test.jsx',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '<rootDir>/.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
};