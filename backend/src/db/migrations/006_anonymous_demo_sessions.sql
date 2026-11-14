CREATE TABLE demo_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash CHAR(64) NOT NULL UNIQUE,
    status VARCHAR(16) NOT NULL CHECK (status IN ('INDEXING', 'ACTIVE', 'DELETING')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    indexing_started_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    cleanup_started_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX demo_sessions_expiration_idx
    ON demo_sessions (expires_at, status);

ALTER TABLE repositories
    ADD COLUMN demo_session_id UUID REFERENCES demo_sessions(id) ON DELETE CASCADE;

ALTER TABLE repositories
    ADD CONSTRAINT repositories_owner_or_demo_exclusive
    CHECK (owner_user_id IS NULL OR demo_session_id IS NULL);

CREATE UNIQUE INDEX repositories_demo_session_unique
    ON repositories (demo_session_id)
    WHERE demo_session_id IS NOT NULL;

CREATE TABLE demo_rate_limits (
    client_hash CHAR(64) NOT NULL,
    action VARCHAR(24) NOT NULL,
    window_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count >= 0),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (client_hash, action, window_started_at)
);

CREATE INDEX demo_rate_limits_expiration_idx
    ON demo_rate_limits (expires_at);
