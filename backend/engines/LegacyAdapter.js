/**
 * LegacyAdapter
 * 
 * Type: DETERMINISTIC
 * Purpose: Transform engineState into legacyState for backward compatibility
 * 
 * Input: engineState (complete engine outputs)
 * Output: legacyState (compatible with existing UI)
 * 
 * This is pure schema mapping: transform functions, no business logic.
 * 
 * Phase: 1a (Skeleton - contracts only, no business logic)
 */

import { Engine } from '../types/index.js';
import { CONTRACT_VERSION, PUBLIC_CONTRACTS } from '../contracts/index.js';

class LegacyAdapter extends Engine {
  constructor() {
    super();
  }

  /**
   * Transform engineState to legacyState
   * 
   * @param {Object} input
   * @param {Object} input.engineState - Complete output from all engines
   * 
   * @param {Object} context - Shared context
   * @param {Object} context.logger - For logging
   * 
   * @returns {Promise<Object>} Output matching spec (legacyState compatible with UI)
   * @returns {Array} output.deduced_operational_facts
   * @returns {Array} output.root_causes
   * @returns {Array} output.ai_opportunities
   * @returns {Array} output.automation_opportunities
   * @returns {Array} output.analytics_opportunities
   * @returns {Object} output.xray_pillar_clarity_scores
   * @returns {boolean} output.is_completed
   * @returns {number} output.interview_completion_percentage
   */
  async execute(input, context) {
    this.validateInput(input);

    const engineState = input.engineState;

    const output = {
      deduced_operational_facts: this.mapFacts(engineState?.evidenceRegistry?.evidence),
      root_causes: this.mapRootCauses(engineState?.rootCause),
      ai_opportunities: this.mapOpportunities(engineState?.opportunityQualification?.opportunities, 'ai_solutions'),
      automation_opportunities: this.mapOpportunities(engineState?.opportunityQualification?.opportunities, 'automation'),
      analytics_opportunities: this.mapOpportunities(engineState?.opportunityQualification?.opportunities, 'analytics'),
      xray_pillar_clarity_scores: this.mapClarityScores(engineState?.featureVector),
      is_completed: Boolean(engineState?.completionAuthority?.completed),
      interview_completion_percentage: this.pickNumber(engineState?.interview_completion_percentage, 0),
      risks: this.mapRisks(engineState?.risks),
      business_impact: this.mapBusinessImpact(engineState?.business_impact),
      contradictions: this.mapContradictions(engineState?.consistency?.contradictions),
      discovered_dimensions: this.mapDiscoveredDimensions(engineState?.discovered_dimensions),
      service_fit_scores: this.mapServiceFitScores(engineState?.service_fit_scores),
      current_question_count: this.pickNumber(engineState?.current_question_count, 0),
      next_logical_target: this.pickString(engineState?.next_logical_target, ''),
      is_absurd_or_meaningless_input: this.pickBoolean(engineState?.is_absurd_or_meaningless_input, false),
      question_reasoning: this.mapQuestionReasoning(engineState?.question_reasoning),
      natural_analyst_response: this.pickString(engineState?.natural_analyst_response, '')
    };

    this.validateOutput(output);
    return output;
  }

  validateInput(input) {
    if (!input.engineState || typeof input.engineState !== 'object') {
      throw new Error('LegacyAdapter: engineState required (object)');
    }
    return true;
  }

  mapFacts(evidence) {
    return Array.isArray(evidence) ? evidence.map(item => item.statement) : [];
  }

  mapRootCauses(rootCauseOutput) {
    const tree = rootCauseOutput?.rootCauseTree;
    if (!tree) return [];
    return [
      {
        problem: tree.problem,
        root_causes: [...tree.immediateRootCauses]
      }
    ];
  }

  mapOpportunities(opportunities, serviceType) {
    return Array.isArray(opportunities)
      ? opportunities
        .filter(opportunity => opportunity.serviceType === serviceType)
        .map(opportunity => ({
          opportunity: opportunity.problem,
          confidence: this.pickNumber(opportunity.confidence, 0),
          impact: opportunity.impact || 'Low',
          business_value_score: this.pickNumber(opportunity.business_value_score, 0),
          supporting_facts: Array.isArray(opportunity.supporting_facts) ? [...opportunity.supporting_facts] : [...(opportunity.evidence || [])]
        }))
      : [];
  }

