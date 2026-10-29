// gateway/seed.js
// Standalone script to populate MongoDB with realistic demo data.
const connectDB = require("./db");
const Log = (() => {
  const mongoose = require("mongoose");
  // Reuse the same schema shape as index.js's inline Log model
  const logSchema = new mongoose.Schema({
    timestamp: String,
    userId: String,
    ip: String,
    endpoint: String,
    risk_score: Number,
    reasons: [String],
    decision: String,
    trust_score: Number,
  });
  return mongoose.models.Log || mongoose.model("Log", logSchema);
})();
const Alert = require("./models/Alert");
const BlockedIp = require("./models/BlockedIp");
const TrustScore = require("./models/TrustScore");

const USERS = ["alice", "bob", "carol", "dave", "admin1", "auditor1"];
const IPS = [
  "192.168.1.10",
  "192.168.1.11",
  "10.0.0.5",
  "10.0.0.9",
  "203.0.113.4",
  "198.51.100.7",
  "8.8.8.8",
  "45.33.12.9",
];
const ENDPOINTS = ["/api/secure", "/api/secure/sensitive", "/admin/logs", "/admin/stats"];

const REASON_POOL = [
  "new_ip_detected",
  "ip_changed",
  "too_many_requests",
  "sensitive_endpoint_access",
  "blacklisted_ip",
];

function randChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPastTimestamp() {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  return new Date(now - Math.floor(Math.random() * dayMs)).toISOString();
}

function buildLog() {
  const roll = Math.random();
  let decision, risk_score, reasons;

  if (roll < 0.65) {
    decision = "ALLOW";
    risk_score = randInt(0, 30);
    reasons = risk_score === 0 ? [] : [randChoice(REASON_POOL.slice(0, 3))];
  } else if (roll < 0.85) {
    decision = "LOG_ONLY";
    risk_score = randInt(31, 39);
    reasons = [randChoice(REASON_POOL.slice(0, 4))];
    if (Math.random() < 0.4) reasons.push(randChoice(REASON_POOL.slice(0, 4)));
  } else {
    decision = "BLOCK";
    risk_score = randInt(40, 100);
    const reasonCount = randInt(1, 3);
    reasons = [];
    for (let i = 0; i < reasonCount; i++) {
      const r = randChoice(REASON_POOL);
      if (!reasons.includes(r)) reasons.push(r);
    }
  }

  return {
    timestamp: randomPastTimestamp(),
    userId: randChoice(USERS),
    ip: randChoice(IPS),
    endpoint: randChoice(ENDPOINTS),
    risk_score,
    reasons,
    decision,
    trust_score: randInt(10, 95),
  };
}

function buildAlert() {
  const risk_score = randInt(50, 100);
  const reasonCount = randInt(1, 3);
  const reasons = [];
  for (let i = 0; i < reasonCount; i++) {
    const r = randChoice(REASON_POOL);
    if (!reasons.includes(r)) reasons.push(r);
  }
  return {
    timestamp: randomPastTimestamp(),
    ip: randChoice(IPS),
    endpoint: randChoice(ENDPOINTS),
    risk_score,
    reason: reasons.join(", "),
  };
}

async function seed() {
  await connectDB();

  // Clear existing demo collections for a clean, idempotent seed
  await Promise.all([
    Log.deleteMany({}),
    Alert.deleteMany({}),
    BlockedIp.deleteMany({}),
    TrustScore.deleteMany({}),
  ]);

  const logs = Array.from({ length: 50 }, buildLog);
  const alerts = Array.from({ length: 8 }, buildAlert);

  const blockedIps = [
    { ip: "8.8.8.8", reason: "blacklisted_ip" },
    { ip: "45.33.12.9", reason: "known_malicious_scanner" },
    { ip: "185.220.101.7", reason: "tor_exit_node_abuse" },
  ];

  const trustScores = [
    { userId: "alice", score: 88 },
    { userId: "bob", score: 42 },
    { userId: "carol", score: 65 },
    { userId: "dave", score: 20 },
    { userId: "admin1", score: 95 },
    { userId: "auditor1", score: 80 },
  ].map((t) => ({ ...t, updatedAt: new Date() }));

  const insertedLogs = await Log.insertMany(logs);
  const insertedAlerts = await Alert.insertMany(alerts);
  const insertedBlockedIps = await BlockedIp.insertMany(blockedIps);
  const insertedTrustScores = await TrustScore.insertMany(trustScores);

  console.log("Seed complete:");
  console.log(`  Logs: ${insertedLogs.length}`);
  console.log(`  Alerts: ${insertedAlerts.length}`);
  console.log(`  BlockedIps: ${insertedBlockedIps.length}`);
  console.log(`  TrustScores: ${insertedTrustScores.length}`);

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
