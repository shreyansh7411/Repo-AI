import type { Pool, PoolClient } from "pg";
import { pool } from "../config/database.js";
import type { StructuralRelationship, StructuralSymbol } from "./types.js";

type Db = Pool | PoolClient;
interface SymbolRow extends StructuralSymbol { parentSymbolId: string | null }
interface RelationshipRow { id: string; type: string; sourceId: string; targetId: string }

export class StructuralRetrievalRepository {
    constructor(private readonly db: Db = pool) {}

    async repositoryExists(repositoryId: string): Promise<boolean> {
        const result = await this.db.query("SELECT 1 FROM repositories WHERE id=$1", [repositoryId]);
        return result.rowCount !== 0;
    }

    async findMatchingSymbols(repositoryId: string, query: string, limit = 8): Promise<StructuralSymbol[]> {
        const rawTokens = query.toLowerCase().match(/[a-z_$][\w$]*/g) ?? [];
        const tokens = [...new Set(rawTokens.flatMap(token => token.endsWith("s") && token.length > 4 ? [token, token.slice(0, -1)] : [token]))];
        if (!tokens.length) return [];
        const fuzzyTokens = tokens.filter(token => token.length >= 4);
        const patterns = fuzzyTokens.map(token => `%${token}%`);
        const result = await this.db.query<StructuralSymbol>(
            `SELECT s.id, s.repository_id AS "repositoryId", s.file_id AS "fileId", f.path AS "filePath", f.language,
                    s.name, s.type AS "symbolType", s.start_line AS "startLine", s.end_line AS "endLine", s.signature
             FROM symbols s JOIN files f ON f.id=s.file_id AND f.repository_id=s.repository_id
             WHERE s.repository_id=$1 AND (lower(s.name)=ANY($2::text[]) OR lower(s.name) LIKE ANY($3::text[]))
             ORDER BY CASE WHEN lower(s.name)=ANY($2::text[]) THEN 0 ELSE 1 END,
                      COALESCE(array_position($2::text[], lower(s.name)), 999), s.start_line, s.id LIMIT $4`,
            [repositoryId, tokens, patterns, limit]);
        return result.rows;
    }

    async expand(repositoryId: string, initialIds: string[], maxDepth: number): Promise<{ symbols: StructuralSymbol[]; relationships: StructuralRelationship[] }> {
        if (!initialIds.length || maxDepth < 1) return { symbols: [], relationships: [] };
        const found = new Map<string, StructuralSymbol>();
        const edges = new Map<string, RelationshipRow>();
        const visited = new Set(initialIds);
        let frontier = [...new Set(initialIds)];
        for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
            const rows = await this.db.query<RelationshipRow>(
                `SELECT r.id, r.type, r.source_symbol_id AS "sourceId", r.target_symbol_id AS "targetId"
                 FROM relationships r
                 JOIN symbols src ON src.id=r.source_symbol_id AND src.repository_id=r.repository_id
                 JOIN symbols dst ON dst.id=r.target_symbol_id AND dst.repository_id=r.repository_id
                 WHERE r.repository_id=$1 AND (r.source_symbol_id=ANY($2::uuid[]) OR r.target_symbol_id=ANY($2::uuid[]))
                 ORDER BY r.type, r.id`, [repositoryId, frontier]);
            const next: string[] = [];
            for (const row of rows.rows) {
                edges.set(row.id, row);
                for (const id of [row.sourceId, row.targetId]) if (!visited.has(id)) { visited.add(id); next.push(id); }
            }
            frontier = next;
        }
        const ids = [...visited];
        const symbols = await this.db.query<SymbolRow>(
            `SELECT s.id, s.repository_id AS "repositoryId", s.file_id AS "fileId", f.path AS "filePath", f.language,
                    s.name, s.type AS "symbolType", s.start_line AS "startLine", s.end_line AS "endLine",
                    s.signature, s.parent_symbol_id AS "parentSymbolId"
             FROM symbols s JOIN files f ON f.id=s.file_id AND f.repository_id=s.repository_id
             WHERE s.repository_id=$1 AND s.id=ANY($2::uuid[])`, [repositoryId, ids]);
        for (const symbol of symbols.rows) found.set(symbol.id, symbol);
        const relationships: StructuralRelationship[] = [];
        for (const edge of edges.values()) {
            const source = found.get(edge.sourceId), target = found.get(edge.targetId);
            if (source && target) relationships.push({ id: edge.id, type: edge.type, source, target });
        }
        return { symbols: [...found.values()], relationships };
    }

    async getSymbolChunks(repositoryId: string, symbolIds: string[]) {
        if (!symbolIds.length) return [];
        const result = await this.db.query(
            `SELECT c.id, c.repository_id AS "repositoryId", c.file_id AS "fileId", f.path AS "filePath",
                    c.symbol_id AS "symbolId", s.name AS "symbolName", s.type AS "symbolType",
                    c.start_line AS "startLine", c.end_line AS "endLine", c.content
             FROM code_chunks c JOIN files f ON f.id=c.file_id AND f.repository_id=c.repository_id
             LEFT JOIN symbols s ON s.id=c.symbol_id AND s.repository_id=c.repository_id AND s.file_id=c.file_id
             WHERE c.repository_id=$1 AND c.symbol_id=ANY($2::uuid[])
             ORDER BY c.start_line,c.id`, [repositoryId, symbolIds]);
        return result.rows;
    }
}
