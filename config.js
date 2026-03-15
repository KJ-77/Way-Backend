/**
 * config.js
 * Central configuration file that loads environment variables
 */

require("dotenv").config();

module.exports = {
  // AWS Configuration
  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    stage: process.env.STAGE || "dev",
  },

  // Database Configuration
  db: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || "5432"),
  },

  // Server Configuration (optional, if you're running an Express server)
  server: {
    port: parseInt(process.env.PORT || "3000"),
    environment: process.env.NODE_ENV || "development",
  },
};
