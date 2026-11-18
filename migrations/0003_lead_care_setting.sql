-- Where the person cared for lives now, and what they may need from us later.
-- Set by the team in the dashboard, e.g. a family who moved into assisted
-- living but may later need a higher level of care or private duty help.
ALTER TABLE leads ADD COLUMN lives_in TEXT CHECK (lives_in IN ('home','assisted_living','memory_care','nursing_home'));
ALTER TABLE leads ADD COLUMN future_care TEXT NOT NULL DEFAULT '[]';
