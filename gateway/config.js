module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || "dev-only-change-me",
  TOKEN_EXPIRY_SECONDS: 60 * 60
};
