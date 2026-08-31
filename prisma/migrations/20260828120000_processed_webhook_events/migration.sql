-- Webhook idempotency (spec §5.10, Batch 13).
--
-- Written by hand rather than generated: Prisma's schema engine is a native
-- binary that this host's application-control policy refuses to execute. The
-- SQL is what `migrate dev` would have produced, and the same hand-written
-- approach already applies to the GIST indexes and CHECK constraints elsewhere
-- in this directory.

CREATE TABLE "processed_webhook_events" (
    "id" UUID NOT NULL,
    "source" "payment_source" NOT NULL,
    "event_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("id")
);

-- The constraint that makes duplicate delivery a no-op rather than a
-- double-apply. Both Stripe and the app stores retry as a matter of course.
CREATE UNIQUE INDEX "processed_webhook_events_source_event_id_key"
    ON "processed_webhook_events"("source", "event_id");

CREATE INDEX "processed_webhook_events_created_at_idx"
    ON "processed_webhook_events"("created_at");
