'use strict';

const FORMAT_VERSION = 1;
const PHASES = ['intake', 'brainstorm', 'plan', 'build', 'review', 'pr'];
const CHECKPOINTS = {
  intake: ['context'],
  brainstorm: ['clarify', 'knowledge', 'spec'],
  plan: ['plan'],
  build: ['implementation'],
  review: ['integration-review'],
  pr: ['delivery'],
};
const ARTIFACT_STATUS = ['draft', 'approved', 'stale', 'superseded', 'completed', 'blocked'];
const DEFAULT_FILES = {
  context: 'ticket_context.md',
  knowledge: 'knowledge/knowledge_brief.md',
  spec: 'spec.md',
  plan: 'plan.md',
  tests: 'test-cases.md',
};

module.exports = { FORMAT_VERSION, PHASES, CHECKPOINTS, ARTIFACT_STATUS, DEFAULT_FILES };
