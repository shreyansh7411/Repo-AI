ALTER TABLE repositories
    ADD COLUMN owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX repositories_owner_user_id_idx
    ON repositories(owner_user_id);
