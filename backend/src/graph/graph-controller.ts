import type { Request, Response } from "express";
import { GraphRepository } from "./graph-repository.js";
import { GraphAnalysisError, GraphTraversalService } from "./graph-traversal-service.js";
import { RELATIONSHIP_TYPES, type RelationshipType } from "./types.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const repository = new GraphRepository();
const service = new GraphTraversalService(repository);

class InvalidGraphRequest extends Error {}
type GraphAction = (repositoryId: string, body: Record<string, unknown>) => Promise<unknown>;

function getId(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }

async function respond(req: Request, res: Response, action: GraphAction) {
    const repositoryId = getId(req.params.repositoryId);
    if (!uuidPattern.test(repositoryId)) return res.status(400).json({ error: { code: "INVALID_REPOSITORY_ID", message: "A valid repositoryId is required." } });
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
    try {
        if (!(await repository.repositoryExists(repositoryId))) return res.status(404).json({ error: { code: "REPOSITORY_NOT_FOUND", message: "Repository was not found." } });
        return res.json(await action(repositoryId, body));
    } catch (error) {
        if (error instanceof InvalidGraphRequest) return res.status(400).json({ error: { code: "INVALID_REQUEST", message: error.message } });
        if (error instanceof GraphAnalysisError) return res.status(404).json({ error: { code: error.code, message: error.message } });
        return res.status(500).json({ error: { code: "GRAPH_ANALYSIS_FAILED", message: "Graph analysis could not be completed." } });
    }
}

function symbolId(body: Record<string, unknown>, field = "symbolId"): string {
    const value = body[field];
    if (typeof value !== "string" || !uuidPattern.test(value)) throw new InvalidGraphRequest(`${field} must be a valid UUID.`);
    return value;
}

function maxDepth(body: Record<string, unknown>, fallback: number): number {
    const value = body.maxDepth ?? fallback;
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5) throw new InvalidGraphRequest("maxDepth must be an integer between 1 and 5.");
    return Number(value);
}

function relationshipTypes(body: Record<string, unknown>, fallback: RelationshipType[]): RelationshipType[] {
    if (body.relationshipTypes === undefined) return fallback;
    const value = body.relationshipTypes;
    if (!Array.isArray(value) || value.length === 0 || value.some(type => typeof type !== "string" || !RELATIONSHIP_TYPES.includes(type as RelationshipType))) {
        throw new InvalidGraphRequest(`relationshipTypes must be a non-empty array containing only ${RELATIONSHIP_TYPES.join(", ")}.`);
    }
    return [...new Set(value as RelationshipType[])].sort();
}

export async function callersHandler(req: Request, res: Response) {
    return respond(req, res, (repositoryId, body) => service.trace(repositoryId, symbolId(body), "INCOMING",
        maxDepth(body, 1), ["CALLS"]));
}

export async function calleesHandler(req: Request, res: Response) {
    return respond(req, res, (repositoryId, body) => service.trace(repositoryId, symbolId(body), "OUTGOING",
        maxDepth(body, 1), ["CALLS"]));
}

export async function impactHandler(req: Request, res: Response) {
    return respond(req, res, (repositoryId, body) => service.impact(repositoryId, symbolId(body), maxDepth(body, 1)));
}

export async function pathHandler(req: Request, res: Response) {
    return respond(req, res, (repositoryId, body) => service.shortestPath(repositoryId, symbolId(body, "fromSymbolId"),
        symbolId(body, "toSymbolId"), maxDepth(body, 5), relationshipTypes(body, [...RELATIONSHIP_TYPES])));
}
