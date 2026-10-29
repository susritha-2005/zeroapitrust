import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
  ResponsiveContainer,
} from "recharts";
import Layout from "../components/Layout.jsx";
import api from "../api.js";

const COLORS = {
  allow: "#22c55e",
  block: "#ef4444",
  suspicious: "#f59e0b",
  other: "#64748b",
};

function normalizeDecision(decision) {
  const d = String(decision || "").toUpperCase();
  if (d.includes("BLOCK")) return "block";
  if (d.includes("SUSPICIOUS") || d.includes("LOG")) return "suspicious";
  if (d.includes("ALLOW")) return "allow";
  return "other";
}

function pickArray(data, keys) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const k of keys) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

function scoreColor(score) {
  const s = Number(score) || 0;
  if (s < 40) return COLORS.block;
  if (s <= 70) return COLORS.suspicious;
  return COLORS.allow;
}

function timeAgoOrTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleTimeString();
}

export default function Dashboard() {
  const role = localStorage.getItem("role") || "user";

  if (role === "admin" || role === "auditor") {
    return (
      <Layout>
        <AdminAuditorView role={role} />
      </Layout>
    );
  }

  return (
    <Layout>
      <UserView />
    </Layout>
  );
}

function AdminAuditorView({ role }) {
  const isAdmin = role === "admin";
  const [stats, setStats] = useState({});
  const [logs, setLogs] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [blockedIps, setBlockedIps] = useState([]);
  const [trustScores, setTrustScores] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [newIp, setNewIp] = useState("");
  const [newReason, setNewReason] = useState("");
  const [formBusy, setFormBusy] = useState(false);

  const fetchStatsAndAlerts = useCallback(async () => {
    try {
      const [statsRes, alertsRes] = await Promise.all([
        api.get("/admin/stats"),
        api.get("/admin/alerts"),
      ]);
      setStats(statsRes.data || {});
      setAlerts(pickArray(alertsRes.data, ["alerts"]));
      setLoadError("");
    } catch (err) {
      setLoadError(
        err?.response?.data?.message || err?.message || "Failed to load stats"
      );
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await api.get("/admin/logs");
      setLogs(pickArray(res.data, ["logs"]));
    } catch (err) {
      // non-fatal, keep last known logs
    }
  }, []);

  const fetchBlockedIps = useCallback(async () => {
    try {
      const res = await api.get("/admin/blocked-ips");
      setBlockedIps(pickArray(res.data, ["blockedIps", "blocked_ips"]));
    } catch (err) {
      // non-fatal
    }
  }, []);

  const fetchTrustScores = useCallback(async () => {
    try {
      const res = await api.get("/admin/trust-scores");
      setTrustScores(pickArray(res.data, ["trustScores", "trust_scores"]));
    } catch (err) {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    fetchStatsAndAlerts();
    fetchBlockedIps();
    fetchTrustScores();
    const statsInterval = setInterval(fetchStatsAndAlerts, 5000);
    const blockedInterval = setInterval(fetchBlockedIps, 5000);
    const trustInterval = setInterval(fetchTrustScores, 5000);
    return () => {
      clearInterval(statsInterval);
      clearInterval(blockedInterval);
      clearInterval(trustInterval);
    };
  }, [fetchStatsAndAlerts, fetchBlockedIps, fetchTrustScores]);

  useEffect(() => {
    fetchLogs();
    const logsInterval = setInterval(fetchLogs, 3500);
    return () => clearInterval(logsInterval);
  }, [fetchLogs]);

  const decisionCounts = useMemo(() => {
    const counts = { allow: 0, block: 0, suspicious: 0, other: 0 };
    logs.forEach((l) => {
      counts[normalizeDecision(l.decision)] += 1;
    });
    return counts;
  }, [logs]);

  const pieData = useMemo(() => {
    const allow =
      stats.allowed_requests ?? decisionCounts.allow ?? 0;
    const block =
      stats.blocked_requests ?? decisionCounts.block ?? 0;
    const suspicious =
      stats.suspicious_requests ?? decisionCounts.suspicious ?? 0;
    return [
      { name: "Allow", value: Number(allow) || 0, key: "allow" },
      { name: "Block", value: Number(block) || 0, key: "block" },
      { name: "Suspicious", value: Number(suspicious) || 0, key: "suspicious" },
    ];
  }, [stats, decisionCounts]);

  const reasonData = useMemo(() => {
    const tally = {};
    logs.forEach((l) => {
      (l.reasons || []).forEach((r) => {
        tally[r] = (tally[r] || 0) + 1;
      });
    });
    return Object.entries(tally)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [logs]);

  const volumeData = useMemo(() => {
    const buckets = {};
    logs.forEach((l) => {
      const d = new Date(l.timestamp);
      if (isNaN(d.getTime())) return;
      d.setSeconds(0, 0);
      const label = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      buckets[label] = (buckets[label] || 0) + 1;
    });
    return Object.entries(buckets)
      .map(([time, count]) => ({ time, count }))
      .slice(-15);
  }, [logs]);

  async function handleAddBlockedIp(e) {
    e.preventDefault();
    if (!newIp.trim()) return;
    setFormBusy(true);
    try {
      await api.post("/admin/blocked-ips", {
        ip: newIp.trim(),
        reason: newReason.trim() || "Manually blocked",
      });
      setNewIp("");
      setNewReason("");
      fetchBlockedIps();
    } catch (err) {
      alert(
        err?.response?.data?.message || err?.message || "Failed to block IP"
      );
    } finally {
      setFormBusy(false);
    }
  }

  async function handleDeleteBlockedIp(ip) {
    try {
      await api.delete(`/admin/blocked-ips/${encodeURIComponent(ip)}`);
      fetchBlockedIps();
    } catch (err) {
      alert(
        err?.response?.data?.message || err?.message || "Failed to unblock IP"
      );
    }
  }

  return (
    <div className="dashboard">
      {loadError && (
        <div className="banner-error">
          Could not reach admin endpoints: {loadError}
        </div>
      )}

      <section className="kpi-grid">
        <KpiCard label="Total Requests" value={stats.total_requests ?? "-"} />
        <KpiCard
          label="Allowed"
          value={stats.allowed_requests ?? "-"}
          color={COLORS.allow}
        />
        <KpiCard
          label="Blocked"
          value={stats.blocked_requests ?? "-"}
          color={COLORS.block}
        />
        <KpiCard
          label="Suspicious"
          value={stats.suspicious_requests ?? "-"}
          color={COLORS.suspicious}
        />
        <KpiCard
          label="Active Alerts"
          value={alerts.length}
          color={COLORS.suspicious}
        />
      </section>

      <section className="chart-grid">
        <div className="card chart-card">
          <h3>Decision Breakdown</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius={45}
                outerRadius={80}
                paddingAngle={2}
              >
                {pieData.map((entry) => (
                  <Cell key={entry.key} fill={COLORS[entry.key]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <h3>Top Risk Reasons</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={reasonData} layout="vertical" margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
              <XAxis type="number" stroke="#94a3b8" allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="reason"
                width={110}
                stroke="#94a3b8"
                tick={{ fontSize: 11 }}
              />
              <Tooltip />
              <Bar dataKey="count" fill="#38bdf8" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {reasonData.length === 0 && <div className="empty-note">No reason data yet</div>}
        </div>

        <div className="card chart-card">
          <h3>Request Volume</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={volumeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
              <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#94a3b8" allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#38bdf8" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          {volumeData.length === 0 && <div className="empty-note">No volume data yet</div>}
        </div>
      </section>

      <section className="card">
        <h3>Live Request Monitoring</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>IP</th>
                <th>Endpoint</th>
                <th>Risk Score</th>
                <th>Reasons</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-note">
                    No logs yet
                  </td>
                </tr>
              )}
              {logs.map((log, i) => {
                const decision = normalizeDecision(log.decision);
                return (
                  <tr key={i} className={`row-${decision}`}>
                    <td>{timeAgoOrTime(log.timestamp)}</td>
                    <td>{log.userId || "-"}</td>
                    <td>{log.ip || "-"}</td>
                    <td>{log.endpoint || "-"}</td>
                    <td>{log.risk_score ?? "-"}</td>
                    <td>{(log.reasons || []).join(", ") || "-"}</td>
                    <td>
                      <span className={`badge badge-${decision}`}>
                        {log.decision || "-"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="split-grid">
        <div className="card">
          <h3>Security Alerts</h3>
          <div className="alert-list">
            {alerts.length === 0 && <div className="empty-note">No alerts</div>}
            {[...alerts].reverse().map((a, i) => (
              <div key={i} className="alert-item">
                <div className="alert-top">
                  <span className="alert-ip">{a.ip || "unknown ip"}</span>
                  <span className="alert-score">score {a.risk_score ?? "-"}</span>
                </div>
                <div className="alert-reason">{a.reason || "No reason provided"}</div>
                <div className="alert-meta">
                  {a.endpoint || ""} &middot; {timeAgoOrTime(a.timestamp)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Trust Score Leaderboard</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Score</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {trustScores.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty-note">
                      No trust score data
                    </td>
                  </tr>
                )}
                {trustScores.map((t, i) => (
                  <tr key={i}>
                    <td>{t.userId || t.user_id || "-"}</td>
                    <td>
                      <span
                        className="score-pill"
                        style={{ background: scoreColor(t.score) }}
                      >
                        {t.score ?? "-"}
                      </span>
                    </td>
                    <td>{timeAgoOrTime(t.updatedAt || t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Blocked IP Management</h3>
        {isAdmin && (
          <form className="blocked-form" onSubmit={handleAddBlockedIp}>
            <input
              type="text"
              placeholder="IP address"
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
            />
            <input
              type="text"
              placeholder="Reason"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
            />
            <button type="submit" disabled={formBusy}>
              {formBusy ? "Blocking..." : "Block IP"}
            </button>
          </form>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>IP</th>
                <th>Reason</th>
                <th>Blocked At</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {blockedIps.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 4 : 3} className="empty-note">
                    No blocked IPs
                  </td>
                </tr>
              )}
              {blockedIps.map((b, i) => (
                <tr key={i}>
                  <td>{b.ip || "-"}</td>
                  <td>{b.reason || "-"}</td>
                  <td>{timeAgoOrTime(b.blockedAt || b.blocked_at)}</td>
                  {isAdmin && (
                    <td>
                      <button
                        className="unblock-btn"
                        onClick={() => handleDeleteBlockedIp(b.ip)}
                      >
                        Unblock
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!isAdmin && (
          <div className="empty-note" style={{ marginTop: 8 }}>
            Read-only: auditor role cannot add or remove blocked IPs.
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, value, color }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function UserView() {
  const [secureResult, setSecureResult] = useState(null);
  const [sensitiveResult, setSensitiveResult] = useState(null);
  const [busy, setBusy] = useState("");

  async function tryEndpoint(path, setResult) {
    setBusy(path);
    try {
      const res = await api.get(path);
      setResult({ ok: true, status: res.status, data: res.data });
    } catch (err) {
      setResult({
        ok: false,
        status: err?.response?.status,
        data: err?.response?.data || { message: err?.message },
      });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="dashboard">
      <section className="card restricted-card">
        <h2>Restricted Access</h2>
        <p>
          Your account has the <span className="role-badge role-user">user</span>{" "}
          role. Admin and auditor tools (live logs, alerts, trust scores,
          blocked IP management) require elevated access.
        </p>
        <p>
          You can still call the protected demo endpoints below to see how the
          zero-trust risk engine evaluates your requests in real time.
        </p>
      </section>

      <section className="split-grid">
        <div className="card">
          <h3>GET /api/secure</h3>
          <button
            disabled={busy === "/api/secure"}
            onClick={() => tryEndpoint("/api/secure", setSecureResult)}
          >
            {busy === "/api/secure" ? "Requesting..." : "Try Request"}
          </button>
          {secureResult && <ResultBlock result={secureResult} />}
        </div>
        <div className="card">
          <h3>GET /api/secure/sensitive</h3>
          <button
            disabled={busy === "/api/secure/sensitive"}
            onClick={() =>
              tryEndpoint("/api/secure/sensitive", setSensitiveResult)
            }
          >
            {busy === "/api/secure/sensitive" ? "Requesting..." : "Try Request"}
          </button>
          {sensitiveResult && <ResultBlock result={sensitiveResult} />}
        </div>
      </section>
    </div>
  );
}

function ResultBlock({ result }) {
  const decision = normalizeDecision(result?.data?.decision) || (result.ok ? "allow" : "block");
  return (
    <div className={`result-block badge-${result.ok ? "allow" : decision}`}>
      <div className="result-status">
        Status: {result.status ?? "-"} &middot; {result.ok ? "Allowed" : "Blocked / Denied"}
      </div>
      <pre>{JSON.stringify(result.data, null, 2)}</pre>
    </div>
  );
}
