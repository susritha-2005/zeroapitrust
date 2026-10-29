const UserBehavior = require("./models/UserBehavior");

// Endpoints considered sensitive for the purposes of risk scoring
const SENSITIVE_ENDPOINTS = ["/admin", "/api/secure/sensitive"];

const MAX_RECENT_IPS = 5;
const RATE_WINDOW_MS = 5000; // rolling 5s window
const RATE_LIMIT = 5; // more than this many requests in the window is risky

async function calculateRisk({ userId, currentIp, endpoint }) {
  let score = 0;
  const reasons = [];
  const now = Date.now();

  let user;
  try {
    user = await UserBehavior.findOne({ userId });
  } catch (err) {
    console.error("UserBehavior lookup error:", err.message);
  }

  if (!user) {
    user = new UserBehavior({
      userId,
      lastIp: null,
      recentIps: [],
      recentRequests: [],
      failedAttempts: 0,
    });
  }

  // -------- New IP Detection (never seen before for this user) --------
  const knownIps = user.recentIps || [];
  if (currentIp && !knownIps.includes(currentIp)) {
    score += 15;
    reasons.push("new_ip_detected");

    const updatedIps = [...knownIps, currentIp];
    // cap history to last MAX_RECENT_IPS distinct IPs (drop oldest)
    user.recentIps = updatedIps.slice(-MAX_RECENT_IPS);
  }

  // -------- IP Change Detection (vs immediately-previous request) --------
  if (user.lastIp && user.lastIp !== currentIp) {
    score += 20;
    reasons.push("ip_changed");
  }

  user.lastIp = currentIp;

  // -------- Request Frequency Detection (rolling window) --------
  const recentRequests = (user.recentRequests || []).filter(
    (t) => now - t < RATE_WINDOW_MS
  );
  recentRequests.push(now);
  user.recentRequests = recentRequests;

  if (recentRequests.length > RATE_LIMIT) {
    score += 30;
    reasons.push("too_many_requests");
  }

  // -------- Sensitive Endpoint --------
  if (SENSITIVE_ENDPOINTS.some((prefix) => endpoint.startsWith(prefix))) {
    score += 25;
    reasons.push("sensitive_endpoint_access");
  }

  try {
    await UserBehavior.updateOne(
      { userId },
      {
        $set: {
          lastIp: user.lastIp,
          recentIps: user.recentIps,
          recentRequests: user.recentRequests,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    console.error("UserBehavior save error:", err.message);
  }

  return { score, reasons };
}

module.exports = { calculateRisk, SENSITIVE_ENDPOINTS };
