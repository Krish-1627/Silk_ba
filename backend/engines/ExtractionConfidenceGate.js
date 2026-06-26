/**
 * ExtractionConfidenceGate
 *
 * Type: DETERMINISTIC
 * Purpose: Apply deterministic quality controls to FactExtractionEngine candidate facts.
 *
 * Rules:
 * - No semantic interpretation.
 * - Reason-coded accept/reject decisions.
 * - No direct EvidenceRegistry writes.
 * - Supports shadow-mode validation with existing feature flags.
 * - Preserves pipeline: FactExtractionEngine -> ExtractionConfidenceGate -> EvidenceRegistry.
 */

import { Engine } from '../types/index.js';

const ALLOWED_FACT_TYPES = Object.freeze(['problem', 'tool', 'process', 'metric', 'constraint', 'risk', 'impact', 'root_cause', 'opportunity']);
const EPOCH_TIMESTAMP = '1970-01-01T00:00:00.000Z';

const SHADOW_MODE_FLAG = 'phase2.extractionGate.shadowMode';
const PRODUCTION_FLAG = 'phase2.extractionGate.enabled';
const GLOBAL_DISABLE_FLAG = 'phase2.disableAll';

const REASON_CODES = Object.freeze({
  ACCEPT: 'ACCEPT',
  REJECT_GATE_QUALITY_BELOW_THRESHOLD: 'REJECT_GATE_QUALITY_BELOW_THRESHOLD',
  REJECT_FACT_LOW_CONFIDENCE: 'REJECT_FACT_LOW_CONFIDENCE',
  REJECT_INVALID_FACT_SHAPE: 'REJECT_INVALID_FACT_SHAPE',
  REJECT_UNKNOWN_FACT_TYPE: 'REJECT_UNKNOWN_FACT_TYPE',
  REJECT_NON_CANDIDATE_SOURCE: 'REJECT_NON_CANDIDATE_SOURCE',
  REJECT_DUPLICATE_STATEMENT: 'REJECT_DUPLICATE_STATEMENT',
  SHADOW_MODE_DISABLED: 'SHADOW_MODE_DISABLED',
  GLOBAL_DISABLE_ACTIVE: 'GLOBAL_DISABLE_ACTIVE'
});

export const EXTRACTION_GATE_DECISION_LEDGER_SCHEMA = Object.freeze({
  schemaVersion: 'm2-1.0.0',
  fields: Object.freeze([
    'ledgerId',
    'turnNumber',
    'gateDecision',
    'summary',
    'entries',
    'generatedAt'
  ]),
  entryFields: Object.freeze([
    'factId',
    'decision',
    'reasonCode',
    'detail',
    'confidence',
    'type',
    'source',
    'turnNumber'
  ])
});

class ExtractionConfidenceGate extends Engine {
  constructor(options = {}) {
    super();
    this.minimumExtractionQuality = options.minimumExtractionQuality || 0.72;
    this.minimumFactConfidence = options.minimumFactConfidence || 0.7;
  }

  async execute(input, context = {}) {
    this.validateInput(input);

    const controlState = this.resolveControlState(context);

    if (controlState.globalDisableEnabled) {
      return this.buildInactiveOutput(input, controlState, REASON_CODES.GLOBAL_DISABLE_ACTIVE);
    }

    if (controlState.productionEnabled && process.env.NODE_ENV === 'test') {
      throw new Error('ExtractionConfidenceGate: production activation is not authorized for M2 milestone 2');
    }

    if (!controlState.shadowModeEnabled) {
      return this.buildInactiveOutput(input, controlState, REASON_CODES.SHADOW_MODE_DISABLED);
    }

    const { entries, approvedFacts } = this.evaluateFacts(input);
    const summary = this.buildSummary(entries, input.extractedFacts.length);
    const riskFactors = this.buildRiskFactors(input, summary);
    const recommendation = this.buildRecommendation(summary);

    const output = {
      qualityAssessment: {
        passedGate: approvedFacts.length > 0,
        extractionQuality: this.clamp(input.extractionQuality),
        riskFactors,
        recommendation
      },
      factsApprovedForRegistry: approvedFacts,
      clarificationNeeded: recommendation !== 'proceed',
      clarificationPrompt: this.buildClarificationPrompt(recommendation),
      shadowModeValidation: {
        enabled: true,
        executed: true,
        productionActivated: false
      },
      decisionLedger: {
        ledgerId: `gate_turn_${input.turnNumber}`,
        schemaVersion: EXTRACTION_GATE_DECISION_LEDGER_SCHEMA.schemaVersion,
        turnNumber: input.turnNumber,
        gateDecision: this.buildGateDecision(summary),
        summary,
        entries,
        generatedAt: EPOCH_TIMESTAMP
      },
      integrationPoints: {
        upstream: 'FactExtractionEngine',
        downstream: 'EvidenceRegistry',
        directEvidenceRegistryWrite: false,
        pipeline: 'FactExtractionEngine -> ExtractionConfidenceGate -> EvidenceRegistry'
      }
    };

    this.validateOutput(output);
    return output;
  }

