-- ── Accounts ───────────────────────────────────────────────────────────────
CREATE TABLE app_user (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text        NOT NULL,
    -- lower-cased email: one account per address, however it's typed
    email_key     text        NOT NULL UNIQUE,
    display_name  text,
    avatar_url    text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz NOT NULL DEFAULT now()
);

-- Ways to sign in to an account: ('email', <email_key>) or ('github', <github user id>)
CREATE TABLE user_identity (
    provider   text        NOT NULL,
    subject    text        NOT NULL,
    user_id    uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);
CREATE INDEX user_identity_user_idx ON user_identity (user_id);

-- Sign-in links. Only a SHA-256 of the token is stored; a database leak can't be used to sign in.
CREATE TABLE magic_link_token (
    token_hash bytea       PRIMARY KEY,
    email      text        NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX magic_link_token_expiry_idx ON magic_link_token (expires_at);

-- ── Progress ───────────────────────────────────────────────────────────────
-- Values only ever grow (see Progress.merge), so concurrent writers converge.
CREATE TABLE lesson_progress (
    user_id      uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    lesson_id    text        NOT NULL,
    objectives   text[]      NOT NULL DEFAULT '{}',
    completed_at timestamptz,
    best_ms      integer     CHECK (best_ms IS NULL OR best_ms > 0),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, lesson_id)
);

-- One row per user; also the row we lock to serialize concurrent syncs.
CREATE TABLE progress_meta (
    user_id        uuid PRIMARY KEY REFERENCES app_user (id) ON DELETE CASCADE,
    last_lesson_id text,
    last_lesson_at timestamptz,
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Spring Session (verbatim from spring-session-jdbc's schema-postgresql.sql) ─
CREATE TABLE SPRING_SESSION (
    PRIMARY_ID            CHAR(36) NOT NULL,
    SESSION_ID            CHAR(36) NOT NULL,
    CREATION_TIME         BIGINT   NOT NULL,
    LAST_ACCESS_TIME      BIGINT   NOT NULL,
    MAX_INACTIVE_INTERVAL INT      NOT NULL,
    EXPIRY_TIME           BIGINT   NOT NULL,
    PRINCIPAL_NAME        VARCHAR(100),
    CONSTRAINT SPRING_SESSION_PK PRIMARY KEY (PRIMARY_ID)
);
CREATE UNIQUE INDEX SPRING_SESSION_IX1 ON SPRING_SESSION (SESSION_ID);
CREATE INDEX SPRING_SESSION_IX2 ON SPRING_SESSION (EXPIRY_TIME);
CREATE INDEX SPRING_SESSION_IX3 ON SPRING_SESSION (PRINCIPAL_NAME);

CREATE TABLE SPRING_SESSION_ATTRIBUTES (
    SESSION_PRIMARY_ID CHAR(36)     NOT NULL,
    ATTRIBUTE_NAME     VARCHAR(200) NOT NULL,
    ATTRIBUTE_BYTES    BYTEA        NOT NULL,
    CONSTRAINT SPRING_SESSION_ATTRIBUTES_PK PRIMARY KEY (SESSION_PRIMARY_ID, ATTRIBUTE_NAME),
    CONSTRAINT SPRING_SESSION_ATTRIBUTES_FK FOREIGN KEY (SESSION_PRIMARY_ID) REFERENCES SPRING_SESSION (PRIMARY_ID) ON DELETE CASCADE
);
