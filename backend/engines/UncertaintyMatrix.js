/**
 * UncertaintyMatrix
 * 
 * Type: DETERMINISTIC
 * Purpose: Map uncertainties and identify highest-impact evidence gaps
 * 
 * Input: featureVector[], saturation{}, opportunities[]
 * Output: uncertaintyMap{}, highestImpactQuestion{}
 * 
 * This is pure math: calculate gaps and prioritize by impact.
 * 
 * Phase: 1a (Skeleton - contracts only, no business logic)
 */

import { Engine } from '../types/index.js';
import { WAVE2_FORMULAS } from '../contracts/index.js';

class UncertaintyMatrix extends Engine {
  constructor() {
    super();
  }

  /**
   * Build uncertainty map and identify next question
   * 
   * @param {Object} input
   * @param {Array} input.featureVector - Feature dimensions
   * @param {Object} input.saturation - Saturation output
   * @param {Array} input.opportunities - Opportunities identified
   * 
   * @param {Object} context - Shared context
   * @param {Object} context.logger - For logging
   * 
   * @returns {Promise<Object>} Output matching spec
   * @returns {Object} output.uncertaintyMap
   * @returns {Object} output.highestImpactQuestion
   */
  async execute(input, context) {
    this.validateInput(input);

    const uncertaintyMap = this.buildUncertaintyMap(input);
    const highestImpactQuestion = this.selectHighestImpactQuestion(uncertaintyMap);

    const output = {
      uncertaintyMap,
      highestImpactQuestion
    };
    
    this.validateOutput(output);
    return output;
  }

  validateInput(input) {
    if (!Array.isArray(input.featureVector)) {
      throw new Error('UncertaintyMatrix: featureVector required (array)');
    }
    if (input.featureVector.length !== 8) {
      throw new Error('UncertaintyMatrix: featureVector must have 8 dimensions');
    }
    if (!input.saturation) {
      throw new Error('UncertaintyMatrix: saturation required');
    }
    if (!Array.isArray(input.opportunities)) {
      throw new Error('UncertaintyMatrix: opportunities required (array)');
    }
    return true;
  }

  buildUncertaintyMap(input) {
    const saturationOutput = input.saturation || {};
    const saturation = saturationOutput.saturation || {};
    const evidenceGapMap = WAVE2_FORMULAS.UncertaintyMatrix.evidenceGapMap;
    const opportunityRelevance = this.calculateOpportunityRelevance(input.opportunities);

    const entries = {
      problemUnderstanding: this.buildDimensionEntry('problemUnderstanding', saturation.problemUnderstanding, evidenceGapMap.problemUnderstanding, opportunityRelevance.problemUnderstanding),
      impactQuantification: this.buildDimensionEntry('impactQuantification', saturation.impactQuantification, evidenceGapMap.impactQuantification, opportunityRelevance.impactQuantification),
      rootCauseDepth: this.buildDimensionEntry('rootCauseDepth', saturation.rootCauseDepth, evidenceGapMap.rootCauseDepth, opportunityRelevance.rootCauseDepth),
      processDocumentation: this.buildDimensionEntry('processDocumentation', saturation.processDocumentation, evidenceGapMap.processDocumentation || ['process_definition', 'workflow_step', 'manual_effort'], opportunityRelevance.processDocumentation),
      toolStackClarity: this.buildDimensionEntry('toolStackClarity', saturation.toolStackClarity, evidenceGapMap.toolStackClarity || ['software_tool', 'integration_gap', 'manual_workaround'], opportunityRelevance.toolStackClarity),
      opportunityDepth: this.buildDimensionEntry('opportunityDepth', saturation.opportunityDepth, evidenceGapMap.opportunityDepth, opportunityRelevance.opportunityDepth),
      userPainQuantification: this.buildDimensionEntry('userPainQuantification', saturation.userPainQuantification, evidenceGapMap.userPainQuantification || ['frustration_signal', 'team_burnout', 'retention_risk'], opportunityRelevance.userPainQuantification),
      evidenceCompleteness: this.buildDimensionEntry('evidenceCompleteness', saturation.evidenceCompleteness, evidenceGapMap.evidenceCompleteness, opportunityRelevance.evidenceCompleteness)
    };

    return entries;
  }

