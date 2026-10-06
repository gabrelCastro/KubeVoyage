-- ── "Your app": the draft being edited and the images published from it ────────
-- The code is stored, never executed: it only ever runs in the learner's own browser.

-- One row per user; also the row we lock to serialize concurrent syncs.
CREATE TABLE app_workspace (
    user_id    uuid PRIMARY KEY REFERENCES app_user (id) ON DELETE CASCADE,
    name       text        NOT NULL,
    emoji      text        NOT NULL,
    color      text        NOT NULL,
    message    text        NOT NULL,
    design_at  timestamptz,
    code       text CHECK (code IS NULL OR length(code) <= 16000),
    code_at    timestamptz,
    customized boolean     NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Published images. A tag never changes once published (see Workspace.Release#winner).
CREATE TABLE app_release (
    user_id    uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    tag        text        NOT NULL,
    name       text        NOT NULL,
    emoji      text        NOT NULL,
    color      text        NOT NULL,
    message    text        NOT NULL,
    broken     boolean     NOT NULL,
    code       text CHECK (code IS NULL OR length(code) <= 16000),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, tag)
);
