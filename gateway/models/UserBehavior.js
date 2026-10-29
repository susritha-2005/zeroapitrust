const mongoose = require("mongoose");

const userBehaviorSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  lastIp: String,
  recentIps: [String], // last ~5 distinct IPs seen for this user
  recentRequests: [Number], // timestamps (ms) for rolling rate-limit window
  failedAttempts: {
    type: Number,
    default: 0,
  },
});

module.exports = mongoose.model("UserBehavior", userBehaviorSchema);