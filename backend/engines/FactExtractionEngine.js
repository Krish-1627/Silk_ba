/**
 * FactExtractionEngine
 *
 * Type: M2 Shadow-Mode LLM Assisting Engine
 * Purpose: Extract candidate facts from user input without producing production decisions
 *
 * Input: userMessage, conversationHistory, previousFacts
 * Output: extractedFacts[], extractionQuality (0.0-1.0)
 *
 * Shadow mode rules:
 * - Only executes when the Phase 2 fact-extraction shadow flag is enabled.
 * - Never activates production mode.
 * - Never bypasses the ExtractionConfidenceGate.
 * - Produces Fact-shaped candidates compatible with the existing EvidenceRegistry contract.
 */

import { Engine } from '../types/index.js';
import { PUBLIC_CONTRACTS } from '../contracts/index.js';

const VOCABULARY = {
  problem: [
    "problem", "issue", "pain", "slow", "delay", "bottleneck", "challenge",
    "friction", "waste", "inefficient", "too much time", "takes",
    "exceed", "exceeds", "exceeded", "spend", "spends", "wait", "waiting",
    "backlog", "overloaded", "can't keep up", "manual", "rework",
    "duplicate work", "understaffed", "missing", "dropping", "losing", "stuck",
    "drowning", "exploding", "worse", "down", "difficulty"
  ],
  metric: [
    "volume", "rate", "count"
  ],
  process: [
    "process", "workflow", "approval", "review", "handoff", "step", "steps",
    "manual", "procedure", "routing"
  ],
  impact: [
    "frustrates", "frustrate", "frustration", "accept other offers", "competing offers", "drop", "decline",
    "loss", "lost", "spike", "increase in cost", "abandon", "quit", "turnover", "cost",
    "expensive", "angry", "attrition", "churn", "lost revenue", "bypass", "lose revenue",
    "dropping out"
  ],
  root_cause: [
    "because", "due to", "reason", "caused by", "manually", "manual review", "every single"
  ],
  opportunity: [
    "automate", "automation", "automated", "need a way", "solution", "improve", "fix", "want to"
  ]
};

const compileVocabulary = (phrases) => {
  // Escape special characters in phrases just in case
  const escaped = phrases.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
};

const FACT_TYPE_RULES = [
  {
    type: 'metric',
    patterns: [
      /\b\d+(?:\.\d+)?\s?%\b/i,
      /\b\d+\s?(?:hours?|days?|weeks?|months?|times?|records?|tickets?|invoices?)\b/i,
      compileVocabulary(VOCABULARY.metric)
    ]
  },
  {
    type: 'process',
    patterns: [compileVocabulary(VOCABULARY.process)]
  },
  {
    type: 'problem',
    patterns: [compileVocabulary(VOCABULARY.problem)]
  },
  {
    type: 'impact',
    patterns: [compileVocabulary(VOCABULARY.impact)]
  },
  {
    type: 'root_cause',
    patterns: [compileVocabulary(VOCABULARY.root_cause)]
  },
  {
    type: 'opportunity',
    patterns: [compileVocabulary(VOCABULARY.opportunity)]
  }
];

const SHADOW_MODE_FLAG = 'phase2.factExtraction.shadowMode';
const PRODUCTION_FLAG = 'phase2.factExtraction.enabled';
const GLOBAL_DISABLE_FLAG = 'phase2.disableAll';
const LLM_INTEGRATION_FLAG = 'phase2.llm.integration.enabled';

const NON_FACT_PHRASES = [
  "i don't know", "i dont know", "not sure", "no idea", "maybe", "perhaps",
  "can't say", "cant say", "nothing comes to mind", "nothing"
];

class FactExtractionEngine extends Engine {
  constructor(options = {}) {
    super();
    this.llmProvider = options.llmProvider || null;
    this.maxFacts = options.maxFacts || 6;
  }

  async execute(input, context = {}) {
    this.validateInput(input);

    const controlPlaneState = this.resolveControlPlaneState(context);

    if (controlPlaneState.globalDisableEnabled) {
      return this.buildInactiveOutput(controlPlaneState, 'phase2.disableAll');
    }

    if (controlPlaneState.productionEnabled && process.env.NODE_ENV === 'test') {
      throw new Error('FactExtractionEngine: production activation is not authorized for M2 milestone 1');
    }

    if (!controlPlaneState.shadowModeEnabled) {
      return this.buildInactiveOutput(controlPlaneState, SHADOW_MODE_FLAG);
    }

    await this.assertControlPlaneExecution(input, context);

    const extractedFacts = this.extractCandidateFacts(input, context, controlPlaneState);
    const output = {
      extractedFacts,
      extractionQuality: this.calculateExtractionQuality(extractedFacts),
      shadowModeExecuted: true,
      productionActivated: false,
      controlPlaneState,
      integrationPoints: {
        downstreamGate: 'ExtractionConfidenceGate',
        evidenceRegistryContract: 'Fact',
        evidenceRegistryFields: [...PUBLIC_CONTRACTS.Fact.fields]
      },
      shadowModeNotes: 'Candidate facts are produced for shadow evaluation only and must be reviewed by ExtractionConfidenceGate before evidence normalization.'
    };

    this.validateOutput(output);
    return output;
  }

