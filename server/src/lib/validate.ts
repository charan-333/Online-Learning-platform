import type { Request } from 'express';
import { z } from 'zod';

export const parseBody = <T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> => schema.parse(req.body ?? {});
export const parseQuery = <T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> => schema.parse(req.query ?? {});
export const uuidParam = (req: Request, name = 'id') => z.string().uuid().parse(req.params[name]);

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Accepts ?x=a,b or ?x=a&x=b */
export const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (v === undefined || v === '' ? undefined : Array.isArray(v) ? v.flatMap((s) => String(s).split(',')) : String(v).split(',')), z.array(item).optional());

export const boolish = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional());

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