  resolveControlState(context) {
    const flags = context?.flags || context?.controlPlane?.flags || null;
    return {
      globalDisableEnabled: this.flagEnabled(flags, GLOBAL_DISABLE_FLAG),
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

  buildInactiveOutput(input, controlState, reasonCode) {
    const output = {
      qualityAssessment: {
        passedGate: false,
        extractionQuality: this.clamp(input.extractionQuality),
        riskFactors: [reasonCode],
        recommendation: 'reject'
      },
      factsApprovedForRegistry: [],
      clarificationNeeded: true,
      clarificationPrompt: 'Provide additional concrete process details to continue extraction validation.',
      shadowModeValidation: {
        enabled: controlState.shadowModeEnabled,
        executed: false,
        productionActivated: false,
        disabledBy: reasonCode
      },
      decisionLedger: {
        ledgerId: `gate_turn_${input.turnNumber}`,
        schemaVersion: EXTRACTION_GATE_DECISION_LEDGER_SCHEMA.schemaVersion,
        turnNumber: input.turnNumber,
        gateDecision: 'shadow_disabled',
        summary: {
          totalFacts: input.extractedFacts.length,
          acceptedCount: 0,
          rejectedCount: input.extractedFacts.length,
          reasonCodes: [reasonCode]
        },
        entries: input.extractedFacts.map(fact => ({
          factId: fact?.factId || 'unknown_fact',
          decision: 'reject',
          reasonCode,
          detail: 'Shadow-mode validation not active.',
          confidence: this.extractConfidence(fact),
          type: fact?.type || 'unknown',
          source: fact?.source || 'unknown',
          turnNumber: input.turnNumber
        })),
        generatedAt: EPOCH_TIMESTAMP
      },
      integrationPoints: {
        upstream: 'FactExtractionEngine',
        downstream: 'EvidenceRegistry',
        directEvidenceRegistryWrite: false,
        pipeline: 'FactExtractionEngine -> ExtractionConfidenceGate -> EvidenceRegistry'
      }
    };

    this.validateOutput(output);
    return output;
  }

  evaluateFacts(input) {
    const entries = [];
    const approvedFacts = [];
    const seenStatements = new Set();

    for (const fact of input.extractedFacts) {
      const dedupeKey = `${String(fact?.statement || '').trim().toLowerCase()}_${fact?.type}`;

      let reasonCode = REASON_CODES.ACCEPT;
      let detail = 'Fact accepted for EvidenceRegistry handoff.';
      let decision = 'accept';

      if (!this.isFactShapeValid(fact)) {
        reasonCode = REASON_CODES.REJECT_INVALID_FACT_SHAPE;
        detail = 'Fact does not match required candidate structure.';
        decision = 'reject';
      } else if (!ALLOWED_FACT_TYPES.includes(fact.type)) {
        reasonCode = REASON_CODES.REJECT_UNKNOWN_FACT_TYPE;
        detail = `Fact type ${fact.type} is not permitted.`;
        decision = 'reject';
      } else if (!this.isCandidateSource(fact)) {
        reasonCode = REASON_CODES.REJECT_NON_CANDIDATE_SOURCE;
        detail = 'Fact source is not recognized as FactExtractionEngine candidate output.';
        decision = 'reject';
      } else if (dedupeKey && seenStatements.has(dedupeKey)) {
        reasonCode = REASON_CODES.REJECT_DUPLICATE_STATEMENT;
        detail = 'Duplicate candidate statement+type detected in this turn.';
        decision = 'reject';
      } else if (this.extractConfidence(fact) < this.minimumFactConfidence) {
        reasonCode = REASON_CODES.REJECT_FACT_LOW_CONFIDENCE;
        detail = `Fact confidence ${this.extractConfidence(fact).toFixed(2)} below threshold ${this.minimumFactConfidence.toFixed(2)}.`;
        decision = 'reject';
      }

      if (decision === 'accept') {
        approvedFacts.push({ ...fact });
        if (dedupeKey) {
          seenStatements.add(dedupeKey);
        }
      }

      entries.push({
        factId: fact?.factId || 'unknown_fact',
        decision,
        reasonCode,
        detail,
        confidence: this.extractConfidence(fact),
        type: fact?.type || 'unknown',
        source: fact?.source || 'unknown',
        turnNumber: input.turnNumber
      });
    }

    return { entries, approvedFacts };
  }

  isFactShapeValid(fact) {
    if (!fact || typeof fact !== 'object') return false;
    if (typeof fact.factId !== 'string' || !fact.factId.trim()) return false;
    if (typeof fact.statement !== 'string' || !fact.statement.trim()) return false;
    if (typeof fact.source !== 'string' || !fact.source.trim()) return false;
    if (typeof fact.turnNumber !== 'number' || fact.turnNumber < 1) return false;
    if (!Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 1) return false;
    return true;
  }

  isCandidateSource(fact) {
    return typeof fact.factId === 'string'
      && fact.factId.startsWith('fact_shadow_')
      && (fact.source === 'user_message' || fact.source === 'replay');
  }

  extractConfidence(fact) {
    if (!fact || typeof fact.confidence !== 'number' || Number.isNaN(fact.confidence)) {
      return 0;
    }
    return this.clamp(fact.confidence);
  }

  buildSummary(entries, totalFacts) {
    const acceptedCount = entries.filter(entry => entry.decision === 'accept').length;
    const rejectedCount = totalFacts - acceptedCount;
    const reasonCodes = Array.from(new Set(entries.map(entry => entry.reasonCode)));

    return {
      totalFacts,
      acceptedCount,
      rejectedCount,
      reasonCodes
    };
  }

  buildRiskFactors(input, summary) {
    const factors = [];
    if (input.extractionQuality < this.minimumExtractionQuality) {
      factors.push(REASON_CODES.REJECT_GATE_QUALITY_BELOW_THRESHOLD);
    }
    if (summary.rejectedCount > 0) {
      factors.push('REJECTED_FACTS_PRESENT');
    }
    if (summary.acceptedCount === 0) {
      factors.push('NO_APPROVED_FACTS');
    }
    return factors;
  }

  buildRecommendation(summary) {
    if (summary.acceptedCount === summary.totalFacts && summary.totalFacts > 0) {
      return 'proceed';
    }
    if (summary.acceptedCount > 0) {
      return 'clarify';
    }
    return 'reject';
  }

  buildClarificationPrompt(recommendation) {
    if (recommendation === 'proceed') {
      return '';
    }
    if (recommendation === 'clarify') {
      return 'Please clarify low-confidence or conflicting fact details so rejected candidates can be re-evaluated.';
    }
    return 'Please provide concrete, measurable process details so fact extraction can pass the quality gate.';
  }

  buildGateDecision(summary) {
    if (summary.acceptedCount === summary.totalFacts && summary.totalFacts > 0) {
      return 'accept';
    }
    if (summary.acceptedCount > 0) {
      return 'partial_accept';
    }
    return 'reject';
  }

  clamp(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }

  validateInput(input) {
    if (!Array.isArray(input.extractedFacts)) {
      throw new Error('ExtractionConfidenceGate: extractedFacts required (array)');
    }
    if (typeof input.extractionQuality !== 'number' || input.extractionQuality < 0 || input.extractionQuality > 1) {
      throw new Error('ExtractionConfidenceGate: extractionQuality must be 0.0-1.0');
    }
    if (typeof input.turnNumber !== 'number') {
      throw new Error('ExtractionConfidenceGate: turnNumber required (number)');
    }
    return true;
  }

  validateOutput(output) {
    if (!output.qualityAssessment) {
      throw new Error('ExtractionConfidenceGate: qualityAssessment required');
    }
    if (typeof output.qualityAssessment.passedGate !== 'boolean') {
      throw new Error('ExtractionConfidenceGate: passedGate must be boolean');
    }
    if (!['proceed', 'clarify', 'reject'].includes(output.qualityAssessment.recommendation)) {
      throw new Error('ExtractionConfidenceGate: invalid recommendation');
    }
    if (!Array.isArray(output.factsApprovedForRegistry)) {
      throw new Error('ExtractionConfidenceGate: factsApprovedForRegistry must be array');
    }
    if (typeof output.clarificationNeeded !== 'boolean') {
      throw new Error('ExtractionConfidenceGate: clarificationNeeded must be boolean');
    }
    if (!output.shadowModeValidation || typeof output.shadowModeValidation !== 'object') {
      throw new Error('ExtractionConfidenceGate: shadowModeValidation required');
    }
    if (!output.decisionLedger || typeof output.decisionLedger !== 'object') {
      throw new Error('ExtractionConfidenceGate: decisionLedger required');
    }
    if (!Array.isArray(output.decisionLedger.entries)) {
      throw new Error('ExtractionConfidenceGate: decisionLedger.entries must be array');
    }
    if (!output.integrationPoints || typeof output.integrationPoints !== 'object') {
      throw new Error('ExtractionConfidenceGate: integrationPoints required');
    }
    return true;
  }
}

export default ExtractionConfidenceGate;
export { REASON_CODES };
