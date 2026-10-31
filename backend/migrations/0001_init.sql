-- Verdict schema v1. One table per entity in internal/entity; ids are the stable seed strings.

CREATE TABLE customers (
    id          text PRIMARY KEY,
    name        text        NOT NULL,
    email       text        NOT NULL,
    platform    text        NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
    app_version text        NOT NULL,
    country     text        NOT NULL,
    created_at  timestamptz NOT NULL
);

CREATE TABLE subscriptions (
    id          text PRIMARY KEY,
    customer_id text          NOT NULL REFERENCES customers (id),
    channel     text          NOT NULL CHECK (channel IN ('web', 'app_store')),
    plan        text          NOT NULL CHECK (plan IN ('monthly', 'yearly')),
    price_usd   numeric(10,2) NOT NULL,
    status      text          NOT NULL CHECK (status IN ('active', 'canceled')),
    renews_at   timestamptz,
    canceled_at timestamptz
);
CREATE INDEX subscriptions_customer_idx ON subscriptions (customer_id);

CREATE TABLE payments (
    id              text PRIMARY KEY,
    customer_id     text          NOT NULL REFERENCES customers (id),
    subscription_id text          NOT NULL REFERENCES subscriptions (id),
    channel         text          NOT NULL CHECK (channel IN ('web', 'app_store')),
    amount_usd      numeric(10,2) NOT NULL,
    status          text          NOT NULL CHECK (status IN ('succeeded', 'refunded', 'failed')),
    at              timestamptz   NOT NULL
);
CREATE INDEX payments_customer_idx ON payments (customer_id);
CREATE INDEX payments_subscription_idx ON payments (subscription_id);

CREATE TABLE entitlements (
    id            text PRIMARY KEY,
    customer_id   text    NOT NULL REFERENCES customers (id),
    account_email text    NOT NULL,
    active        boolean NOT NULL,
    payment_id    text REFERENCES payments (id),
    granted_at    timestamptz
);
CREATE INDEX entitlements_customer_idx ON entitlements (customer_id);

CREATE TABLE session_events (
    id          text PRIMARY KEY,
    customer_id text        NOT NULL REFERENCES customers (id),
    source      text        NOT NULL CHECK (source IN ('web', 'ios', 'android')),
    type        text        NOT NULL,
    detail      text        NOT NULL DEFAULT '',
    app_version text        NOT NULL DEFAULT '',
    at          timestamptz NOT NULL
);
CREATE INDEX session_events_customer_idx ON session_events (customer_id, at);

CREATE TABLE error_logs (
    id          text PRIMARY KEY,
    customer_id text REFERENCES customers (id), -- NULL = not tied to a customer
    service     text        NOT NULL CHECK (service IN ('billing', 'entitlements', 'auth', 'email', 'app')),
    code        text        NOT NULL,
    message     text        NOT NULL,
    app_version text        NOT NULL DEFAULT '',
    at          timestamptz NOT NULL
);
CREATE INDEX error_logs_customer_idx ON error_logs (customer_id, at);

CREATE TABLE email_logs (
    id          text PRIMARY KEY,
    customer_id text        NOT NULL REFERENCES customers (id),
    to_address  text        NOT NULL,
    template    text        NOT NULL,
    status      text        NOT NULL CHECK (status IN ('delivered', 'bounced')),
    at          timestamptz NOT NULL
);
CREATE INDEX email_logs_customer_idx ON email_logs (customer_id, at);

CREATE TABLE help_articles (
    id    text PRIMARY KEY,
    title text   NOT NULL,
    steps text[] NOT NULL,
    tags  text[] NOT NULL
);

CREATE TABLE cases (
    id          text PRIMARY KEY,
    customer_id text        NOT NULL REFERENCES customers (id),
    subject     text        NOT NULL,
    status      text        NOT NULL CHECK (status IN ('open', 'waiting_customer', 'with_tech', 'resolved')),
    created_at  timestamptz NOT NULL,
    verdict     jsonb,      -- entity.Verdict, NULL until investigated
    outcome     text CHECK (outcome IN ('user_can_fix', 'support_can_fix', 'tech_team', 'need_more_info', 'suspicious'))
);

CREATE TABLE chat_messages (
    id      text PRIMARY KEY,
    case_id text        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
    sender  text        NOT NULL CHECK (sender IN ('customer', 'support')),
    body    text        NOT NULL,
    at      timestamptz NOT NULL
);
CREATE INDEX chat_messages_case_idx ON chat_messages (case_id, at);

CREATE TABLE tech_issues (
    id                    text PRIMARY KEY,
    signature             text        NOT NULL UNIQUE CHECK (signature IN ('cancel_not_synced', 'entitlement_grant_failed', 'duplicate_charge')),
    title                 text        NOT NULL,
    root_cause            text        NOT NULL,
    evidence_ids          text[]      NOT NULL DEFAULT '{}',
    case_ids              text[]      NOT NULL DEFAULT '{}',
    affected_customer_ids text[]      NOT NULL DEFAULT '{}',
    status                text        NOT NULL CHECK (status IN ('new', 'in_progress', 'resolved')),
    created_at            timestamptz NOT NULL
);

CREATE TABLE audit_log (
    id      bigserial PRIMARY KEY,
    case_id text        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
    actor   text        NOT NULL CHECK (actor IN ('ai', 'support', 'system')),
    step    text        NOT NULL,
    detail  text        NOT NULL DEFAULT '',
    at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_case_idx ON audit_log (case_id, id);

-- Last `make eval` result (BE9 / Metrics.eval).
CREATE TABLE eval_runs (
    id      bigserial PRIMARY KEY,
    correct int         NOT NULL,
    total   int         NOT NULL,
    ran_at  timestamptz NOT NULL DEFAULT now()
);
