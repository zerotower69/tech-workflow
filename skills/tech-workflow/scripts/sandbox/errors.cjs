'use strict';

class SandboxError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'SandboxError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new SandboxError(code, message, details);
}

module.exports = { SandboxError, fail };
