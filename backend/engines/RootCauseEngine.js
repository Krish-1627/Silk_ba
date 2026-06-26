/**
 * RootCauseEngine
 *
 * Type: M3 Milestone 1 Hybrid (deterministic baseline + bounded assisted path)
 * Purpose: Analyze evidence to identify root causes with evidence-linked outputs.
 *
 * Input: evidence[], opportunities[]
 * Output: rootCauses[], analysisQuality
 *
 * Guardrails:
 * - Deterministic fallback is preserved.
 * - LLM assistance is only available through the M1a control plane.
 * - Assisted causes must include valid evidence linkage.
 * - Method trace is emitted for deterministic vs assisted paths.
 * - No prioritization or completion ownership is introduced.
 */

import { Engine } from '../types/index.js';
import { WAVE3_FORMULAS } from '../contracts/index.js';

class RootCauseEngine extends Engine {
  constructor(options = {}) {
    super();
    this.assistedMinConfidence = options.assistedMinConfidence || 0.72;
  }

  /**
   * Analyze root causes from evidence
   * 
   * @param {Object} input
   * @param {Array} input.evidence - Evidence array
   * @param {Array} input.opportunities - Opportunities
   * 
   * @param {Object} context - Shared context
   * @param {Object} context.logger - For logging
   * 
   * @returns {Promise<Object>} Output matching spec
   * @returns {Array} output.rootCauses - Identified root causes
   * @returns {number} output.analysisQuality - Quality score
   */
  async execute(input, context) {
    this.validateInput(input);

    const deterministicRootCauses = this.identifyRootCauses(input.evidence, input.opportunities);

    const hybridEnabled = this.isHybridEnabled(context);
    if (!hybridEnabled) {
      const deterministicOutput = {
        rootCauses: deterministicRootCauses,
        analysisQuality: this.assessAnalysisQuality(deterministicRootCauses, input.evidence),
        analysisMethod: 'constraint_and_evidence_pattern_matching',
        methodTrace: {
          path: 'deterministic',
          assistedAttempted: false,
          fallbackActivated: false,
          controlPlaneOperation: null,
          evidenceLinked: deterministicRootCauses.every(cause => Array.isArray(cause.evidenceBasis))
        }
      };

      this.validateOutput(deterministicOutput);
      return deterministicOutput;
    }

    const controlPlane = context?.controlPlane;
    if (!controlPlane || typeof controlPlane.executeTask !== 'function') {
      throw new Error('RootCauseEngine: fail-closed, controlPlane.executeTask is required when hybrid mode is enabled');
    }

    const assistedResult = await controlPlane.executeTask({
      component: 'RootCauseEngine',
      operation: 'semantic_root_cause_assist',
      promptId: 'root_cause_assist_v1',
      payload: {
        evidence: input.evidence,
        opportunities: input.opportunities,
        deterministicRootCauses
      }
    });

    const assistedRootCauses = this.extractAssistedRootCauses(assistedResult?.response || {});
    const validatedAssisted = this.validateAssistedRootCauses(assistedRootCauses, input.evidence);

    if (validatedAssisted.length === 0) {
      const fallbackOutput = {
        rootCauses: deterministicRootCauses,
        analysisQuality: this.assessAnalysisQuality(deterministicRootCauses, input.evidence),
        analysisMethod: 'hybrid_fallback_to_deterministic',
        methodTrace: {
          path: 'hybrid_fallback',
          assistedAttempted: true,
          fallbackActivated: true,
          fallbackReason: 'assisted_root_causes_invalid_or_unlinked',
          controlPlaneOperation: 'RootCauseEngine.semantic_root_cause_assist',
          evidenceLinked: deterministicRootCauses.every(cause => Array.isArray(cause.evidenceBasis))
        }
      };

      this.validateOutput(fallbackOutput);
      return fallbackOutput;
    }

    const mergedRootCauses = this.mergeRootCauses(deterministicRootCauses, validatedAssisted);
    const analysisQuality = this.assessAnalysisQuality(mergedRootCauses, input.evidence);

    const output = {
      rootCauses: mergedRootCauses,
      analysisQuality,
      analysisMethod: 'hybrid_deterministic_plus_assisted',
      methodTrace: {
        path: 'hybrid_assisted',
        assistedAttempted: true,
        fallbackActivated: false,
        controlPlaneOperation: 'RootCauseEngine.semantic_root_cause_assist',
        evidenceLinked: mergedRootCauses.every(cause => Array.isArray(cause.evidenceBasis) && cause.evidenceBasis.length > 0)
      }
    };
    
    this.validateOutput(output);
    return output;
  }

  isHybridEnabled(context = {}) {
    const flags = context?.flags || context?.controlPlane?.flags;
    if (!flags || typeof flags.isEnabled !== 'function') {
      return false;
    }
    return Boolean(flags.isEnabled('phase2.rootCause.hybridEnabled'));
  }

