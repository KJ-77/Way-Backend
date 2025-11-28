import nodemailer from "nodemailer";
import dotenv from "dotenv";

// Make sure dotenv is loaded
dotenv.config();

// Debug: Check if environment variables are loaded
const email = process.env.SENDER_EMAIL;
const password = process.env.SENDER_EMAIL_PASSWORD;
console.log("Email setup - Environment variables available:", {
  emailSet: !!email,
  passwordSet: !!password,
  emailValue: email ? email.substring(0, 3) + "..." : "undefined",
});

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: email,
    pass: password,
  },
});

// Verify the connection configuration
transporter.verify(function (error, success) {
  if (error) {
    console.log("SMTP connection error:", error);
  } else {
    console.log("SMTP server is ready to take our messages");
  }
});

export default transporter;
