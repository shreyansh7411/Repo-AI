import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import repositoryRoutes from "./ingestion/repository-routes.js";
import authRoutes from "./auth/auth-routes.js";
import { validateProductionEnvironment } from "./config/environment.js";

dotenv.config();
validateProductionEnvironment();

const app = express();
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT) || 5000;

app.use(cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true
}));
app.use(express.json());

app.get("/api/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "repository-intelligence-backend"
    });
});

app.use("/api/auth", authRoutes);
app.use("/api/repositories", repositoryRoutes);

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend listening on port ${PORT}`);
});
