ALTER TABLE "knowledge"."correction_source" ADD COLUMN "page_url" text;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_source" DROP CONSTRAINT "correction_source_shape", ADD CONSTRAINT "correction_source_shape" CHECK (CASE "kind"
        WHEN 'link' THEN "text" IS NULL AND "upload_id" IS NULL
          AND "page_url" IS NULL
          AND "url" ~ '^https://[^[:space:]]+$' AND char_length("url") <= 2048
        WHEN 'text' THEN "url" IS NULL AND "upload_id" IS NULL
          AND "page_url" IS NULL AND char_length("text") BETWEEN 1 AND 20000
        WHEN 'file' THEN "url" IS NULL AND "text" IS NULL
          AND "upload_id" IS NOT NULL
          AND ("page_url" IS NULL OR ("page_url" ~ '^https://[^[:space:]]+$'
            AND char_length("page_url") <= 2048))
        ELSE false END);