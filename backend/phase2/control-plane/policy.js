const ALLOWED_OPERATIONS = Object.freeze({
  FactExtractionEngine: ['extract_facts'],
  RootCauseEngine: ['semantic_root_cause_assist'],
  ConversationLayer: ['realize_question_text']
});

const FORBIDDEN_OPERATIONS = Object.freeze([
  'decide_opportunities',
  'decide_priorities',
  'decide_completion',
  'override_confidence',
  'write_final_system_state'
]);

export function isOperationAllowed(component, operation) {
  const allowedByComponent = ALLOWED_OPERATIONS[component] || [];
  return allowedByComponent.includes(operation) && !FORBIDDEN_OPERATIONS.includes(operation);
}

export function isOperationForbidden(operation) {
  return FORBIDDEN_OPERATIONS.includes(operation);
}

export function getAllowedOperations() {
  return ALLOWED_OPERATIONS;
}

export function getForbiddenOperations() {
  return FORBIDDEN_OPERATIONS;
}
