import { z } from 'zod';

export type WorkflowErrorCode = 'INVALID_TRANSITION' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_INPUT';

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;

  constructor(code: WorkflowErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
  }
}

// Parses with Zod, turning failures into INVALID_INPUT.
export function parseInput<S extends z.ZodType>(schema: S, value: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map(i => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message.replace(/^Invalid input: /, ''));
    throw new WorkflowError('INVALID_INPUT', `Invalid ${label}: ${issues.join('; ')}`);
  }
  return result.data;
}
