const mongoose = require("mongoose");

const alertSchema = new mongoose.Schema({
  timestamp: String,
  ip: String,
  endpoint: String,
  risk_score: Number,
  reason: String,
});

module.exports = mongoose.model("Alert", alertSchema);