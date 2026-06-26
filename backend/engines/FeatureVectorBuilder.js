/**
 * FeatureVectorBuilder
 * 
 * Type: DETERMINISTIC
 * Purpose: Convert org model into feature vector (mathematical transformation)
 * 
 * Input: organization, evidence[]
 * Output: features{}, featureVector[]
 * 
 * This is pure math: each org field maps to feature dimension via formula.
 * 
 * Phase: 1a (Skeleton - contracts only, no business logic)
 */

import { Engine } from '../types/index.js';

class FeatureVectorBuilder extends Engine {
  constructor() {
    super();
  }

  /**
   * Build feature vector from organization model
   * 
   * @param {Object} input
   * @param {Object} input.organization - Org model from OrganizationModel
   * @param {Array} input.evidence - Evidence set for dimension calculation
   * 
   * @param {Object} context - Shared context
   * @param {Object} context.logger - For logging
   * 
   * @returns {Promise<Object>} Output matching spec
   * @returns {Object} output.features - Feature dimensions
   * @returns {Array} output.featureVector - Normalized vector
   */
  async execute(input, context) {
    this.validateInput(input);

    const rootCauseFacts = input.evidence.filter(f => f.category === 'root_cause').map(f => f.statement);
    const uniqueRootCauses = new Set(rootCauseFacts).size;

    const rawFeatures = {
      problemClarity: this.scoreProblemClarity(input.organization, input.evidence),
      impactQuantification: this.scoreImpactQuantification(input.evidence),
      rootCauseDepth: this.scoreRootCauseDepth(input.organization, input.evidence, input.previousRootCauses),
      processDocumentation: this.scoreProcessDocumentation(input.organization, input.evidence),
      toolStackClarity: this.scoreToolStackClarity(input.organization, input.evidence),
      riskIdentification: this.scoreRiskIdentification(input.evidence),
      opportunityAlignment: this.scoreOpportunityAlignment(input.organization, input.evidence, input.previousOpportunities),
      userPainQuantification: this.scoreUserPainQuantification(input.evidence),
      rootCauseCoverage: Math.min(1, uniqueRootCauses / 3)
    };

    // FIX: Apply progressive dampening factor based on total evidence count.
    // Prevents score inflation when we have very few data points.
    // With 1 fact → 40% of raw score, 2 → 55%, 3 → 70%, 4 → 82%, 5+ → 90%+
    const evidenceCount = input.evidence.length;
    const dampeningFactor = Math.min(1.0, 0.25 + (evidenceCount * 0.15));

    const features = {};
    for (const [key, value] of Object.entries(rawFeatures)) {
      features[key] = this.roundScore(value * dampeningFactor);
    }

    const output = {
      features,
      featureVector: [
        features.problemClarity,
        features.impactQuantification,
        features.rootCauseDepth,
        features.processDocumentation,
        features.toolStackClarity,
        features.riskIdentification,
        features.opportunityAlignment,
        features.userPainQuantification
      ]
    };

    this.validateOutput(output);
    return output;
  }

  validateInput(input) {
    if (!input.organization) {
      throw new Error('FeatureVectorBuilder: organization required');
    }
    if (!Array.isArray(input.evidence)) {
      throw new Error('FeatureVectorBuilder: evidence required (array)');
    }
    return true;
  }

  validateOutput(output) {
    if (!output.features) {
      throw new Error('FeatureVectorBuilder: features required');
    }
    if (!Array.isArray(output.featureVector)) {
      throw new Error('FeatureVectorBuilder: featureVector must be array');
    }
    if (output.featureVector.length !== 8) {
      throw new Error('FeatureVectorBuilder: featureVector must have 8 dimensions');
    }
    return true;
  }

  scoreProblemClarity(organization, evidence) {
    const problemFacts = this.countByCategory(evidence, 'problem');
    const processFacts = this.countByCategory(evidence, 'process');
    const toolFacts = this.countByCategory(evidence, 'tool');
    
    // A process or tool IS the problem context. If the user mentions one, treat it as an implicit problem.
    const implicitProblemScore = (processFacts * 0.8) + (toolFacts * 0.8);
    const evidenceScore = Math.min(1, problemFacts + implicitProblemScore);
    
    const orgScore = this.textPresence(organization.primaryProblem);
    return this.roundScore(0.8 * evidenceScore + 0.2 * orgScore);
  }

