ALTER TABLE "vault"."document" ADD COLUMN "label" bytea NOT NULL;--> statement-breakpoint
ALTER TABLE "vault"."document_replacement" ADD COLUMN "label" bytea NOT NULL;--> statement-breakpoint
ALTER TABLE "vault"."document" ADD CONSTRAINT "document_label_size" CHECK (octet_length("label") BETWEEN 1 AND 32768);--> statement-breakpoint
ALTER TABLE "vault"."document_replacement" ADD CONSTRAINT "document_replacement_label_size" CHECK (octet_length("label") BETWEEN 1 AND 32768);