/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],

  // Runs before the test framework and before any src module is imported, so
  // src/config/env.ts sees a fully populated environment.
  setupFiles: ['<rootDir>/tests/setup.ts'],

  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },

  // Must mirror the "paths" block in tsconfig.json.
  moduleNameMapper: {
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // Spec 0.4: 80% line coverage on src/, excluding config and migrations.
  // server.ts is the process bootstrap (listen + signal handlers) and cannot be
  // exercised without binding a port.
  collectCoverageFrom: ['src/**/*.ts', '!src/config/**', '!src/types/**', '!src/server.ts'],
  coverageThreshold: {
    global: { lines: 80, statements: 80, functions: 80, branches: 70 },
  },
  coverageReporters: ['text-summary', 'lcov'],

  clearMocks: true,
  restoreMocks: true,
  testTimeout: 15000,
  verbose: false,
};
