const { startTestDb, stopTestDb, clearTestDb } = require("./db-test-helper");

beforeAll(async () => {
  await startTestDb();
});

afterEach(async () => {
  await clearTestDb();
});

afterAll(async () => {
  await stopTestDb();
});
