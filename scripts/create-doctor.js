// Creates a doctor account, or resets the password of an existing one.
//
// Usage:
//   npm run create-doctor -- <hospitalId> <doctorId> <password> [doctor name]
//
// Example:
//   npm run create-doctor -- HOSP-2291 DR-0148 "a-strong-password" "Dr. Priya Nair"

const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");
require("dotenv").config({ quiet: true });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "carepulse";

async function main() {
  const [hospitalId, doctorId, password, ...nameParts] = process.argv.slice(2);
  const doctorName = nameParts.join(" ").trim();

  if (!hospitalId || !doctorId || !password) {
    console.error("Usage: npm run create-doctor -- <hospitalId> <doctorId> <password> [doctor name]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("❌ Password must contain at least 8 characters.");
    process.exit(1);
  }
  if (!MONGO_URI) {
    console.error("❌ Set MONGO_URI in .env first.");
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    const now = new Date();

    const result = await client
      .db(DB_NAME)
      .collection("doctors")
      .updateOne(
        { hospitalId, doctorId },
        {
          $set: { doctorName, password: await bcrypt.hash(password, 10), updatedAt: now },
          $setOnInsert: { createdAt: now }
        },
        { upsert: true }
      );

    const action = result.upsertedCount ? "created" : "updated";
    console.log(`✅ Doctor ${doctorId} at ${hospitalId} ${action}.`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("❌", error.message);
  process.exit(1);
});
