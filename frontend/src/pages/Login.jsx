import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api.js";

export default function Login() {
  const [userId, setUserId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!userId.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/login", { userId: userId.trim() });
      const { token, role } = res.data || {};
      localStorage.setItem("token", token || "");
      localStorage.setItem("role", role || "user");
      localStorage.setItem("userId", userId.trim());
      navigate("/dashboard");
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          "Login failed. Please check the backend is running on port 3000."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-shield">&#128737;</span>
          <h1>Zero Trust Security Dashboard</h1>
        </div>
        <p className="login-subtitle">
          Sign in to access the gateway's live risk engine and audit tools.
        </p>
        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="userId">User ID</label>
          <input
            id="userId"
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="e.g. admin1"
            autoFocus
          />
          <button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>
        {error && <div className="login-error">{error}</div>}
        <div className="login-hint">
          Try <code>admin1</code> (Admin), <code>auditor1</code> (Auditor), or
          any other name (User).
        </div>
      </div>
    </div>
  );
}
