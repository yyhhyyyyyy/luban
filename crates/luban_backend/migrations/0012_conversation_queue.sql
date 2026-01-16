ALTER TABLE conversations
    ADD COLUMN queue_paused INTEGER NOT NULL DEFAULT 0;

ALTER TABLE conversations
    ADD COLUMN next_queued_prompt_id INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS conversation_queued_prompts (
    project_slug TEXT NOT NULL,
    workspace_name TEXT NOT NULL,
    thread_local_id INTEGER NOT NULL,
    prompt_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_slug, workspace_name, thread_local_id, prompt_id),
    FOREIGN KEY (project_slug, workspace_name, thread_local_id)
        REFERENCES conversations (project_slug, workspace_name, thread_local_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS conversation_queued_prompts_by_seq
    ON conversation_queued_prompts (project_slug, workspace_name, thread_local_id, seq);

