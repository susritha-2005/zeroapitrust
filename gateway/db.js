const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI;

mongoose.set("bufferCommands", false);

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    console.error("Continuing without MongoDB (file logging only).");
  }
}

module.exports = connectDB;
