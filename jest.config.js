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
    // src/lib 内部文件互相引用时写的是 ./supabase / ./useAuth
    '^./supabase$': '<rootDir>/src/__mocks__/supabase.js',
    '^./supabase.js$': '<rootDir>/src/__mocks__/supabase.js',
    '^./useAuth$': '<rootDir>/src/__mocks__/useAuth.js',
    '^./useAuth.js$': '<rootDir>/src/__mocks__/useAuth.js',
  },
  setupFiles: ['<rootDir>/src/__mocks__/setupEnv.js'],
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/__tests__/**/*.test.jsx',
    '**/*.test.js',
    '**/*.test.jsx',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '<rootDir>/.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
};