const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { MongoClient } = require("mongodb");
require("dotenv").config({ quiet: true });

// ===============================
// CONFIGURATION
// ===============================

const PORT = process.env.PORT || 3000;

// Render is configured with MONGO_URI; older local .env files use MONGODB_URI.
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "carepulse";

// Signs login tokens. Without a fixed secret, everyone is logged out whenever the server restarts.
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString("hex");
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// Optional shared key for monitoring devices that post health readings.
const DEVICE_API_KEY = process.env.DEVICE_API_KEY;

// Keeps each patient document well under MongoDB's 16 MB limit.
const MAX_STORED_READINGS = 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CASE_INSENSITIVE = { locale: "en", strength: 2 };

const app = express();

let db = null;
let dbClient = null;

// ===============================
// MIDDLEWARE
// ===============================

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "100kb" }));

// Express 5 leaves req.body undefined when a request has no JSON body.
app.use((req, res, next) => {
  req.body = req.body || {};
  next();
});

// ===============================
// SERVE FRONTEND
// ===============================

app.use(express.static(path.join(__dirname, "public")));

// ===============================
// HELPERS
// ===============================

function cleanString(value, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeEmail(value) {
  return cleanString(value, 254).toLowerCase();
}

function digitsOnly(value) {
  return cleanString(String(value ?? ""), 30).replace(/\D/g, "");
}

function badRequest(res, message) {
  return res.status(400).json({ message });
}

function isValidDob(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date <= new Date() && date.getUTCFullYear() >= 1900;
}

function ageFromDob(dob) {
  if (!dob) return null;
  const birth = new Date(`${dob}T00:00:00Z`);
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) age--;
  return age >= 0 ? age : null;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS })).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyToken(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;

  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function findParentByEmail(email) {
  return db.collection("parents").findOne({ email }, { collation: CASE_INSENSITIVE });
}

function findPatientForParent(parent) {
  const query = parent.patientId ? { patientId: parent.patientId } : { parentEmail: parent.email };
  return db.collection("patients").findOne(query, { collation: CASE_INSENSITIVE });
}

async function generatePatientId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const patientId = "CP" + crypto.randomInt(100000, 1000000);
    const taken = await db.collection("patients").findOne({ patientId }, { projection: { _id: 1 } });
    if (!taken) return patientId;
  }
  throw new Error("Could not generate a unique patient ID");
}

// ===============================
// ACCESS CONTROL
// ===============================

function requireDatabase(req, res, next) {
  if (db) return next();
  res.status(503).json({
    message: "The database is not connected right now. Please try again in a minute."
  });
}

function authenticate(...roles) {
  return (req, res, next) => {
    const header = req.get("authorization") || "";
    const user = verifyToken(header.replace(/^Bearer\s+/i, ""));

    if (!user || !roles.includes(user.role)) {
      return res.status(401).json({ message: "Please log in again." });
    }

    req.user = user;
    next();
  };
}

function requirePatientAccess(req, res, next) {
  const { user } = req;
  const allowed =
    user.role === "doctor" ||
    (user.role === "parent" && user.patientId === req.params.patientId);

  if (!allowed) {
    return res.status(403).json({ message: "You don't have access to this patient." });
  }
  next();
}

// Devices send the shared key; doctors can also record readings manually.
function authenticateDevice(req, res, next) {
  if (!DEVICE_API_KEY) return next();
  if (safeEqual(req.get("x-device-key") || "", DEVICE_API_KEY)) return next();
  return authenticate("doctor")(req, res, next);
}

// ===============================
// HEALTH CHECK
// ===============================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "CarePulse API is running",
    database: db ? "connected" : "disconnected"
  });
});

app.use("/api", requireDatabase);

// ===============================
// PARENT REGISTRATION
// ===============================

app.post("/api/register", async (req, res) => {
  const patientName = cleanString(req.body.patientName, 100);
  const parentName = cleanString(req.body.parentName, 100);
  const phone = digitsOnly(req.body.phone);
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const dob = cleanString(req.body.dob, 10);
  const gender = cleanString(req.body.gender, 30);
  const address = cleanString(req.body.address, 300);

  if (!patientName || !parentName) return badRequest(res, "Patient name and parent name are required.");
  if (!EMAIL_PATTERN.test(email)) return badRequest(res, "Enter a valid email address.");
  if (!/^\d{10}$/.test(phone)) return badRequest(res, "Enter a 10-digit phone number.");
  if (password.length < 8) return badRequest(res, "Password must contain at least 8 characters.");
  if (dob && !isValidDob(dob)) return badRequest(res, "Enter a valid date of birth.");

  if (await findParentByEmail(email)) {
    return res.status(409).json({ message: "This email is already registered." });
  }

  const now = new Date();
  const patientId = await generatePatientId();

  await db.collection("parents").insertOne({
    parentName,
    patientName,
    phone,
    email,
    password: await bcrypt.hash(password, 10),
    patientId,
    createdAt: now
  });

  try {
    await db.collection("patients").insertOne({
      patientId,

      // Basic information
      patientName,
      dob: dob || null,
      age: ageFromDob(dob),
      gender: gender || null,
      address: address || null,

      // Parent information
      parentName,
      parentEmail: email,
      parentPhone: phone,

      // Latest health readings
      heartRate: null,
      temperature: null,
      oxygenLevel: null,
      bloodPressure: null,
      lastReadingAt: null,

      // Medical information
      medicalHistory: [],
      medications: [],
      symptoms: [],
      doctorNotes: [],

      monitoringStatus: "Active",
      readings: [],

      createdAt: now,
      updatedAt: now
    });
  } catch (error) {
    // Don't leave a parent account pointing at a patient that was never created.
    await db.collection("parents").deleteOne({ email, patientId });
    throw error;
  }

  res.status(201).json({ message: "Registration successful", patientId });
});

