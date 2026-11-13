import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import repositoryRoutes from "./ingestion/repository-routes.js";
import { validateProductionEnvironment } from "./config/environment.js";

dotenv.config();
validateProductionEnvironment();

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(cors(process.env.NODE_ENV === "production"
    ? { origin: process.env.CORS_ORIGIN }
    : undefined));
app.use(express.json());

app.get("/api/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "repository-intelligence-backend"
    });
});

app.use("/api/repositories", repositoryRoutes);

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend listening on port ${PORT}`);
});
