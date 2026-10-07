import type { Pool, PoolClient } from "pg";
import { pool } from "../config/database.js";
import type { GraphRelationship, GraphSymbol, RelationshipType, TraversalDirection } from "./types.js";

type Db = Pool | PoolClient;

interface GraphRow {
    id: string;
    type: RelationshipType;
    sourceId: string;
    sourceName: string;
    sourceType: string;
    sourceFileId: string;
    sourceFilePath: string;
    sourceLanguage: string | null;
    sourceStartLine: number;
    sourceEndLine: number;
    sourceParentId: string | null;
    sourceParentName: string | null;
    sourceParentType: string | null;
    targetId: string;
    targetName: string;
    targetType: string;
    targetFileId: string;
    targetFilePath: string;
    targetLanguage: string | null;
    targetStartLine: number;
    targetEndLine: number;
    targetParentId: string | null;
    targetParentName: string | null;
    targetParentType: string | null;
}

export class GraphRepository {
    constructor(private readonly db: Db = pool) {}

    async repositoryExists(repositoryId: string): Promise<boolean> {
        const result = await this.db.query("SELECT 1 FROM repositories WHERE id=$1", [repositoryId]);
        return result.rowCount !== 0;
    }

    async getSymbol(repositoryId: string, symbolId: string): Promise<GraphSymbol | null> {
        const result = await this.db.query<GraphSymbol>(
            `SELECT s.id, s.name, s.type, s.file_id AS "fileId", f.path AS "filePath", f.language,
                    s.start_line AS "startLine", s.end_line AS "endLine",
                    p.id AS "parentSymbolId", p.name AS "parentSymbolName", p.type AS "parentSymbolType"
             FROM symbols s
             JOIN files f ON f.id=s.file_id AND f.repository_id=s.repository_id
             LEFT JOIN symbols p ON p.id=s.parent_symbol_id AND p.repository_id=s.repository_id
             WHERE s.repository_id=$1 AND s.id=$2`, [repositoryId, symbolId]);
        return result.rows[0] ?? null;
    }

    async getAdjacentRelationships(repositoryId: string, symbolIds: string[], direction: TraversalDirection,
        relationshipTypes: RelationshipType[]): Promise<GraphRelationship[]> {
        if (!symbolIds.length || !relationshipTypes.length) return [];
        const directionClause = direction === "INCOMING" ? "r.target_symbol_id=ANY($2::uuid[])"
            : direction === "OUTGOING" ? "r.source_symbol_id=ANY($2::uuid[])"
                : "(r.source_symbol_id=ANY($2::uuid[]) OR r.target_symbol_id=ANY($2::uuid[]))";
        const rows = await this.db.query<GraphRow>(
            `SELECT r.id, r.type,
                    src.id AS "sourceId", src.name AS "sourceName", src.type AS "sourceType", src.file_id AS "sourceFileId",
                    sf.path AS "sourceFilePath", sf.language AS "sourceLanguage", src.start_line AS "sourceStartLine",
                    src.end_line AS "sourceEndLine", sp.id AS "sourceParentId", sp.name AS "sourceParentName", sp.type AS "sourceParentType",
                    dst.id AS "targetId", dst.name AS "targetName", dst.type AS "targetType", dst.file_id AS "targetFileId",
                    tf.path AS "targetFilePath", tf.language AS "targetLanguage", dst.start_line AS "targetStartLine",
                    dst.end_line AS "targetEndLine", tp.id AS "targetParentId", tp.name AS "targetParentName", tp.type AS "targetParentType"
             FROM relationships r
             JOIN symbols src ON src.id=r.source_symbol_id AND src.repository_id=r.repository_id
             JOIN files sf ON sf.id=src.file_id AND sf.repository_id=r.repository_id
             LEFT JOIN symbols sp ON sp.id=src.parent_symbol_id AND sp.repository_id=r.repository_id
             JOIN symbols dst ON dst.id=r.target_symbol_id AND dst.repository_id=r.repository_id
             JOIN files tf ON tf.id=dst.file_id AND tf.repository_id=r.repository_id
             LEFT JOIN symbols tp ON tp.id=dst.parent_symbol_id AND tp.repository_id=r.repository_id
             WHERE r.repository_id=$1 AND ${directionClause} AND r.type=ANY($3::varchar[])
             ORDER BY r.type, sf.path, src.start_line, src.name, src.id, tf.path, dst.start_line, dst.name, dst.id, r.id`,
            [repositoryId, symbolIds, relationshipTypes]);
        return rows.rows.map(row => ({ id: row.id, type: row.type, source: mapSymbol(row, "source"), target: mapSymbol(row, "target") }));
    }
}

function mapSymbol(row: GraphRow, side: "source" | "target"): GraphSymbol {
    return {
        id: side === "source" ? row.sourceId : row.targetId,
        name: side === "source" ? row.sourceName : row.targetName,
        type: side === "source" ? row.sourceType : row.targetType,
        fileId: side === "source" ? row.sourceFileId : row.targetFileId,
        filePath: side === "source" ? row.sourceFilePath : row.targetFilePath,
        language: side === "source" ? row.sourceLanguage : row.targetLanguage,
        startLine: side === "source" ? row.sourceStartLine : row.targetStartLine,
        endLine: side === "source" ? row.sourceEndLine : row.targetEndLine,
        parentSymbolId: side === "source" ? row.sourceParentId : row.targetParentId,
        parentSymbolName: side === "source" ? row.sourceParentName : row.targetParentName,
        parentSymbolType: side === "source" ? row.sourceParentType : row.targetParentType
    };
}