// ===============================
// PARENT LOGIN
// ===============================

app.post("/api/parent-login", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === "string" ? req.body.password : "";

  const parent = email ? await findParentByEmail(email) : null;

  // Same message for unknown email and wrong password, so accounts can't be probed.
  if (!parent || !(await bcrypt.compare(password, parent.password))) {
    return res.status(401).json({ message: "Incorrect email or password." });
  }

  const patient = await findPatientForParent(parent);
  const patientId = patient ? patient.patientId : null;

  res.json({
    message: "Login successful",
    token: signToken({ role: "parent", email: parent.email, patientId }),
    parentName: parent.parentName,
    patientName: patient ? patient.patientName : null,
    patientId
  });
});

// ===============================
// PARENT PASSWORD RESET
// ===============================

app.post("/api/reset-password", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const phone = digitsOnly(req.body.phone);
  const patientId = cleanString(req.body.patientId, 20).toUpperCase();
  const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword : "";

  if (newPassword.length < 8) return badRequest(res, "Password must contain at least 8 characters.");

  const parent = email ? await findParentByEmail(email) : null;
  const patient = parent ? await findPatientForParent(parent) : null;

  const detailsMatch =
    parent &&
    patient &&
    digitsOnly(parent.phone) === phone &&
    patient.patientId === patientId;

  if (!detailsMatch) {
    return badRequest(res, "Those details don't match our records.");
  }

  await db.collection("parents").updateOne(
    { _id: parent._id },
    { $set: { password: await bcrypt.hash(newPassword, 10), passwordChangedAt: new Date() } }
  );

  res.json({ message: "Password updated. You can log in now." });
});

// ===============================
// DOCTOR LOGIN
// ===============================

app.post("/api/doctor-login", async (req, res) => {
  const hospitalId = cleanString(req.body.hospitalId, 50);
  const doctorId = cleanString(req.body.doctorId, 50);
  const password = typeof req.body.password === "string" ? req.body.password : "";

  const doctor =
    hospitalId && doctorId
      ? await db.collection("doctors").findOne({ hospitalId, doctorId }, { collation: CASE_INSENSITIVE })
      : null;

  if (!doctor || !(await bcrypt.compare(password, doctor.password))) {
    return res.status(401).json({ message: "Incorrect hospital ID, doctor ID or password." });
  }

  res.json({
    message: "Doctor login successful",
    token: signToken({ role: "doctor", hospitalId: doctor.hospitalId, doctorId: doctor.doctorId }),
    doctorName: doctor.doctorName || ""
  });
});

// ===============================
// GET ALL PATIENTS (doctors only)
// ===============================

app.get("/api/patients", authenticate("doctor"), async (req, res) => {
  const patients = await db
    .collection("patients")
    .find({}, { projection: { readings: 0 } })
    .sort({ createdAt: -1 })
    .toArray();

  res.json(patients);
});

// ===============================
// GET ONE PATIENT
// ===============================

app.get(
  "/api/patient/:patientId",
  authenticate("doctor", "parent"),
  requirePatientAccess,
  async (req, res) => {
    const patient = await db
      .collection("patients")
      .findOne({ patientId: req.params.patientId }, { projection: { readings: { $slice: -50 } } });

    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    res.json(patient);
  }
);

// ===============================
// UPDATE PATIENT INFORMATION (doctors only)
// ===============================

const EDITABLE_TEXT_FIELDS = ["patientName", "gender", "address", "monitoringStatus"];
const EDITABLE_LIST_FIELDS = ["medicalHistory", "medications", "symptoms", "doctorNotes"];

app.put(
  "/api/patient/:patientId",
  authenticate("doctor"),
  async (req, res) => {
    // Only touch fields that were actually sent, so a partial update can't wipe the rest.
    const updates = {};

    for (const field of EDITABLE_TEXT_FIELDS) {
      if (req.body[field] !== undefined) updates[field] = cleanString(req.body[field], 300);
    }

    for (const field of EDITABLE_LIST_FIELDS) {
      if (req.body[field] === undefined) continue;
      if (!Array.isArray(req.body[field]) || !req.body[field].every((item) => typeof item === "string")) {
        return badRequest(res, `${field} must be a list of text entries.`);
      }
      updates[field] = req.body[field].map((item) => item.trim()).filter(Boolean);
    }

    if (req.body.dob !== undefined) {
      const dob = cleanString(req.body.dob, 10);
      if (dob && !isValidDob(dob)) return badRequest(res, "Enter a valid date of birth.");
      updates.dob = dob || null;
      updates.age = ageFromDob(dob);
    }

    if (Object.keys(updates).length === 0) {
      return badRequest(res, "No patient fields to update.");
    }

    updates.updatedAt = new Date();

    const result = await db
      .collection("patients")
      .updateOne({ patientId: req.params.patientId }, { $set: updates });

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Patient not found" });
    }

    res.json({ message: "Patient updated successfully" });
  }
);