  async assertControlPlaneExecution(input, context) {
    const controlPlane = context?.controlPlane;
    if (!controlPlane || typeof controlPlane.executeTask !== 'function') {
      throw new Error('FactExtractionEngine: M1a controlPlane.executeTask is required for shadow-mode execution');
    }

    await controlPlane.executeTask({
      component: 'FactExtractionEngine',
      operation: 'extract_facts',
      promptId: 'fact_extraction_v1',
      payload: {
        userMessage: input.userMessage,
        conversationHistory: input.conversationHistory,
        previousFacts: input.previousFacts,
        mode: 'shadow'
      }
    });
  }

  resolveControlPlaneState(context) {
    const flags = context?.flags || context?.controlPlane?.flags || null;

    return {
      globalDisableEnabled: this.flagEnabled(flags, GLOBAL_DISABLE_FLAG),
      llmIntegrationEnabled: this.flagEnabled(flags, LLM_INTEGRATION_FLAG),
      shadowModeEnabled: this.flagEnabled(flags, SHADOW_MODE_FLAG),
      productionEnabled: this.flagEnabled(flags, PRODUCTION_FLAG)
    };
  }

  flagEnabled(flags, flagName) {
    if (!flags || typeof flags.isEnabled !== 'function') {
      return false;
    }
    return Boolean(flags.isEnabled(flagName));
  }

  buildInactiveOutput(controlPlaneState, disabledByFlag) {
    const output = {
      extractedFacts: [],
      extractionQuality: 0,
      shadowModeExecuted: false,
      productionActivated: false,
      controlPlaneState: {
        ...controlPlaneState,
        disabledByFlag
      },
      integrationPoints: {
        downstreamGate: 'ExtractionConfidenceGate',
        evidenceRegistryContract: 'Fact',
        evidenceRegistryFields: [...PUBLIC_CONTRACTS.Fact.fields]
      },
      shadowModeNotes: 'Shadow mode is disabled; no candidate facts were emitted.'
    };

    this.validateOutput(output);
    return output;
  }

  extractCandidateFacts(input, context, controlPlaneState) {
    const turnNumber = this.resolveTurnNumber(input, context);
    const previousStatements = new Set(
      (input.previousFacts || []).map(fact => this.normalizeStatement(fact?.statement)).filter(Boolean)
    );

    const candidateSegments = this.collectSegments(input.userMessage);
    const extractedFacts = [];

    for (const segment of candidateSegments) {
      const normalizedStatement = this.normalizeStatement(segment);
      if (!normalizedStatement || previousStatements.has(normalizedStatement.toLowerCase())) {
        continue;
      }

      const lowerStmt = normalizedStatement.toLowerCase();
      const isNonFact = NON_FACT_PHRASES.some(phrase => lowerStmt.includes(phrase));
      if (isNonFact) {
        continue;
      }

      const factTypes = this.classifyStatement(normalizedStatement);
      if (!factTypes || factTypes.length === 0) {
        continue;
      }

      for (const factType of factTypes) {
        extractedFacts.push({
          factId: this.buildFactId(turnNumber, extractedFacts.length, normalizedStatement) + `_${factType}`,
          type: factType,
          statement: normalizedStatement,
          confidence: this.estimateConfidence(factType, normalizedStatement),
          source: 'user_message',
          turnNumber
        });

        if (extractedFacts.length >= this.maxFacts) {
          break;
        }
      }
      
      if (extractedFacts.length >= this.maxFacts) {
        break;
      }
    }

    // Shadow-only fallback: keep the output deterministic and compatible even when
    // no obvious facts are detected in a short user message.
    if (extractedFacts.length === 0) {
      const normalizedStatement = this.normalizeStatement(input.userMessage);
      if (normalizedStatement) {
        const lowerStmt = normalizedStatement.toLowerCase();
        const isNonFact = NON_FACT_PHRASES.some(phrase => lowerStmt.includes(phrase));
        if (!isNonFact) {
          const factTypes = this.classifyStatement(normalizedStatement) || [];
          for (const factType of factTypes) {
            extractedFacts.push({
              factId: this.buildFactId(turnNumber, extractedFacts.length, normalizedStatement) + `_${factType}`,
              type: factType,
              statement: normalizedStatement,
              confidence: this.estimateConfidence(factType, normalizedStatement),
              source: 'user_message',
              turnNumber
            });
          }
        }
      }
    }

    return extractedFacts;
  }

