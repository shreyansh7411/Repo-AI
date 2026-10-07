import { Router } from "express";
import { indexRepositoryHandler } from "./repository-controller.js";
import { generateEmbeddingsHandler, semanticSearchHandler } from "../embeddings/embedding-controller.js";
import { askHandler, retrieveHandler } from "../retrieval/retrieval-controller.js";
import { callersHandler, calleesHandler, impactHandler, pathHandler } from "../graph/graph-controller.js";
import { fileQueryHandler, impactQueryHandler, pathQueryHandler, searchQueryHandler, symbolQueryHandler, traceQueryHandler } from "../query/repository-query-controller.js";

const router = Router();

router.post("/index", indexRepositoryHandler);
router.post("/:repositoryId/embeddings", generateEmbeddingsHandler);
router.post("/:repositoryId/search", semanticSearchHandler);
router.post("/:repositoryId/retrieve", retrieveHandler);
router.post("/:repositoryId/ask", askHandler);
router.post("/:repositoryId/trace/callers", callersHandler);
router.post("/:repositoryId/trace/callees", calleesHandler);
router.post("/:repositoryId/impact", impactHandler);
router.post("/:repositoryId/trace/path", pathHandler);
router.post("/:repositoryId/query/symbol", symbolQueryHandler);
router.post("/:repositoryId/query/file", fileQueryHandler);
router.post("/:repositoryId/query/search", searchQueryHandler);
router.post("/:repositoryId/query/trace", traceQueryHandler);
router.post("/:repositoryId/query/impact", impactQueryHandler);
router.post("/:repositoryId/query/path", pathQueryHandler);

export default router;
