const mongoose = require("mongoose");

const blockedIpSchema = new mongoose.Schema({
  ip: { type: String, unique: true },
  reason: String,
  blockedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("BlockedIp", blockedIpSchema);
