import { z } from 'zod';

/*
 * Uploads to the object store (spec 0005, R3; ADR-0029): the server grants one pathname, and the
 * device uploads there directly or through `uploadPresigned` from `@vercel/blob/client`.
 */

/** A SHA-256 digest, base64url without padding. */
export const Sha256 = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const ObjectUpload = z.discriminatedUnion('via', [
  z.object({ via: z.literal('vercel_blob'), pathname: z.string() }),
  z.object({ via: z.literal('direct'), url: z.string() }),
]);
export type ObjectUpload = z.infer<typeof ObjectUpload>;

/** The request `uploadPresigned` from `@vercel/blob/client` sends for one granted pathname. */
export const ObjectUploadUrlRequest = z.strictObject({
  type: z.literal('blob.generate-presigned-url'),
  payload: z.strictObject({
    pathname: z.string().max(128),
    clientPayload: z.string().max(256).nullable(),
    multipart: z.literal(false),
  }),
});

export const ObjectUploadUrlResponse = z.object({
  type: z.literal('blob.generate-presigned-url'),
  presignedUrlPayload: z.object({
    delegationToken: z.string(),
    signature: z.string(),
    params: z.record(z.string(), z.string()),
  }),
});
export type ObjectUploadUrlResponse = z.infer<typeof ObjectUploadUrlResponse>;
