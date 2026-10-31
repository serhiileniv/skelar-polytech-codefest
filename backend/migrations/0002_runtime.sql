-- Runtime ids and board rules for actions, replies and the tech board (BE5–BE6).

-- One OPEN card per signature (a resolved card may be followed by a new one).
ALTER TABLE tech_issues DROP CONSTRAINT IF EXISTS tech_issues_signature_key;
CREATE UNIQUE INDEX tech_issues_open_signature_idx ON tech_issues (signature) WHERE status <> 'resolved';

-- Generated ids: tech_0001…, msg_r0001… Restarted by the demo reset.
CREATE SEQUENCE tech_issue_seq START 1;
CREATE SEQUENCE reply_seq START 1;
