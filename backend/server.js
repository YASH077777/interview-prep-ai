const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// Load environment variables FIRST
dotenv.config();

const { connectDB } = require("./config/db");

// Fail early with a clear message instead of a confusing signup/login error later
const missing = ["MONGO_URI", "JWT_SECRET"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required environment variable(s): ${missing.join(", ")}`);
  console.error("   Copy backend/.env.example to backend/.env and fill in the values.");
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
  console.warn("⚠️  Neither GEMINI_API_KEY nor GROQ_API_KEY is set - AI features will fail.");
} else if (!process.env.GEMINI_API_KEY) {
  console.warn("⚠️  GEMINI_API_KEY is not set - using Groq only.");
} else if (!process.env.GROQ_API_KEY) {
  console.warn("⚠️  GROQ_API_KEY is not set - no backup if Gemini hits its limit.");
}

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      "https://interview-prep-ai-web.vercel.app",
      ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
    ];
    // allow any localhost port (Vite may use 5173, 5174, 5175...)
    if (!origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) || allowed.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));


app.use(express.json({ limit: '2mb' }));

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/session", require("./routes/sessionRoutes"));
app.use("/api/question", require("./routes/questionRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));

app.get("/", (req, res) => res.send("Interview Prep API Running ✅"));

const PORT = process.env.PORT || 5000;

// Connect DB BEFORE starting server
const startServer = async () => {
  try {
    await connectDB();
    console.log("✅ Database ready!");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
};

startServer();