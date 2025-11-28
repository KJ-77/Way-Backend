import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import mongoSanitize from "express-mongo-sanitize";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import fs from "fs";
import https from "https";

// Authentication routes
import authRouter from "./src/Routes/AuthRouter.js";
import adminRouter from "./src/Routes/AdminRouter.js";

// Schedule routes
import scheduleRouter from "./src/Routes/ScheduleRouter.js";

// Event routes
import eventRouter from "./src/Routes/EventRouter.js";

// Host routes
import hostRouter from "./src/Routes/HostRouter.js";

// Home routes
import homeRouter from "./src/Routes/HomeRouter.js";

// About Us routes
import aboutUsRouter from "./src/Routes/AboutUsRouter.js";

// Production routes
import productionRouter from "./src/Routes/ProductionRouter.js";
import bookWithUsRouter from "./src/Routes/BookWithUsRouter.js";

// Tutor routes
import tutorRouter from "./src/Routes/TutorRouter.js";

// User routes
import userRouter from "./src/Routes/UserRouter.js";

// Registration routes
import scheduleRegistrationRouter from "./src/Routes/ScheduleRegistrationRouter.js";

// Product routes
import productCategoryRouter from "./src/Routes/ProductCategoryRouter.js";
import productRouter from "./src/Routes/ProductRouter.js";
import productRequestRouter from "./src/Routes/ProductRequestRouter.js";

// Contact routes
import contactRouter from "./src/Routes/ContactRouter.js";

// Load environment variables
dotenv.config();

const port = process.env.PORT || 5001;
const app = express();

// CORS configuration
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://zenith-eng.site",
      "https://www.zenith-eng.site",
      "https://dash.zenith-eng.site",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(mongoSanitize());

// Helmet for security
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  "/uploads",
  (req, res, next) => {
    const maxAge = process.env.NODE_ENV === "production" ? 86400 : 3600;
    res.setHeader("Cache-Control", "public, max-age=" + maxAge);
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(__dirname, "uploads"))
);

// Log requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Routes
app.get("/", (req, res) => {
  res.send("API is running");
});

// Authentication routes
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);

// Schedule routes
app.use("/api/schedule", scheduleRouter);

// Event routes
app.use("/api/event", eventRouter);

// Host routes
app.use("/api/host", hostRouter);

// Home routes
app.use("/api/home", homeRouter);

// About Us routes
app.use("/api/about-us", aboutUsRouter);

// Production routes
app.use("/api/production", productionRouter);
app.use("/api/book-with-us", bookWithUsRouter);

// Tutor routes
app.use("/api/tutor", tutorRouter);

// User routes
app.use("/api/user", userRouter);

// Registration routes
app.use("/api/registrations", scheduleRegistrationRouter);

// Product routes
app.use("/api/product-categories", productCategoryRouter);
app.use("/api/products", productRouter);
app.use("/api/product-requests", productRequestRouter);

// Contact routes
app.use("/api/contact", contactRouter);

// TODO: Add your business-specific routes here

// Error handling
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({
    success: false,
    message: "Internal Server Error",
    error: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Not Found",
  });
});

// MongoDB connection
mongoose
  .connect(
    process.env.MONGODB_URI
  )
  .then(() => {
    console.log("Connected to MongoDB ");
  })
  .catch((error) => {
    console.error("Failed to connect to MongoDB:", error);
  });

// Start server
if (process.env.NODE_ENV === "production") {
  const sslOptions = {
    key: fs.readFileSync("/etc/letsencrypt/live/zenith-eng.site/privkey.pem"),
    cert: fs.readFileSync(
      "/etc/letsencrypt/live/zenith-eng.site/fullchain.pem"
    ),
  };

  https.createServer(sslOptions, app).listen(port, () => {
    console.log(`HTTPS Server is running on https://zenith-eng.site:${port}`);
  });
} else {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}
export default app;
