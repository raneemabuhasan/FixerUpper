export type WorkflowErrorCode = 'INVALID_TRANSITION' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_INPUT';

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;

  constructor(code: WorkflowErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
  }
}