  validateInput(input) {
    if (!Array.isArray(input.evidence)) {
      throw new Error('RootCauseEngine: evidence required (array)');
    }
    if (!Array.isArray(input.opportunities)) {
      throw new Error('RootCauseEngine: opportunities required (array)');
    }
    return true;
  }

  identifyRootCauses(evidence, opportunities) {
    const rootCauses = [];
    const seenCauses = new Set();
    let idCounter = 0;

    // Extract constraint-based root causes
    (evidence || [])
      .filter(e => e.category === 'constraint')
      .forEach(e => {
        if (!seenCauses.has(e.statement)) {
          rootCauses.push({
            causeId: `cause_${idCounter++}`,
            cause: e.statement,
            affectedOpportunities: [],
            evidenceBasis: [e.evidenceId],
            confidence: Math.min(1.0, (e.confidence || 0.8)),
            type: 'constraint'
          });
          seenCauses.add(e.statement);
        }
      });

    // Extract gap-based root causes
    const gaps = this.detectRootCauseGaps(evidence);
    gaps.forEach(gap => {
      if (!seenCauses.has(gap.cause)) {
        rootCauses.push({
          causeId: `cause_${idCounter++}`,
          cause: gap.cause,
          affectedOpportunities: [],
          evidenceBasis: gap.evidenceIds,
          confidence: gap.confidence,
          type: gap.type
        });
        seenCauses.add(gap.cause);
      }
    });

    return rootCauses;
  }

  detectRootCauseGaps(evidence) {
    // Return empty array to prevent deterministic hallucinations. 
    // Root causes should only be extracted from explicit evidence, 
    // not from the absence of evidence.
    return [];
  }

  extractAssistedRootCauses(response) {
    if (!response || typeof response !== 'object') {
      return [];
    }
    const assisted = response.assistedRootCauses || response.rootCauses || [];
    return Array.isArray(assisted) ? assisted : [];
  }

  validateAssistedRootCauses(assistedRootCauses, evidence) {
    const evidenceIds = new Set((evidence || []).map(item => item.evidenceId));

    return assistedRootCauses
      .filter(item => item && typeof item === 'object')
      .map((item, index) => {
        const evidenceBasis = Array.isArray(item.evidenceBasis)
          ? item.evidenceBasis.filter(id => evidenceIds.has(id))
          : [];

        return {
          causeId: `cause_assisted_${index}`,
          cause: String(item.cause || '').trim(),
          affectedOpportunities: Array.isArray(item.affectedOpportunities)
            ? [...item.affectedOpportunities]
            : [],
          evidenceBasis,
          confidence: this.clamp(typeof item.confidence === 'number' ? item.confidence : 0),
          type: item.type || 'assisted_semantic'
        };
      })
      .filter(item => item.cause.length > 0)
      .filter(item => item.confidence >= this.assistedMinConfidence)
      .filter(item => item.evidenceBasis.length > 0);
  }

  mergeRootCauses(deterministicRootCauses, validatedAssisted) {
    const merged = [...deterministicRootCauses];
    const seenCauses = new Set(deterministicRootCauses.map(item => item.cause.toLowerCase()));

    for (const assisted of validatedAssisted) {
      const causeKey = assisted.cause.toLowerCase();
      if (seenCauses.has(causeKey)) {
        continue;
      }
      merged.push(assisted);
      seenCauses.add(causeKey);
    }

    return merged;
  }

  assessAnalysisQuality(rootCauses, evidence) {
    const avgConfidence = rootCauses.length > 0
      ? rootCauses.reduce((sum, rc) => sum + rc.confidence, 0) / rootCauses.length
      : 0;

    const evidenceCoverage = Math.min(1.0, rootCauses.length / Math.max(1, (evidence || []).length / 2));
    return this.clamp((avgConfidence + evidenceCoverage) / 2);
  }

  clamp(value) {
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }

  validateOutput(output) {
    if (!Array.isArray(output.rootCauses)) {
      throw new Error('RootCauseEngine: rootCauses must be array');
    }
    if (typeof output.analysisQuality !== 'number' || output.analysisQuality < 0 || output.analysisQuality > 1) {
      throw new Error('RootCauseEngine: analysisQuality must be 0.0-1.0');
    }
    if (!output.methodTrace || typeof output.methodTrace !== 'object') {
      throw new Error('RootCauseEngine: methodTrace required');
    }

    output.rootCauses.forEach((rootCause, index) => {
      if (!Array.isArray(rootCause.evidenceBasis)) {
        throw new Error(`RootCauseEngine: rootCauses[${index}].evidenceBasis must be array`);
      }
      if (Object.prototype.hasOwnProperty.call(rootCause, 'priority')) {
        throw new Error(`RootCauseEngine: rootCauses[${index}] cannot include prioritization ownership fields`);
      }
      if (Object.prototype.hasOwnProperty.call(rootCause, 'completionDecision')) {
        throw new Error(`RootCauseEngine: rootCauses[${index}] cannot include completion ownership fields`);
      }
    });

    return true;
  }
}

export default RootCauseEngine;
