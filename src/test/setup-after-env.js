/* Tests never use the real Paystack account in .env. dotenv leaves a key
   that is already set alone, so an empty value here keeps it from loading;
   a test that needs one sets its own fake key at the top of its file. */
process.env.PAYSTACK_SECRET_KEY = "";

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
