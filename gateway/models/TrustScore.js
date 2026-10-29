const mongoose = require("mongoose");

const trustScoreSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  score: { type: Number, default: 70 },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("TrustScore", trustScoreSchema);
