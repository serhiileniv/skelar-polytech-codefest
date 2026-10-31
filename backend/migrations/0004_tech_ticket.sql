-- Fix-it createTechTicket (rule T2): evidence notes and the case chat history on a tech card.
ALTER TABLE tech_issues
    ADD COLUMN evidence    jsonb  NOT NULL DEFAULT '[]',
    ADD COLUMN message_ids text[] NOT NULL DEFAULT '{}';
