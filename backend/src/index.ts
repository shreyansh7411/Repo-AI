import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import repositoryRoutes from "./ingestion/repository-routes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "repository-intelligence-backend"
    });
});

app.use("/api/repositories", repositoryRoutes);

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});
