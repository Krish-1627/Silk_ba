/**
 * ConfidenceCalculator
 * 
 * Type: HYBRID
 * Purpose: Calculate confidence scores for opportunities and organization understanding
 * 
 * Input: opportunities[], evidence[], featureVector[]
 * Output: opportunityConfidence{}, organizationUnderstanding{}, overallConfidence, rationale{}
 * 
 * Phase: 1b Wave 3 (deterministic formulas + heuristic source quality assessment)
 */

import { Engine } from '../types/index.js';
import { WAVE3_FORMULAS } from '../contracts/index.js';

class ConfidenceCalculator extends Engine {
  constructor() {
    super();
  }

  /**
   * Calculate confidence scores
   * 
   * @param {Object} input
   * @param {Array} input.opportunities - Opportunities
   * @param {Array} input.evidence - Evidence array
   * @param {Array} input.featureVector - Feature dimensions
   * 
   * @param {Object} context - Shared context
   * @param {Object} context.logger - For logging
   * 
   * @returns {Promise<Object>} Output matching spec
   * @returns {Object} output.opportunityConfidence - Confidence by opportunity
   * @returns {Object} output.organizationUnderstanding - Org confidence dimensions
   * @returns {number} output.overallConfidence - Overall score
   * @returns {Object} output.confidenceRationale - Rationale by dimension
   */
  async execute(input, context) {
    this.validateInput(input);

    const opportunityConfidence = this.calculateOpportunityConfidence(input.opportunities, input.evidence);
    const organizationUnderstanding = this.calculateOrganizationUnderstanding(input.evidence, input.featureVector);
    const overallConfidence = this.calculateOverallConfidence(opportunityConfidence, organizationUnderstanding);
    const confidenceRationale = this.buildRationale(opportunityConfidence, organizationUnderstanding);

    const output = {
      opportunityConfidence,
      organizationUnderstanding,
      overallConfidence,
      confidenceRationale
    };

    this.validateOutput(output);
    return output;
  }

  validateInput(input) {
    if (!Array.isArray(input.opportunities)) {
      throw new Error('ConfidenceCalculator: opportunities required (array)');
    }
    if (!Array.isArray(input.evidence)) {
      throw new Error('ConfidenceCalculator: evidence required (array)');
    }
    if (!Array.isArray(input.featureVector)) {
      throw new Error('ConfidenceCalculator: featureVector required (array)');
    }
    return true;
  }

  calculateOpportunityConfidence(opportunities, evidence) {
    const result = {};

    (opportunities || []).forEach(opp => {
      const oppId = opp.opportunityId || `opp_${opportunities.indexOf(opp)}`;
      let baseConfidence = this.viabilityToConfidence(opp.viability);
      const supportingEvidence = (opp.evidence || []).length;
      const sourceMultiplier = Math.min(1.15, 1.0 + (supportingEvidence * 0.01));
      const avgEvidenceConfidence = this.getAverageEvidenceConfidence(opp.evidence, evidence);
      const qualityFactor = avgEvidenceConfidence >= 0.8 ? 1.0 : 0.85;

      result[oppId] = this.clamp(baseConfidence * sourceMultiplier * qualityFactor);
    });

    return result;
  }

  calculateOrganizationUnderstanding(evidence, featureVector) {
    return {
      problem: this.clamp(featureVector[0] || 0.5),
      rootCause: this.clamp(featureVector[2] || 0.5),
      impact: this.clamp(featureVector[1] || 0.5),
      riskProfile: this.clamp(featureVector[5] || 0.5)
    };
  }

  calculateOverallConfidence(opportunityConfidence, organizationUnderstanding) {
    const oppScores = Object.values(opportunityConfidence);
    const orgScores = Object.values(organizationUnderstanding);

    const avgOppConfidence = oppScores.length > 0
      ? oppScores.reduce((sum, c) => sum + c, 0) / oppScores.length
      : 0.5;

    const avgOrgConfidence = orgScores.length > 0
      ? orgScores.reduce((sum, c) => sum + c, 0) / orgScores.length
      : 0.5;

    return this.clamp((avgOppConfidence * 0.6) + (avgOrgConfidence * 0.4));
  }

  buildRationale(opportunityConfidence, organizationUnderstanding) {
    const rationale = {};

    for (const [oppId, confidence] of Object.entries(opportunityConfidence)) {
      if (confidence >= 0.8) {
        rationale[oppId] = 'High confidence: multiple sources with strong quality';
      } else if (confidence >= 0.6) {
        rationale[oppId] = 'Medium confidence: adequate evidence but some gaps';
      } else {
        rationale[oppId] = 'Low confidence: limited evidence';
      }
    }

    return rationale;
  }

  viabilityToConfidence(viability) {
    const map = { high: 0.85, medium: 0.65, low: 0.4 };
    return map[viability] || 0.5;
  }

  getAverageEvidenceConfidence(evidenceIds, evidence) {
    const matchedEvidence = (evidence || [])
      .filter(e => (evidenceIds || []).includes(e.evidenceId));

    if (matchedEvidence.length === 0) return 0.7;

    const sum = matchedEvidence.reduce((total, e) => total + (e.confidence || 0.7), 0);
    return sum / matchedEvidence.length;
  }

  clamp(value) {
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }

  validateOutput(output) {
    if (typeof output.opportunityConfidence !== 'object') {
      throw new Error('ConfidenceCalculator: opportunityConfidence required (object)');
    }
    if (typeof output.organizationUnderstanding !== 'object') {
      throw new Error('ConfidenceCalculator: organizationUnderstanding required (object)');
    }
    if (typeof output.overallConfidence !== 'number' || output.overallConfidence < 0 || output.overallConfidence > 1) {
      throw new Error('ConfidenceCalculator: overallConfidence must be 0.0-1.0');
    }
    return true;
  }
}

export default ConfidenceCalculator;
