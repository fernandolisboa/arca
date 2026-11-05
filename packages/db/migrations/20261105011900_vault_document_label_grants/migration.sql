-- Sealed labels (spec 0005, R4): app_api writes a document's label when it creates the document,
-- a replacement's when the owner approves it, and moves the replacement's onto the document when
-- its upload is confirmed. The server stores the ciphertext and never reads a name.
GRANT INSERT ("label"), UPDATE ("label") ON "vault"."document" TO app_api;
--> statement-breakpoint
GRANT INSERT ("label") ON "vault"."document_replacement" TO app_api;
