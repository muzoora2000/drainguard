import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

export const isoDateSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'phone must be in E.164 format, e.g. +254712345678');

export const optionalPhoneSchema = z.union([phoneSchema, z.literal(''), z.null()]).optional();

export const notesSchema = z.string().trim().min(1).max(5000);
