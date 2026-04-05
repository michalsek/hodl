import { z } from 'zod';

export const ownerTypeSchema = z.enum(['agent', 'subagent', 'vscode', 'cli']);

export const ownerIdentitySchema = z
  .object({
    owner_type: ownerTypeSchema,
    owner_id: z.string().trim().min(1),
    session_id: z.string().trim().min(1),
  })
  .strict();

export const acquireRequestSchema = ownerIdentitySchema
  .extend({
    path: z.string().trim().min(1),
    ttl_ms: z.number().int().positive().optional(),
  })
  .strict();

export const renewRequestSchema = z
  .object({
    token: z.string().trim().min(1),
  })
  .strict();

export const releaseRequestSchema = z
  .object({
    token: z.string().trim().min(1),
  })
  .strict();

export const subscribeRequestSchema = z
  .object({
    path: z.string().trim().min(1).optional(),
    prefix: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const definedCount = Number(value.path != null) + Number(value.prefix != null);

    if (definedCount !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Exactly one of `path` or `prefix` must be provided.',
      });
    }
  });
