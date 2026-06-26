/**
 * SaturationEngine
 * 
 * Type: DETERMINISTIC
 * Purpose: Measure how complete our understanding is
 * 
 * Input: featureVector[], opportunities[], evidence[], turnCount
 * Output: saturation{}, overallSaturation, readiness{}, gaps[]
 * 
 * This is pure math: compare feature vector against target thresholds.
 * 
 * Phase: 1a (Skeleton - contracts only, no business logic)
 */

import { Engine } from '../types/index.js';
import { WAVE2_FORMULAS } from '../contracts/index.js';

class SaturationEngine extends Engine {
  constructor() {
    super();
  }

  /**
   * Calculate saturation (completeness of understanding)
   * 
   * @param {Object} input
   * @param {Array} input.featureVector - Feature dimensions
   * @param {Array} input.opportunities - Opportunities identified
   * @param {Array} input.evidence - Evidence set
   * @param {number} input.turnCount - Current conversation turn
   * 
   * @param {Object} context - Shared context
   * @param {Object} context.logger - For logging
   * 
   * @returns {Promise<Object>} Output matching spec
   * @returns {Object} output.saturation - Saturation by dimension
   * @returns {number} output.overallSaturation
   * @returns {Object} output.readiness
   * @returns {Array} output.gaps
   */
  async execute(input, context) {
    this.validateInput(input);
    const evidenceCoverageScore = this.calculateEvidenceCoverageScore(input.evidence);
    const metricEvidenceScore = this.calculateCategoryScore(input.evidence, 'metric');
    const constraintDepthScore = this.calculateCategoryScore(input.evidence, 'constraint');
    const opportunityCoverageScore = this.calculateOpportunityCoverageScore(input.opportunities);
    const evidenceVolumeScore = this.calculateEvidenceVolumeScore(input.evidence);

    const output = {
      saturation: {
        problemUnderstanding: this.average([this.getFeature(input.featureVector, 0), evidenceCoverageScore]),
        impactQuantification: this.average([this.getFeature(input.featureVector, 1), metricEvidenceScore]),
        rootCauseDepth: this.average([this.getFeature(input.featureVector, 2), constraintDepthScore]),
        processDocumentation: this.getFeature(input.featureVector, 3),
        toolStackClarity: this.getFeature(input.featureVector, 4),
        opportunityDepth: this.average([this.getFeature(input.featureVector, 6), opportunityCoverageScore]),
        userPainQuantification: this.getFeature(input.featureVector, 7),
        evidenceCompleteness: this.average([evidenceCoverageScore, evidenceVolumeScore])
      },
      overallSaturation: 0.0,
      readiness: {
        forRecommendation: false,
        rationale: ''
      },
      gaps: []
    };

    output.overallSaturation = this.average([
      output.saturation.problemUnderstanding,
      output.saturation.impactQuantification,
      output.saturation.rootCauseDepth,
      output.saturation.opportunityDepth,
      output.saturation.evidenceCompleteness
    ]);

    output.gaps = this.buildGaps(output.saturation);
    output.readiness = {
      forRecommendation: output.gaps.length === 0,
      rationale: output.gaps.length === 0
        ? 'All saturation dimensions meet threshold.'
        : `Missing readiness on: ${output.gaps.map(gap => gap.dimension).join(', ')}`
    };
    
    this.validateOutput(output);
    return output;
  }

  validateInput(input) {
    if (!Array.isArray(input.featureVector)) {
      throw new Error('SaturationEngine: featureVector required (array)');
    }
    if (input.featureVector.length !== 8) {
      throw new Error('SaturationEngine: featureVector must have 8 dimensions');
    }
    if (!Array.isArray(input.opportunities)) {
      throw new Error('SaturationEngine: opportunities required (array)');
    }
    if (!Array.isArray(input.evidence)) {
      throw new Error('SaturationEngine: evidence required (array)');
    }
    if (typeof input.turnCount !== 'number') {
      throw new Error('SaturationEngine: turnCount required (number)');
    }
    return true;
  }