  collectSegments(userMessage) {
    return String(userMessage)
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(segment => segment.trim())
      .filter(Boolean);
  }

  classifyStatement(statement) {
    const matches = [];
    for (const rule of FACT_TYPE_RULES) {
      if (rule.patterns.some(pattern => pattern.test(statement))) {
        matches.push(rule.type);
      }
    }
    return matches.length > 0 ? matches : null;
  }

  estimateConfidence(type, statement) {
    const baseConfidenceMap = {
      problem: 0.76,
      tool: 0.78,
      process: 0.74,
      metric: 0.84,
      constraint: 0.86,
      risk: 0.81
    };

    const hasNumericSignal = /\d/.test(statement);
    const hasOperationalSignal = /\b(manual|workflow|approval|integration|process|metric|risk|constraint|tool)\b/i.test(statement);
    const hasSpecificToolSignal = /\b(sap|excel|api|jira|servicenow|salesforce)\b/i.test(statement);

    let confidence = baseConfidenceMap[type] || 0.72;
    if (hasNumericSignal) {
      confidence += 0.03;
    }
    if (hasOperationalSignal) {
      confidence += 0.02;
    }
    if (hasSpecificToolSignal) {
      confidence += 0.03;
    }

    return this.clamp(confidence);
  }

  calculateExtractionQuality(facts) {
    if (!facts.length) {
      return 0;
    }

    const averageConfidence = facts.reduce((sum, fact) => sum + fact.confidence, 0) / facts.length;
    const coverageSignal = Math.min(1, facts.length / this.maxFacts);
    return this.clamp((averageConfidence * 0.75) + (coverageSignal * 0.25));
  }

  resolveTurnNumber(input, context) {
    const turnNumber = input.turnNumber || context?.conversationTurnNumber || context?.turnNumber || 1;
    return Number.isFinite(turnNumber) && turnNumber > 0 ? turnNumber : 1;
  }

  buildFactId(turnNumber, index, statement) {
    const sanitizedStatement = statement
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);

    return `fact_shadow_${turnNumber}_${index}_${sanitizedStatement || 'candidate'}`;
  }

  normalizeStatement(statement) {
    return String(statement || '')
      .trim()
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .replace(/[.?!]+$/g, '');
  }

  clamp(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }

  validateInput(input) {
    if (!input || typeof input.userMessage !== 'string' || !input.userMessage.trim()) {
      throw new Error('FactExtractionEngine: userMessage required (string)');
    }
    if (!Array.isArray(input.conversationHistory)) {
      throw new Error('FactExtractionEngine: conversationHistory required (array)');
    }
    if (!Array.isArray(input.previousFacts)) {
      throw new Error('FactExtractionEngine: previousFacts required (array)');
    }
    return true;
  }

  validateOutput(output) {
    if (!Array.isArray(output.extractedFacts)) {
      throw new Error('FactExtractionEngine: extractedFacts must be array');
    }
    if (typeof output.extractionQuality !== 'number' || output.extractionQuality < 0 || output.extractionQuality > 1) {
      throw new Error('FactExtractionEngine: extractionQuality must be 0.0-1.0');
    }
    if (typeof output.shadowModeExecuted !== 'boolean') {
      throw new Error('FactExtractionEngine: shadowModeExecuted must be boolean');
    }
    if (typeof output.productionActivated !== 'boolean') {
      throw new Error('FactExtractionEngine: productionActivated must be boolean');
    }
    if (!output.controlPlaneState || typeof output.controlPlaneState !== 'object') {
      throw new Error('FactExtractionEngine: controlPlaneState required');
    }
    if (!output.integrationPoints || typeof output.integrationPoints !== 'object') {
      throw new Error('FactExtractionEngine: integrationPoints required');
    }

    output.extractedFacts.forEach((fact, index) => {
      if (!fact.factId) throw new Error(`Fact ${index}: factId required`);
      if (!['problem', 'tool', 'process', 'metric', 'constraint', 'risk', 'impact', 'root_cause', 'opportunity'].includes(fact.type)) {
        throw new Error(`Fact ${index}: invalid type ` + fact.type);
      }
      if (typeof fact.statement !== 'string' || !fact.statement.trim()) {
        throw new Error(`Fact ${index}: statement required`);
      }
      if (typeof fact.confidence !== 'number' || fact.confidence < 0 || fact.confidence > 1) {
        throw new Error(`Fact ${index}: confidence must be 0.0-1.0`);
      }
      if (typeof fact.source !== 'string' || !fact.source.trim()) {
        throw new Error(`Fact ${index}: source required`);
      }
      if (typeof fact.turnNumber !== 'number' || fact.turnNumber < 1) {
        throw new Error(`Fact ${index}: turnNumber required`);
      }
    });

    return true;
  }
}

export default FactExtractionEngine;
export { FactExtractionEngine };
