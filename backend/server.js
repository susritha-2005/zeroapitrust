// backend/server.js
const express = require("express");
const app = express();

app.get("/data", (req, res) => {
  res.json({ message: "Secure backend data accessed ✅" });
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
