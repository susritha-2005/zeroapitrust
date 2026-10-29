import React from "react";
import { useNavigate } from "react-router-dom";

export default function Layout({ children }) {
  const navigate = useNavigate();
  const userId = localStorage.getItem("userId") || "unknown";
  const role = localStorage.getItem("role") || "user";

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("userId");
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-shield">&#128737;</span>
          <span>Zero Trust Security Dashboard</span>
        </div>
        <div className="topbar-user">
          <span className="user-id">{userId}</span>
          <span className={`role-badge role-${role}`}>{role}</span>
          <button className="logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
