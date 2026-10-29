// gateway/index.js
const Alert = require("./models/Alert");
const BlockedIp = require("./models/BlockedIp");
const TrustScore = require("./models/TrustScore");
const express = require("express");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const fs = require("fs");
const mongoose = require("mongoose");
const cors = require("cors");

const connectDB = require("./db");
const { JWT_SECRET, TOKEN_EXPIRY_SECONDS } = require("./config");
const { calculateRisk } = require("./riskEngine");

// --------------------
// MongoDB Log Schema
// --------------------
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

const Log = mongoose.model("Log", logSchema);

// --------------------
// App Setup
// --------------------
const app = express();
app.use(express.json());
app.use(cors()); // ✅ required for dashboard

connectDB();

// --------------------
// Helper: Log Event (File + DB)
// --------------------
async function logEvent(event) {
  try {
    fs.appendFileSync("logs.jsonl", JSON.stringify(event) + "\n");
  } catch (err) {
    console.error("File log error:", err.message);
  }

  try {
    await Log.create(event);
  } catch (err) {
    console.error("MongoDB log error:", err.message);
  }
}

// --------------------
// Helper: Update Trust Score
// --------------------
async function updateTrustScore(userId, riskScore) {
  try {
    let ts = await TrustScore.findOne({ userId });
    let current = ts ? ts.score : 70;

    let next;
    if (riskScore === 0) {
      next = Math.min(100, current + 2);
    } else {
      next = Math.max(0, current - Math.round(riskScore / 5));
    }

    await TrustScore.updateOne(
      { userId },
      { $set: { score: next, updatedAt: new Date() } },
      { upsert: true }
    );

    return next;
  } catch (err) {
    console.error("TrustScore update error:", err.message);
    return null;
  }
}

// --------------------
// AUTH LOGIN
// --------------------
app.post("/auth/login", (req, res) => {

  const { userId } = req.body;

  let role = "user";

  if (userId === "admin1") {
    role = "admin";
  } else if (userId === "auditor1") {
    role = "auditor";
  }

  const token = jwt.sign(
    { userId, role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY_SECONDS }
  );

  res.json({
    message: "Login successful",
    token,
    role
  });

});

// --------------------
// ZERO TRUST MIDDLEWARE
// --------------------
async function zeroTrustMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  const ip =
    req.headers["x-test-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress;

  const endpoint = req.path;

  const logBase = {
    timestamp: new Date().toISOString(),
    ip,
    endpoint,
  };

  // 🚨 Blacklisted IP (Mongo-backed) → HARD BLOCK
  let blocked = null;
  try {
    blocked = await BlockedIp.findOne({ ip });
  } catch (err) {
    console.error("BlockedIp lookup error:", err.message);
    // Mongo hiccup: fall back to allowing risk-engine scoring instead of hanging/blocking everyone
    blocked = null;
  }

  if (blocked) {

  const event = {
    ...logBase,
    decision: "BLOCK",
    risk_score: 100,
    reasons: ["blacklisted_ip"],
  };

  // 🚨 CREATE ALERT
  try {
    await Alert.create({
      timestamp: new Date().toISOString(),
      ip,
      endpoint,
      risk_score: 100,
      reason: "blacklisted_ip",
    });
  } catch (err) {
    console.error("Alert create error:", err.message);
  }

  await logEvent(event);

  return res.status(403).json(event);
}

  // 🚫 No Token
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const event = {
      ...logBase,
      decision: "BLOCK",
      risk_score: 100,
      reasons: ["no_token"],
    };
    await logEvent(event);
    return res.status(401).json(event);
  }

  const token = authHeader.split(" ")[1];
  let decoded;

  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    const event = {
      ...logBase,
      decision: "BLOCK",
      risk_score: 100,
      reasons: ["invalid_or_expired_token"],
    };
    await logEvent(event);
    return res.status(401).json(event);
  }
  const role = decoded.role || "user";

  // --------------------
  // Risk Engine
  // --------------------
  const { score, reasons } = await calculateRisk({
    userId: decoded.userId,
    currentIp: ip,
    endpoint,
  });

  // --------------------
  // Graduated Trust
  // --------------------
  let decision = "ALLOW";
  if (score >= 40) decision = "BLOCK";
  else if (score >= 31) decision = "LOG_ONLY";

  // --------------------
  // Trust Score (authenticated requests only)
  // --------------------
  const trust_score = await updateTrustScore(decoded.userId, score);

  const event = {
  ...logBase,
  userId: decoded.userId,
  role,
  risk_score: score,
  reasons,
  decision,
  trust_score,
};
// 🚨 Real-time attack alert
if (score >= 50) {
  console.log("⚠️ SECURITY ALERT!");
  console.log("IP:", ip);
  console.log("Endpoint:", endpoint);
  console.log("Risk Score:", score);

  try {
    await Alert.create({
      timestamp: new Date().toISOString(),
      ip,
      endpoint,
      risk_score: score,
      reason: reasons.join(", "),
    });
  } catch (err) {
    console.error("Alert create error:", err.message);
  }
}

  await logEvent(event);

  if (decision === "BLOCK") {
    return res.status(403).json(event);
  }

  if (decision === "LOG_ONLY") {
    res.locals.zeroTrustEvent = event;
  }

  req.zeroTrust = { trust_score, risk_score: score, decision };

  next();
}

