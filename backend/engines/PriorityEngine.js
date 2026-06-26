/**
 * PriorityEngine
 * 
 * Type: DETERMINISTIC
 * Purpose: Score opportunities by business value
 * 
 * Input: opportunity{}, impact, volume, timeSaved, riskReduction, strategicImportance
 * Output: businessValueScore (0-100), scoreBreakdown{}, priority
 * 
 * This is pure math: weighted scoring formula across components.
 * 
 * Phase: 1a (Skeleton - contracts only, no business logic)
 */

import { Engine } from '../types/index.js';

class PriorityEngine extends Engine {
  constructor() {
    super();
  }

  /**
   * Calculate business value score
   * 
   * @param {Object} input
   * @param {Object} input.opportunity - Opportunity to score
   * @param {string} input.impact - low|medium|high
   * @param {number} input.volume - Volume metric
   * @param {number} input.timeSaved - Hours/units saved
   * @param {number} input.riskReduction - 0.0-1.0
   * @param {string} input.strategicImportance - tactical|growth_enabling|risk_reduction
   * 
   * @param {Object} context - Shared context
   * @param {Object} context.logger - For logging
   * 
   * @returns {Promise<Object>} Output matching spec
   * @returns {number} output.businessValueScore (0-100)
   * @returns {Object} output.scoreBreakdown
   * @returns {string} output.priority
   */
  async execute(input, context) {
    this.validateInput(input);

    const output = this.calculateScore(input);

    this.validateOutput(output);
    return output;
  }

  validateInput(input) {
    if (!input.opportunity) {
      throw new Error('PriorityEngine: opportunity required');
    }
    if (typeof input.volume !== 'number') {
      throw new Error('PriorityEngine: volume required (number)');
    }
    if (typeof input.timeSaved !== 'number') {
      throw new Error('PriorityEngine: timeSaved required (number)');
    }
    if (typeof input.riskReduction !== 'number' || input.riskReduction < 0 || input.riskReduction > 1) {
      throw new Error('PriorityEngine: riskReduction must be 0.0-1.0');
    }
    return true;
  }

  validateOutput(output) {
    if (typeof output.businessValueScore !== 'number' || output.businessValueScore < 0 || output.businessValueScore > 100) {
      throw new Error('PriorityEngine: businessValueScore must be 0-100');
    }
    if (!['low', 'medium', 'high', 'critical'].includes(output.priority)) {
      throw new Error('PriorityEngine: invalid priority');
    }
    return true;
  }

  calculateScore(input) {
    const impact = this.mapImpactToScore(input.impact);
    const volume = this.mapVolumeToScore(input.volume);
    const timeSaved = this.mapTimeSavedToScore(input.timeSaved);
    const riskReduction = this.mapRiskReductionToScore(input.riskReduction);
    const strategicImportance = this.mapStrategicImportanceToScore(input.strategicImportance);
    const businessValueScore = impact + volume + timeSaved + riskReduction + strategicImportance;

    return {
      opportunity: input.opportunity?.opportunityId || '',
      businessValueScore,
      scoreBreakdown: {
        impact,
        volume,
        timeSaved,
        riskReduction,
        strategicImportance
      },
      priority: this.mapScoreToPriority(businessValueScore)
    };
  }

  mapImpactToScore(impact) {
    const normalized = String(impact || '').toLowerCase();
    return { low: 10, medium: 22, high: 35 }[normalized] ?? 0;
  }

  mapVolumeToScore(volume) {
    return Math.min(20, Math.round(Math.max(0, volume) / 67));
  }

  mapTimeSavedToScore(timeSaved) {
    return Math.min(20, Math.round(Math.max(0, timeSaved) * 1.05));
  }

  mapRiskReductionToScore(riskReduction) {
    return Math.round(Math.max(0, Math.min(1, riskReduction)) * 10);
  }

  mapStrategicImportanceToScore(strategicImportance) {
    const normalized = String(strategicImportance || '').toLowerCase();
    return { tactical: 2, growth_enabling: 5, risk_reduction: 10 }[normalized] ?? 0;
  }

  mapScoreToPriority(score) {
    if (score >= 90) return 'critical';
    if (score >= 70) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }
}

export default PriorityEngine;
