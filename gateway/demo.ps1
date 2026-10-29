# Zero Trust API Security Framework - full demo script
# Run from the gateway folder (or anywhere): .\demo.ps1
# Requires: gateway on :3000, backend on :4000, frontend on :5173 all running.

$base = "http://localhost:3000"

function Show($title, $scriptblock) {
    Write-Host "`n=== $title ===" -ForegroundColor Cyan
    try { & $scriptblock } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
}

# ---------- 1. LOGIN (three roles) ----------
Show "1. Login as ADMIN (admin1)" {
    $global:admin = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"userId":"admin1"}'
    $admin | ConvertTo-Json
}
Show "2. Login as AUDITOR (auditor1)" {
    $global:auditor = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"userId":"auditor1"}'
    $auditor | ConvertTo-Json
}
Show "3. Login as USER (alice)" {
    $global:user = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"userId":"alice"}'
    $user | ConvertTo-Json
}

$adminHeaders   = @{ Authorization = "Bearer $($admin.token)" }
$auditorHeaders = @{ Authorization = "Bearer $($auditor.token)" }
$userHeaders    = @{ Authorization = "Bearer $($user.token)" }

# ---------- 2. HARD BLOCKS ----------
Show "4. No token -> BLOCK 401" {
    try { Invoke-RestMethod -Uri "$base/api/secure" -Method Get }
    catch { $_.ErrorDetails.Message }
}
Show "5. Invalid/garbage token -> BLOCK 401" {
    try { Invoke-RestMethod -Uri "$base/api/secure" -Headers @{ Authorization = "Bearer garbage.token.here" } }
    catch { $_.ErrorDetails.Message }
}
Show "6. Blacklisted IP (8.8.8.8, seeded) -> HARD BLOCK 403" {
    try { Invoke-RestMethod -Uri "$base/api/secure" -Headers @{ Authorization = "Bearer $($user.token)"; "x-test-ip" = "8.8.8.8" } }
    catch { $_.ErrorDetails.Message }
}

# ---------- 3. VALID ACCESS ----------
Show "7. Valid user token -> ALLOW 200 (gateway calls backend)" {
    Invoke-RestMethod -Uri "$base/api/secure" -Headers $userHeaders | ConvertTo-Json
}
Show "8. Sensitive endpoint -> triggers sensitive_endpoint_access risk signal" {
    Invoke-RestMethod -Uri "$base/api/secure/sensitive" -Headers $userHeaders | ConvertTo-Json
}

# ---------- 4. DYNAMIC RISK ENGINE ----------
Show "9. New IP for a brand-new user -> new_ip_detected signal (check /admin/logs after)" {
    Invoke-RestMethod -Uri "$base/api/secure" -Headers @{ Authorization = "Bearer $($user.token)"; "x-test-ip" = "51.51.51.51" } | ConvertTo-Json
}
Show "10. Rapid requests + IP switch -> risk score climbs to BLOCK + fires a Security Alert" {
    for ($i = 1; $i -le 6; $i++) {
        Invoke-RestMethod -Uri "$base/api/secure" -Headers @{ Authorization = "Bearer $($user.token)"; "x-test-ip" = "60.60.60.60" } | Out-Null
    }
    try { Invoke-RestMethod -Uri "$base/api/secure" -Headers @{ Authorization = "Bearer $($user.token)"; "x-test-ip" = "61.61.61.61" } }
    catch { $_.ErrorDetails.Message }
}

# ---------- 5. RBAC ----------
Show "11. Auditor CAN read logs (read-only role)" {
    (Invoke-RestMethod -Uri "$base/admin/logs" -Headers $auditorHeaders).logs.Count
}
Show "12. Auditor CANNOT create a blocked IP -> 403" {
    try { Invoke-RestMethod -Uri "$base/admin/blocked-ips" -Method Post -Headers $auditorHeaders -ContentType "application/json" -Body '{"ip":"9.9.9.9","reason":"test"}' }
    catch { $_.ErrorDetails.Message }
}
Show "13. Plain user CANNOT reach admin routes -> 403" {
    try { Invoke-RestMethod -Uri "$base/admin/stats" -Headers $userHeaders }
    catch { $_.ErrorDetails.Message }
}

# ---------- 6. ADMIN / FORENSICS ----------
Show "14. Admin stats (KPI numbers)" {
    Invoke-RestMethod -Uri "$base/admin/stats" -Headers $adminHeaders | ConvertTo-Json
}
Show "15. Admin alerts (real-time security alerts)" {
    (Invoke-RestMethod -Uri "$base/admin/alerts" -Headers $adminHeaders).alerts | Select-Object -First 3 | ConvertTo-Json
}
Show "16. Trust score leaderboard (riskiest users first)" {
    Invoke-RestMethod -Uri "$base/admin/trust-scores" -Headers $adminHeaders | ConvertTo-Json
}

# ---------- 7. BLOCKED IP MANAGEMENT (admin only) ----------
# Uses a brand-new, never-seen-before user+IP so this demo is isolated from
# the risk history alice built up in steps 9-10 above.
$zoe = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"userId":"zoe"}'
$zoeAtBlockedIp = @{ Authorization = "Bearer $($zoe.token)"; "x-test-ip" = "66.66.66.66" }

Show "17. Admin adds a blocked IP" {
    Invoke-RestMethod -Uri "$base/admin/blocked-ips" -Method Post -Headers $adminHeaders -ContentType "application/json" -Body '{"ip":"66.66.66.66","reason":"manual demo block"}' | ConvertTo-Json
}
Show "18. That IP is now hard-blocked (new user, first request)" {
    try { Invoke-RestMethod -Uri "$base/api/secure" -Headers $zoeAtBlockedIp }
    catch { $_.ErrorDetails.Message }
}
Show "19. Admin removes the block" {
    Invoke-RestMethod -Uri "$base/admin/blocked-ips/66.66.66.66" -Method Delete -Headers $adminHeaders | ConvertTo-Json
}
Show "20. Same IP now passes (blacklist cleared; only mild new_ip risk applies)" {
    Invoke-RestMethod -Uri "$base/api/secure" -Headers $zoeAtBlockedIp | ConvertTo-Json
}

Write-Host "`nDone. Open the dashboard at http://localhost:5173 to see this all rendered live (charts, tables, alerts, blocked-IP UI)." -ForegroundColor Green
