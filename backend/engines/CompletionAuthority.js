/**
 * CompletionAuthority
 * 
 * Type: DETERMINISTIC
 * Purpose: Single authority for completion decision
 * 
 * Input: saturation{}, confidence{}, turnCount, evidenceCount
 * Output: completed (boolean), rationale, completionCriteria{}, estimatedTurnsRemaining
 * 
 * This is pure logic: threshold evaluation (AND gates on 3 conditions).
 * THIS IS THE SINGLE SOURCE OF TRUTH FOR COMPLETION.
 * No other place in the system decides completion.
 * 
 * Phase: 1a (Skeleton - contracts only, no business logic)
 */

import { Engine } from '../types/index.js';

class CompletionAuthority extends Engine {
  constructor(options = {}) {
    super();
    this.saturationThreshold = options.saturationThreshold || 0.80;
    this.confidenceThreshold = options.confidenceThreshold || 0.60;
    this.evidenceMinimum = options.evidenceMinimum || 10;
  }

  /**
   * Determine if interview is complete
   * 
   * @param {Object} input
   * @param {Object} input.saturation - Saturation output
   * @param {Object} input.confidence - Confidence output
   * @param {number} input.turnCount - Current turn number
   * @param {number} input.evidenceCount - Total evidence count
   * 
   * @param {Object} context - Shared context
   * @param {Object} context.logger - For logging
   * 
   * @returns {Promise<Object>} Output matching spec
   * @returns {boolean} output.completed
   * @returns {string} output.rationale
   * @returns {Object} output.completionCriteria
   * @returns {number} output.estimatedTurnsRemaining
   */
  async execute(input, context) {
    this.validateInput(input);

    const saturationCurrent = input.saturation?.overallSaturation || 0;
    const confidenceCurrent = input.confidence?.overallConfidence || 0;
    const evidenceCurrent = input.evidenceCount || 0;
    const turnCount = input.turnCount || 0;
    
    const trailingSaturation = input.trailingSaturation || [];
    const recentEvidenceCounts = input.recentEvidenceCounts || [];

    const saturationMet = saturationCurrent >= this.saturationThreshold;
    const confidenceMet = confidenceCurrent >= this.confidenceThreshold;
    const evidenceMet = evidenceCurrent >= this.evidenceMinimum;
    
    let completed = false;
    let exitTrigger = null;

    // 1. Standard Completion
    if (saturationMet && confidenceMet && evidenceMet && turnCount >= 6) {
      completed = true;
      exitTrigger = 'standard';
    }

    // 2. Early Exit Override
    if (!completed && saturationCurrent >= 0.85 && confidenceMet && turnCount >= 6) {
      completed = true;
      exitTrigger = 'early_exit_override';
    }

    // 3. Hard Turn Limit
    if (!completed && turnCount >= 20) {
      completed = true;
      exitTrigger = 'hard_turn_limit';
    }

    // 4. Diminishing Returns (Only if NO new evidence and NO topic shift)
    if (!completed && turnCount > 8 && trailingSaturation.length >= 3) {
      const sat3TurnsAgo = trailingSaturation[trailingSaturation.length - 3];
      const sumRecent3 = recentEvidenceCounts.slice(-3).reduce((a, b) => a + b, 0);
      if ((saturationCurrent - sat3TurnsAgo) < 0.05 && sumRecent3 === 0 && !input.topicShiftDetected) {
        completed = true;
        exitTrigger = 'diminishing_returns';
      }
    }

    // 4.5. Dense Dump Early Completion
    if (!completed && turnCount >= 3) {
      const satFeatures = input.saturation?.features || {};
      const problemSat = satFeatures.problemUnderstanding || 0;
      const impactSat = satFeatures.impactQuantification || 0;
      const rootSat = satFeatures.rootCauseDepth || 0;
      const oppSat = satFeatures.opportunityDepth || 0;
      const sumRecent2 = recentEvidenceCounts.slice(-2).reduce((a, b) => a + b, 0);
      
      if (problemSat >= 0.8 && impactSat >= 0.8 && rootSat >= 0.8 && oppSat >= 0.6 && sumRecent2 === 0) {
        completed = true;
        exitTrigger = 'dense_dump_exhaustion';
      }
    }

    // 5. Repetition Detection
    if (!completed && turnCount >= 3 && recentEvidenceCounts.length >= 2) {
      const sumRecent2 = recentEvidenceCounts.slice(-2).reduce((a, b) => a + b, 0);
      const oppSat = input.saturation?.features?.opportunityDepth || 0;
      
      if (sumRecent2 === 0 && !input.topicShiftDetected && oppSat > 0) {
        completed = true;
        exitTrigger = 'repetition_exhaustion';
      } else if (recentEvidenceCounts.length >= 3) {
        const sumRecent3 = recentEvidenceCounts.slice(-3).reduce((a, b) => a + b, 0);
        if (sumRecent3 === 0 && !input.topicShiftDetected) {
          completed = true;
          exitTrigger = 'repetition_exhaustion';
        }
      }
    }

    // 6. Early Sign-off on Don't Know / Unanswerable
    if (!completed && turnCount >= 6) {
      const hasMultipleUnanswerable = Array.isArray(input.unanswerableDimensions) && input.unanswerableDimensions.length >= 2;
      const recentTurnsNoEvidence = recentEvidenceCounts.slice(-2).reduce((a, b) => a + b, 0) === 0;
      if (hasMultipleUnanswerable || (recentTurnsNoEvidence && input.unanswerableDimensions?.length > 0)) {
        completed = true;
        exitTrigger = 'early_signoff_dont_know';
      }
    }

    // 7. Planner Requested Close
    if (!completed && input.plannerOutput?.nextQuestion?.targetDimension === 'complete') {
      completed = true;
      exitTrigger = 'planner_requested_close';
    }

    const output = {
      completed,
      rationale: completed
        ? `Completion threshold met via trigger: ${exitTrigger}.`
        : this.buildRationale({ saturationMet, confidenceMet, evidenceMet, saturationCurrent, confidenceCurrent, evidenceCurrent }),
      completionCriteria: {
        saturation_threshold: { current: saturationCurrent, required: this.saturationThreshold, met: saturationMet },
        confidence_threshold: { current: confidenceCurrent, required: this.confidenceThreshold, met: confidenceMet },
        evidence_minimum: { current: evidenceCurrent, required: this.evidenceMinimum, met: evidenceMet }
      },
      estimatedTurnsRemaining: this.estimateTurnsRemaining({ saturationCurrent, confidenceCurrent, evidenceCurrent, saturationMet, confidenceMet, evidenceMet, completed })
    };

    this.validateOutput(output);
    return output;
  }

