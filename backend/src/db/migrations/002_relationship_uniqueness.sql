CREATE UNIQUE INDEX IF NOT EXISTS relationships_unique_edge
ON relationships (repository_id, source_symbol_id, target_symbol_id, type);
