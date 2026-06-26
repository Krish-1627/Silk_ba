export class PolicyViolationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PolicyViolationError';
    this.code = 'POLICY_VIOLATION';
    this.details = details;
  }
}

export class FailClosedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FailClosedError';
    this.code = 'FAIL_CLOSED';
    this.details = details;
  }
}
