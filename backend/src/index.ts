import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import repositoryRoutes from "./ingestion/repository-routes.js";
import authRoutes from "./auth/auth-routes.js";
import demoRoutes from "./demo/demo-routes.js";
import { reconcileDemoSessions, startDemoCleanupWorker } from "./demo/demo-cleanup-service.js";
import { validateProductionEnvironment } from "./config/environment.js";

dotenv.config();
validateProductionEnvironment();

const app = express();
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT) || 5000;
const configuredFrontendOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";

app.use(cors({
    origin(origin, callback) {
        if (!origin || origin === configuredFrontendOrigin) {
            callback(null, true);
            return;
        }
        const isLocalDevelopmentOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin);
        if (process.env.NODE_ENV !== "production" && isLocalDevelopmentOrigin) {
            callback(null, true);
            return;
        }
        callback(null, false);
    },
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
app.use("/api/demo", demoRoutes);

async function startServer(): Promise<void> {
    await reconcileDemoSessions();
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Backend listening on port ${PORT}`);
        startDemoCleanupWorker();
    });
}

void startServer().catch(error => {
    console.error("Demo session reconciliation failed; backend will not start.", error);
    process.exitCode = 1;
});
