import { Router, type Request, type Response } from "express";
import { callersHandler, calleesHandler } from "../graph/graph-controller.js";
import { fileQueryHandler, searchQueryHandler, symbolQueryHandler, symbolsQueryHandler } from "../query/repository-query-controller.js";
import { createDemoSessionHandler, endDemoSessionHandler, getDemoRepositoryHandler, getDemoSessionHandler, listDemoFilesHandler } from "./demo-controller.js";
import { demoRateLimit, demoSessionRateLimit, requireDemoOrigin, requireDemoRepository, requireDemoSession } from "./demo-session-middleware.js";

const router = Router();

router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
});
router.use(requireDemoOrigin);
router.post("/session", (req, res, next) => { void demoRateLimit("index", req, res, next); }, createDemoSessionHandler);
router.get("/session", (req, res, next) => { void demoRateLimit("read", req, res, next); }, requireDemoSession, demoSessionRateLimit, getDemoSessionHandler);
router.delete("/session", (req, res, next) => { void demoRateLimit("read", req, res, next); }, requireDemoSession, demoSessionRateLimit, endDemoSessionHandler);

const repositories = Router({ mergeParams: true });
repositories.use(requireDemoSession, demoSessionRateLimit, requireDemoRepository);
repositories.get("/", getDemoRepositoryHandler);
repositories.get("/files", listDemoFilesHandler);
repositories.get("/query/symbols", symbolsQueryHandler);
repositories.post("/query/symbol", symbolQueryHandler);
repositories.post("/query/file", fileQueryHandler);
repositories.post("/trace/callers", callersHandler);
repositories.post("/trace/callees", calleesHandler);
repositories.post("/query/search", searchHandler);
router.use("/repositories/:repositoryId", (req, res, next) => { void demoRateLimit("read", req, res, next); }, repositories);

function searchHandler(req: Request, res: Response): Promise<unknown> {
    if (req.body?.mode !== "structural") {
        return Promise.resolve(res.status(400).json({ error: {
            code: "DEMO_SEMANTIC_SEARCH_UNAVAILABLE",
            message: "Only structural search is available in demo mode. Demo repositories do not generate embeddings, so semantic and hybrid search are unavailable."
        } }));
    }
    return searchQueryHandler(req, res);
}

export default router;
