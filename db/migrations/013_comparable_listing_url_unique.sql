-- migrate:up

-- Required by create_comparable's ON CONFLICT (listing_url) DO NOTHING deduplication.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comparables_listing_url ON comparables(listing_url);

-- migrate:down

DROP INDEX IF EXISTS uq_comparables_listing_url;