// --------------------
// SECURE API
// --------------------
app.get("/api/secure", zeroTrustMiddleware, async (req, res) => {
  try {
    const response = await axios.get("http://localhost:4000/data");
    res.json({
      gateway: "Request allowed ✅",
      backend: response.data,
      trust_score: req.zeroTrust && req.zeroTrust.trust_score,
    });
  } catch {
    res.status(500).json({ error: "Backend error" });
  }
});

// --------------------
// SENSITIVE API (demo route for sensitive_endpoint_access signal)
// --------------------
app.get("/api/secure/sensitive", zeroTrustMiddleware, async (req, res) => {
  res.json({
    message: "Sensitive data ✅",
    trust_score: req.zeroTrust && req.zeroTrust.trust_score,
  });
});

// --------------------
// ROLE-BASED ACCESS CONTROL
// --------------------
function requireRole(...roles) {
  return function (req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = jwt.verify(token, JWT_SECRET);

      if (!roles.includes(decoded.role)) {
        return res.status(403).json({
          error: `Access requires one of the following roles: ${roles.join(", ")}`,
        });
      }

      req.user = decoded;
      next();

    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}

// --------------------
// ADMIN LOGS API
// --------------------
app.get("/admin/logs", requireRole("admin", "auditor"), async (req, res) => {
  try {
    const logs = await Log.find().sort({ timestamp: -1 }).limit(50);
    res.json({ logs });
  } catch {
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// --------------------
// ADMIN STATS API
// --------------------
app.get("/admin/stats", requireRole("admin", "auditor"), async (req, res) => {
  try {
    const total = await Log.countDocuments();
    const allowed = await Log.countDocuments({ decision: "ALLOW" });
    const blocked = await Log.countDocuments({ decision: "BLOCK" });
    const suspicious = await Log.countDocuments({ decision: "LOG_ONLY" });

    res.json({
      total_requests: total,
      allowed_requests: allowed,
      blocked_requests: blocked,
      suspicious_requests: suspicious,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// --------------------
// ADMIN ALERTS API
// --------------------
app.get("/admin/alerts", requireRole("admin", "auditor"), async (req, res) => {
  try {
    const alerts = await Alert.find().sort({ timestamp: -1 }).limit(20);
    res.json({ alerts });
  } catch {
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

// --------------------
// BLOCKED IPs MANAGEMENT
// --------------------
app.get("/admin/blocked-ips", requireRole("admin", "auditor"), async (req, res) => {
  try {
    const ips = await BlockedIp.find().sort({ blockedAt: -1 });
    res.json({ blocked_ips: ips });
  } catch {
    res.status(500).json({ error: "Failed to fetch blocked IPs" });
  }
});

app.post("/admin/blocked-ips", requireRole("admin"), async (req, res) => {
  const { ip, reason } = req.body;

  if (!ip) {
    return res.status(400).json({ error: "ip is required" });
  }

  try {
    const doc = await BlockedIp.findOneAndUpdate(
      { ip },
      { ip, reason: reason || "manually_blocked", blockedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ message: "IP blocked", blocked_ip: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to block IP" });
  }
});

app.delete("/admin/blocked-ips/:ip", requireRole("admin"), async (req, res) => {
  try {
    const result = await BlockedIp.deleteOne({ ip: req.params.ip });
    res.json({ message: "IP unblocked", deleted: result.deletedCount > 0 });
  } catch {
    res.status(500).json({ error: "Failed to unblock IP" });
  }
});

// --------------------
// TRUST SCORES
// --------------------
app.get("/admin/trust-scores", requireRole("admin", "auditor"), async (req, res) => {
  try {
    const scores = await TrustScore.find().sort({ score: 1 });
    res.json({ trust_scores: scores });
  } catch {
    res.status(500).json({ error: "Failed to fetch trust scores" });
  }
});

// --------------------
// START SERVER
// --------------------
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Gateway running on http://localhost:${PORT}`);
});
