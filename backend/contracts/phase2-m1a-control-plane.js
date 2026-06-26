const PHASE2_CONTROL_PLANE_VERSION = 'm1a-1.0.0';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }
  return value;
}

const PHASE2_CONTROL_PLANE_CONTRACTS = deepFreeze({
  allowedOperations: {
    FactExtractionEngine: ['extract_facts'],
    RootCauseEngine: ['semantic_root_cause_assist'],
    ConversationLayer: ['realize_question_text']
  },
  forbiddenOperations: [
    'decide_opportunities',
    'decide_priorities',
    'decide_completion',
    'override_confidence',
    'write_final_system_state'
  ],
  requiredAuditFields: [
    'timestamp',
    'eventType',
    'component',
    'operation',
    'promptId',
    'decision'
  ],
  defaultFlags: [
    'phase2.disableAll',
    'phase2.llm.integration.enabled',
    'phase2.factExtraction.enabled',
    'phase2.extractionGate.enabled',
    'phase2.rootCause.hybridEnabled',
    'phase2.conversationLayer.enabled',
    'phase2.factExtraction.shadowMode',
    'phase2.extractionGate.shadowMode'
  ]
});

export { PHASE2_CONTROL_PLANE_VERSION, PHASE2_CONTROL_PLANE_CONTRACTS, deepFreeze };