  mapClarityScores(featureVector) {
    const features = featureVector?.features || {};
    return {
      processes: this.pickNumber(features.processDocumentation, 0),
      tools: this.pickNumber(features.toolStackClarity, 0),
      metrics: this.pickNumber(features.impactQuantification, 0),
      risks: this.pickNumber(features.riskIdentification, 0)
    };
  }

  mapRisks(evidence) {
    return Array.isArray(evidence) ? [...evidence] : [];
  }

  mapBusinessImpact(businessImpact) {
    return Array.isArray(businessImpact) ? [...businessImpact] : [];
  }

  mapContradictions(contradictions) {
    return Array.isArray(contradictions)
      ? contradictions.map(item => ({ fact_a: item.fact_a, fact_b: item.fact_b }))
      : [];
  }

  mapDiscoveredDimensions(discoveredDimensions) {
    return Array.isArray(discoveredDimensions) ? [...discoveredDimensions] : [];
  }

  mapServiceFitScores(serviceFitScores) {
    return {
      ai_fit: this.pickNumber(serviceFitScores?.ai_fit, 0),
      automation_fit: this.pickNumber(serviceFitScores?.automation_fit, 0),
      analytics_fit: this.pickNumber(serviceFitScores?.analytics_fit, 0)
    };
  }

  mapQuestionReasoning(questionReasoning) {
    if (!questionReasoning || typeof questionReasoning !== 'object') {
      return {
        target_dimension: '',
        facts_to_discover: [],
        potential_services: []
      };
    }

    return {
      target_dimension: this.pickString(questionReasoning.target_dimension, ''),
      facts_to_discover: Array.isArray(questionReasoning.facts_to_discover) ? [...questionReasoning.facts_to_discover] : [],
      potential_services: Array.isArray(questionReasoning.potential_services) ? [...questionReasoning.potential_services] : []
    };
  }

  pickString(value, fallback) {
    return typeof value === 'string' ? value : fallback;
  }

  pickNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  pickBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  validateOutput(output) {
    if (!Array.isArray(output.deduced_operational_facts)) {
      throw new Error('LegacyAdapter: deduced_operational_facts must be array');
    }
    if (!Array.isArray(output.root_causes)) {
      throw new Error('LegacyAdapter: root_causes must be array');
    }
    if (!Array.isArray(output.ai_opportunities)) {
      throw new Error('LegacyAdapter: ai_opportunities must be array');
    }
    if (!Array.isArray(output.automation_opportunities)) {
      throw new Error('LegacyAdapter: automation_opportunities must be array');
    }
    if (!Array.isArray(output.analytics_opportunities)) {
      throw new Error('LegacyAdapter: analytics_opportunities must be array');
    }
    if (typeof output.is_completed !== 'boolean') {
      throw new Error('LegacyAdapter: is_completed must be boolean');
    }
    if (typeof output.interview_completion_percentage !== 'number') {
      throw new Error('LegacyAdapter: interview_completion_percentage must be number');
    }
    if (!Array.isArray(output.risks)) {
      throw new Error('LegacyAdapter: risks must be array');
    }
    if (!Array.isArray(output.business_impact)) {
      throw new Error('LegacyAdapter: business_impact must be array');
    }
    if (!Array.isArray(output.contradictions)) {
      throw new Error('LegacyAdapter: contradictions must be array');
    }
    if (!Array.isArray(output.discovered_dimensions)) {
      throw new Error('LegacyAdapter: discovered_dimensions must be array');
    }
    if (!output.service_fit_scores || typeof output.service_fit_scores !== 'object') {
      throw new Error('LegacyAdapter: service_fit_scores must be object');
    }
    if (typeof output.current_question_count !== 'number') {
      throw new Error('LegacyAdapter: current_question_count must be number');
    }
    if (typeof output.next_logical_target !== 'string') {
      throw new Error('LegacyAdapter: next_logical_target must be string');
    }
    if (typeof output.is_absurd_or_meaningless_input !== 'boolean') {
      throw new Error('LegacyAdapter: is_absurd_or_meaningless_input must be boolean');
    }
    if (!output.question_reasoning || typeof output.question_reasoning !== 'object') {
      throw new Error('LegacyAdapter: question_reasoning must be object');
    }
    if (typeof output.natural_analyst_response !== 'string') {
      throw new Error('LegacyAdapter: natural_analyst_response must be string');
    }
    return true;
  }
}

LegacyAdapter.contractVersion = CONTRACT_VERSION;
LegacyAdapter.contracts = PUBLIC_CONTRACTS;

export default LegacyAdapter;