// ===============================
// ADD HEALTH READING
// ===============================

const NUMERIC_READING_FIELDS = ["heartRate", "temperature", "oxygenLevel"];

app.post(
  "/api/patient/:patientId/reading",
  authenticateDevice,
  async (req, res) => {
    const recordedAt = new Date();
    const values = {};

    for (const field of NUMERIC_READING_FIELDS) {
      const raw = req.body[field];
      if (raw === undefined || raw === null || raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) return badRequest(res, `${field} must be a number.`);
      values[field] = value;
    }

    if (req.body.bloodPressure !== undefined && req.body.bloodPressure !== null && req.body.bloodPressure !== "") {
      values.bloodPressure = cleanString(String(req.body.bloodPressure), 20);
    }

    if (Object.keys(values).length === 0) {
      return badRequest(res, "Send at least one of heartRate, temperature, oxygenLevel or bloodPressure.");
    }

    const reading = { ...values, recordedAt };

    const result = await db.collection("patients").updateOne(
      { patientId: req.params.patientId },
      {
        $set: { ...values, lastReadingAt: recordedAt, updatedAt: recordedAt },
        $push: { readings: { $each: [reading], $slice: -MAX_STORED_READINGS } }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Patient not found" });
    }

    res.status(201).json({ message: "Health reading saved successfully", reading });
  }
);

// ===============================
// GET PATIENT READINGS
// ===============================

app.get(
  "/api/patient/:patientId/readings",
  authenticate("doctor", "parent"),
  requirePatientAccess,
  async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), MAX_STORED_READINGS);

    const patient = await db.collection("patients").findOne(
      { patientId: req.params.patientId },
      { projection: { patientId: 1, patientName: 1, readings: { $slice: -limit } } }
    );

    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    res.json({
      patientId: patient.patientId,
      patientName: patient.patientName,
      readings: patient.readings || []
    });
  }
);

// ===============================
// ERRORS
// ===============================

app.use("/api", (req, res) => {
  res.status(404).json({ message: "API route not found" });
});

app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ message: "The request body is not valid JSON." });
  }
  if (error.code === 11000) {
    return res.status(409).json({ message: "This record already exists." });
  }
  if (error.status && error.status < 500) {
    return res.status(error.status).json({ message: error.message });
  }

  console.error(error);
  res.status(500).json({ message: "Something went wrong on the server. Please try again." });
});

// ===============================
// DATABASE
// ===============================

async function createIndexes() {
  await Promise.all([
    db.collection("parents").createIndex({ email: 1 }, { unique: true }),
    db.collection("patients").createIndex({ patientId: 1 }, { unique: true }),
    db.collection("patients").createIndex({ parentEmail: 1 }),
    db.collection("doctors").createIndex({ hospitalId: 1, doctorId: 1 }, { unique: true })
  ]);
}

// The website keeps running while the database is down; API routes answer 503 until it connects.
async function connectToDatabase(attempt = 1) {
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
  } catch (error) {
    await client.close().catch(() => {});

    const retryInSeconds = Math.min(60, attempt * 5);
    console.error(`❌ MongoDB connection error (attempt ${attempt}): ${error.message}`);
    if (/auth/i.test(error.message)) {
      console.error(
        "   → The username or password in MONGO_URI is wrong. Check MongoDB Atlas → Database Access,\n" +
        "     and URL-encode special characters in the password (e.g. @ → %40)."
      );
    }
    console.error(`   Retrying in ${retryInSeconds}s.`);

    setTimeout(() => connectToDatabase(attempt + 1), retryInSeconds * 1000);
    return;
  }

  dbClient = client;
  db = client.db(DB_NAME);
  console.log(`✅ Connected to MongoDB (database: ${DB_NAME})`);

  try {
    await createIndexes();
  } catch (error) {
    console.warn("⚠️  Could not create database indexes:", error.message);
  }
}

// ===============================
// START SERVER
// ===============================

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

if (!process.env.AUTH_SECRET) {
  console.warn("⚠️  AUTH_SECRET is not set. Users will be logged out whenever the server restarts.");
}
if (!DEVICE_API_KEY) {
  console.warn("⚠️  DEVICE_API_KEY is not set. Anyone can post health readings.");
}

if (MONGO_URI) {
  connectToDatabase();
} else {
  console.error("❌ MONGO_URI environment variable is missing! The API will answer 503 until it is set.");
}

process.on("SIGTERM", () => {
  server.close(async () => {
    if (dbClient) await dbClient.close();
    process.exit(0);
  });
});