  buildDimensionEntry(dimension, saturationValue, evidenceNeeded, opportunityRelevance) {
    const currentValue = this.clampValue(saturationValue);
    const currentUncertainty = this.clampValue(1 - currentValue);
    const impactIfResolved = this.clampValue((currentUncertainty * 0.5) + (opportunityRelevance * 0.5));
    return {
      currentUncertainty,
      evidence_needed: [...evidenceNeeded],
      impact_if_resolved: impactIfResolved,
      priority: this.calculatePriority(currentUncertainty, impactIfResolved)
    };
  }

  calculateOpportunityRelevance(opportunities) {
    const opportunityCount = Array.isArray(opportunities) ? opportunities.length : 0;
    const relevance = this.clampValue(opportunityCount / 3);
    return {
      problemUnderstanding: relevance,
      impactQuantification: relevance,
      rootCauseDepth: relevance,
      processDocumentation: relevance,
      toolStackClarity: relevance,
      opportunityDepth: relevance,
      userPainQuantification: relevance,
      evidenceCompleteness: relevance
    };
  }

  calculatePriority(currentUncertainty, impactIfResolved) {
    const score = currentUncertainty * impactIfResolved;
    if (score >= 0.45) return 'critical';
    if (score >= 0.3) return 'high';
    if (score >= 0.15) return 'medium';
    return 'low';
  }

  selectHighestImpactQuestion(uncertaintyMap) {
    const sorted = Object.entries(uncertaintyMap)
      .map(([dimension, value]) => ({
        dimension,
        score: value.currentUncertainty * value.impact_if_resolved,
        value
      }))
      .sort((left, right) => right.score - left.score || left.dimension.localeCompare(right.dimension));

    const top = sorted[0] || {
      dimension: 'problemUnderstanding',
      value: { evidence_needed: [], impact_if_resolved: 0, currentUncertainty: 0 }
    };

    return {
      objective: this.buildObjective(top.dimension),
      evidenceGap: top.value.evidence_needed[0] || '',
      expectedUncertaintyReduction: top.value.impact_if_resolved
    };
  }

  buildObjective(dimension) {
    const objectives = {
      problemUnderstanding: 'Clarify the core problem statement',
      impactQuantification: 'Quantify the operational and business impact',
      rootCauseDepth: 'Confirm the underlying root cause',
      processDocumentation: 'Clarify the manual processes and workflows',
      toolStackClarity: 'Map the software systems and tools',
      opportunityDepth: 'Validate the opportunity scope',
      userPainQuantification: 'Quantify the human impact and pain points',
      evidenceCompleteness: 'Close the remaining evidence gaps'
    };
    return objectives[dimension] || objectives.problemUnderstanding;
  }

  clampValue(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }

  validateOutput(output) {
    if (!output.uncertaintyMap || typeof output.uncertaintyMap !== 'object') {
      throw new Error('UncertaintyMatrix: uncertaintyMap required (object)');
    }
    if (!output.highestImpactQuestion) {
      throw new Error('UncertaintyMatrix: highestImpactQuestion required');
    }
    if (!output.uncertaintyMap || typeof output.uncertaintyMap !== 'object') {
      throw new Error('UncertaintyMatrix: uncertaintyMap required (object)');
    }
    if (typeof output.highestImpactQuestion.objective !== 'string') {
      throw new Error('UncertaintyMatrix: highestImpactQuestion.objective required (string)');
    }
    if (typeof output.highestImpactQuestion.evidenceGap !== 'string') {
      throw new Error('UncertaintyMatrix: highestImpactQuestion.evidenceGap required (string)');
    }
    if (typeof output.highestImpactQuestion.expectedUncertaintyReduction !== 'number' || output.highestImpactQuestion.expectedUncertaintyReduction < 0 || output.highestImpactQuestion.expectedUncertaintyReduction > 1) {
      throw new Error('UncertaintyMatrix: highestImpactQuestion.expectedUncertaintyReduction must be 0.0-1.0');
    }
    return true;
  }
}

export default UncertaintyMatrix;
