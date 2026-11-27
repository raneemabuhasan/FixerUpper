import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import { z } from 'zod';
import { WorkflowError, parseInput, type WorkflowErrorCode } from './workflow/errors.ts';

const STATUS: Record<WorkflowErrorCode, number> = {
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
};

const idParam = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be 1-64 letters, digits, - or _');

export function params<K extends string>(req: Request, ...names: K[]): Record<K, string> {
  const shape = Object.fromEntries(names.map(n => [n, idParam])) as Record<K, typeof idParam>;
  return parseInput(z.object(shape), req.params, 'path') as Record<K, string>;
}

export function body<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  // Express 5 leaves req.body undefined when no JSON body was sent.
  return parseInput(schema, req.body ?? {}, 'body');
}

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.baseUrl}${req.path}.` } });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof WorkflowError) {
    res.status(STATUS[err.code]).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // Malformed JSON or oversized bodies from express.json().
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500 && typeof err.type === 'string') {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Request body must be valid JSON.' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
};