  validateInput(input) {
    if (!input.saturation) throw new Error('CompletionAuthority: saturation required');
    if (!input.confidence) throw new Error('CompletionAuthority: confidence required');
    if (typeof input.turnCount !== 'number') throw new Error('CompletionAuthority: turnCount required (number)');
    if (typeof input.evidenceCount !== 'number') throw new Error('CompletionAuthority: evidenceCount required (number)');
    return true;
  }

  buildRationale(status) {
    const failures = [];
    if (!status.saturationMet) failures.push(`saturation ${status.saturationCurrent.toFixed(2)} < ${this.saturationThreshold.toFixed(2)}`);
    if (!status.confidenceMet) failures.push(`confidence ${status.confidenceCurrent.toFixed(2)} < ${this.confidenceThreshold.toFixed(2)}`);
    if (!status.evidenceMet) failures.push(`evidence ${status.evidenceCurrent} < ${this.evidenceMinimum}`);
    return `Not complete: ${failures.join('; ')}`;
  }

  estimateTurnsRemaining(status) {
    if (status.completed) return 0;
    const gaps = [
      Math.max(0, this.saturationThreshold - status.saturationCurrent) * 10,
      Math.max(0, this.confidenceThreshold - status.confidenceCurrent) * 10,
      Math.max(0, this.evidenceMinimum - status.evidenceCurrent) / 2
    ];
    return Math.max(1, Math.ceil(Math.max(...gaps)));
  }

  validateOutput(output) {
    if (typeof output.completed !== 'boolean') throw new Error('CompletionAuthority: completed must be boolean');
    if (!output.completionCriteria) throw new Error('CompletionAuthority: completionCriteria required');
    if (typeof output.estimatedTurnsRemaining !== 'number') throw new Error('CompletionAuthority: estimatedTurnsRemaining required (number)');
    return true;
  }
}

export default CompletionAuthority;
