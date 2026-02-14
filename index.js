import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import MpesaRoutes from "./MpesaRoutes.js";

// Initialize environment variables
dotenv.config();

// Create Express application
const app = express();

// Set the port (use environment variable or default to 3000)
const PORT = process.env.PORT || 4000;

// Middleware
app.use(
  cors({
    origin: "*", // Allow all for now, or specify your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded request bodies

// Routes
app.use("/mpesa", MpesaRoutes);
app.set("trust proxy", 1); // Trust first proxy
// Basic health check route
app.get("/", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Mpesa Integration Service",
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Endpoint not found",
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: "error",
    message: "Internal server error",
  });
});

// Start the server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Mpesa routes available at http://localhost:${PORT}/mpesa`);
  console.log("lazima kila kitu ijipe");
});