  scoreImpactQuantification(evidence) {
    const impactFacts = this.countByCategory(evidence, 'impact');
    const metricFacts = this.countByCategory(evidence, 'metric');
    
    const impactScore = Math.min(1, impactFacts);
    const metricScore = Math.min(1, metricFacts);
    const synergy = (impactFacts > 0 && metricFacts > 0) ? 0.2 : 0;
    
    return this.roundScore(Math.min(1, ((impactScore + metricScore) / 2) + synergy));
  }

  scoreRootCauseDepth(organization, evidence, previousRootCauses) {
    const rootCauseFacts = evidence.filter(f => f.category === 'root_cause').map(f => f.statement);
    let uniqueRootCauses = new Set(rootCauseFacts).size;
    
    if (previousRootCauses && previousRootCauses.length > 0) {
      uniqueRootCauses = Math.max(uniqueRootCauses, previousRootCauses.length);
    }
    
    const evidenceScore = Math.min(1, uniqueRootCauses / 3);
    const orgScore = this.mean([
      Math.min(1, organization.constraints.length / 3),
      Math.min(1, organization.handoffPoints.length / 3)
    ]);
    return this.roundScore(0.8 * evidenceScore + 0.2 * orgScore);
  }

  scoreProcessDocumentation(organization, evidence) {
    const processFacts = this.countByCategory(evidence, 'process');
    const evidenceScore = Math.min(1, processFacts / 3);
    const orgScore = this.mean([
      Math.min(1, organization.affectedProcesses.length / 4),
      Math.min(1, organization.manualSteps.length / 5)
    ]);
    return this.roundScore(0.8 * evidenceScore + 0.2 * orgScore);
  }

  scoreToolStackClarity(organization, evidence) {
    // Robustly count tool-related facts (either category is 'tool', or statement mentions system/tool keywords)
    const toolFacts = evidence.filter(e => 
      e.category === 'tool' || 
      (e.category === 'operational_fact' && e.statement.match(/tool|system|software|platform|application|api|service|sql|excel|spreadsheet/i))
    ).length;

    // Detect negative tool stack statements (no systems, no tools)
    const hasNegativeToolStackEvidence = evidence.some(e => 
      e.statement.match(/no\s+tool|no\s+software|no\s+system|dont\s+use\s+any\s+tool|dont\s+use\s+any\s+application|dont\s+use\s+any\s+software|no\s+application|dont\s+have\s+any\s+system|dont\s+use\s+applications/i)
    );

    let evidenceScore = Math.min(1, toolFacts / 3);
    let orgScore = Math.min(1, organization.tools.length / 4);

    if (hasNegativeToolStackEvidence) {
      // If we have explicit evidence that they don't use systems, we have 100% clarity on their tool stack!
      evidenceScore = 1.0;
      orgScore = 1.0;
    } else if (organization.tools.length > 0) {
      // If we have identified at least one tool/application, we have a realistic baseline evidence score
      evidenceScore = Math.max(evidenceScore, 0.3);
    }

    return this.roundScore(0.8 * evidenceScore + 0.2 * orgScore);
  }

  scoreRiskIdentification(evidence) {
    const riskFacts = this.countByCategory(evidence, 'risk');
    return this.roundScore(Math.min(1, riskFacts / 2));
  }

  scoreOpportunityAlignment(organization, evidence, previousOpportunities) {
    const opportunityFacts = this.countByCategory(evidence, 'opportunity');
    let oppCount = opportunityFacts;
    
    if (previousOpportunities && previousOpportunities.length > 0) {
      oppCount = Math.max(oppCount, previousOpportunities.length);
    }
    
    const evidenceScore = Math.min(1, oppCount * 0.75);
    const orgScore = Math.min(1, organization.manualSteps.length / 5);
    return this.roundScore(0.8 * evidenceScore + 0.2 * orgScore);
  }

  scoreUserPainQuantification(evidence) {
    const impactFacts = this.countByCategory(evidence, 'impact');
    const problemFacts = this.countByCategory(evidence, 'problem');
    return this.roundScore(Math.min(1, (impactFacts + problemFacts) / 3));
  }

  countByCategory(evidence, category) {
    return evidence.filter(item => item.category === category).length;
  }

  textPresence(value) {
    return typeof value === 'string' && value.trim() ? 1 : 0;
  }

  mean(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  roundScore(value) {
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }
}

export default FeatureVectorBuilder;
