const PROMPTS = Object.freeze({
  'fact_extraction_v1': {
    owner: 'FactExtractionEngine',
    operation: 'extract_facts',
    templateVersion: '1.0.0',
    description: 'Extract candidate facts with provenance and ambiguity notes.'
  },
  'root_cause_assist_v1': {
    owner: 'RootCauseEngine',
    operation: 'semantic_root_cause_assist',
    templateVersion: '1.0.0',
    description: 'Assist semantic interpretation for root-cause hypotheses.'
  },
  'conversation_realize_question_v1': {
    owner: 'ConversationLayer',
    operation: 'realize_question_text',
    templateVersion: '1.0.0',
    description: 'Rewrite planner intent into user-facing wording without objective mutation.'
  }
});

export function getPrompt(promptId) {
  return PROMPTS[promptId] || null;
}

export function validatePromptOwnership(promptId, component, operation) {
  const prompt = getPrompt(promptId);
  if (!prompt) {
    return { valid: false, reason: 'prompt_not_registered' };
  }

  if (prompt.owner !== component) {
    return { valid: false, reason: 'prompt_owner_mismatch', expectedOwner: prompt.owner };
  }

  if (prompt.operation !== operation) {
    return { valid: false, reason: 'prompt_operation_mismatch', expectedOperation: prompt.operation };
  }

  return { valid: true };
}

export function listPrompts() {
  return PROMPTS;
}
