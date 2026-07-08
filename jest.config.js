module.exports = {
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/src/test/setup-after-env.js"],
  testTimeout: 30000,
  testMatch: ["**/*.test.js"],
};