  getFeature(featureVector, index) {
    const value = featureVector[index];
    return typeof value === 'number' && Number.isFinite(value) ? this.clamp(value) : 0;
  }

  calculateEvidenceCoverageScore(evidence) {
    const categories = new Set((evidence || []).map(item => item.category));
    return this.clamp(categories.size / 4);
  }

  calculateCategoryScore(evidence, category) {
    const count = (evidence || []).filter(item => item.category === category).length;
    return this.clamp(count / 3);
  }

  calculateOpportunityCoverageScore(opportunities) {
    return this.clamp((opportunities || []).length / 3);
  }

  calculateEvidenceVolumeScore(evidence) {
    return this.clamp((evidence || []).length / 10);
  }

  average(values) {
    if (!values.length) return 0;
    return this.clamp(values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  clamp(value) {
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }

  buildGaps(saturation) {
    const thresholds = WAVE2_FORMULAS.SaturationEngine.thresholds;
    const thresholdByDimension = {
      problemUnderstanding: thresholds.problemUnderstanding || 0.8,
      impactQuantification: thresholds.impactQuantification || 0.8,
      rootCauseDepth: thresholds.rootCauseDepth || 0.8,
      processDocumentation: thresholds.processDocumentation || 0.8,
      toolStackClarity: thresholds.toolStackClarity || 0.8,
      opportunityDepth: thresholds.opportunityDepth || 0.8,
      userPainQuantification: thresholds.userPainQuantification || 0.8,
      evidenceCompleteness: thresholds.evidenceCompleteness || 0.8
    };
    const gapEntries = [
      ['problemUnderstanding', saturation.problemUnderstanding],
      ['impactQuantification', saturation.impactQuantification],
      ['rootCauseDepth', saturation.rootCauseDepth],
      ['processDocumentation', saturation.processDocumentation],
      ['toolStackClarity', saturation.toolStackClarity],
      ['opportunityDepth', saturation.opportunityDepth],
      ['userPainQuantification', saturation.userPainQuantification],
      ['evidenceCompleteness', saturation.evidenceCompleteness]
    ];

    return gapEntries
      .filter(([dimension, value]) => value < thresholdByDimension[dimension])
      .map(([dimension, value]) => ({
        dimension,
        currentScore: value,
        minimumRequired: thresholdByDimension[dimension],
        deficit: this.clamp(thresholdByDimension[dimension] - value)
      }));
  }

  validateOutput(output) {
    if (typeof output.overallSaturation !== 'number' || output.overallSaturation < 0 || output.overallSaturation > 1) {
      throw new Error('SaturationEngine: overallSaturation must be 0.0-1.0');
    }
    if (!output.readiness) {
      throw new Error('SaturationEngine: readiness required');
    }
    if (!Array.isArray(output.gaps)) {
      throw new Error('SaturationEngine: gaps must be array');
    }
    output.gaps.forEach((gap, index) => {
      if (!gap.dimension) {
        throw new Error(`SaturationEngine: gap ${index} dimension required`);
      }
      if (typeof gap.currentScore !== 'number' || gap.currentScore < 0 || gap.currentScore > 1) {
        throw new Error(`SaturationEngine: gap ${index} currentScore must be 0.0-1.0`);
      }
      if (typeof gap.minimumRequired !== 'number' || gap.minimumRequired < 0 || gap.minimumRequired > 1) {
        throw new Error(`SaturationEngine: gap ${index} minimumRequired must be 0.0-1.0`);
      }
      if (typeof gap.deficit !== 'number' || gap.deficit < 0 || gap.deficit > 1) {
        throw new Error(`SaturationEngine: gap ${index} deficit must be 0.0-1.0`);
      }
    });
    return true;
  }
}

export default SaturationEngine;
