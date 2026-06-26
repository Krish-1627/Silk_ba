/**
 * OpportunityQualificationEngine
 * 
 * Type: HYBRID
 * Purpose: Rule-based opportunity detection with heuristic viability scoring
 * 
 * Strategy: DETECT = LOCK (immediate)
 *   - Any single evidence item matching a service signal immediately qualifies and LOCKS that service.
 *   - No "pending" state. No "confirm questions". Detected = done.
 *   - lockedServiceTypes drives the QuestionPlanner to PIVOT to the next unexplored service.
 * 
 * Input: organization{}, evidence[], featureVector[]
 * Output: opportunities[], lockedServiceTypes[], pendingServiceTypes[]
 */

import { Engine } from '../types/index.js';
import { WAVE3_FORMULAS } from '../contracts/index.js';

class OpportunityQualificationEngine extends Engine {
  constructor() {
    super();
  }

  async execute(input, context) {
    this.validateInput(input);

    const opportunities = this.detectOpportunities(input.organization, input.evidence, input.featureVector);
    
    // All detected = locked immediately. No pending state.
    const lockedServiceTypes = opportunities.map(o => o.serviceType);
    const pendingServiceTypes = []; // Always empty — we removed the pending state

    const output = {
      opportunities,
      opportunityCount: opportunities.length,
      serviceDistribution: this.calculateServiceDistribution(opportunities),
      lockedServiceTypes,
      pendingServiceTypes
    };

    this.validateOutput(output);
    return output;
  }

  validateInput(input) {
    if (!input.organization) {
      throw new Error('OpportunityQualificationEngine: organization required');
    }
    if (!Array.isArray(input.evidence)) {
      throw new Error('OpportunityQualificationEngine: evidence required (array)');
    }
    if (!Array.isArray(input.featureVector)) {
      throw new Error('OpportunityQualificationEngine: featureVector required (array)');
    }
    return true;
  }

  detectOpportunities(organization, evidence, featureVector) {
    const opportunities = [];
    let oppCounter = 0;

    // ─── RULE 1: Automation ───────────────────────────────────────────────────
    // ANY mention of manual work, spreadsheets, copying, repetitive tasks → LOCK
    if (this.hasAutomationSignal(evidence)) {
      opportunities.push({
        opportunityId: `opp_automation_${oppCounter++}`,
        serviceType: 'automation',
        problem: 'Manual and repetitive processes detected',
        rootCause: 'Lack of workflow automation',
        evidence: this.findSupportingEvidence(evidence, ['manual', 'excel', 'copy', 'repetitive', 'spreadsheet', 'data entry']),
        viability: this.assessViability(evidence, ['manual', 'repetitive', 'copy']),
        implementationBarrier: this.identifyBarrier(organization),
        potentialTimesSaved: this.estimateTimeSaved(organization),
        potentialErrorReduction: 0.75,
        strategicImportance: 'growth_enabling',
        confirmationState: 'confirmed'
      });
    }

    // ─── RULE 2: Analytics ────────────────────────────────────────────────────
    // ANY mention of no visibility, tracking, dashboards, inventory levels → LOCK
    if (this.hasAnalyticsSignal(evidence)) {
      opportunities.push({
        opportunityId: `opp_analytics_${oppCounter++}`,
        serviceType: 'analytics',
        problem: 'Lack of data visibility or reporting',
        rootCause: 'Missing reporting, dashboards, or measurement capability',
        evidence: this.findSupportingEvidence(evidence, ['visibility', 'report', 'dashboard', 'metric', 'track', 'inventory', 'stock']),
        viability: this.assessViability(evidence, ['visibility', 'metric', 'report']),
        implementationBarrier: this.identifyBarrier(organization),
        potentialTimesSaved: this.estimateTimeSaved(organization),
        potentialErrorReduction: 0.5,
        strategicImportance: 'risk_reduction',
        confirmationState: 'confirmed'
      });
    }

    // ─── RULE 3: AI Solutions ─────────────────────────────────────────────────
    // ANY mention of AI, prediction, matching, screening, intelligent search → LOCK
    // Also locks if user EXPLICITLY says "AI solutions", "looking for AI", etc.
    if (this.hasAISignal(evidence)) {
      opportunities.push({
        opportunityId: `opp_ai_${oppCounter++}`,
        serviceType: 'ai_solutions',
        problem: 'Intelligent decision-making or matching gaps identified',
        rootCause: 'Lack of AI-driven filtering, prediction, or recommendations',
        evidence: this.findSupportingEvidence(evidence, ['ai', 'predict', 'match', 'screen', 'intelligent', 'machine learning', 'smart']),
        viability: this.assessViability(evidence, ['ai', 'predict', 'match', 'screen']),
        implementationBarrier: this.identifyBarrier(organization),
        potentialTimesSaved: this.estimateTimeSaved(organization),
        potentialErrorReduction: 0.6,
        strategicImportance: 'competitive_advantage',
        confirmationState: 'confirmed'
      });
    }

    return opportunities;
  }

  // ─── Signal detectors: ANY single match = true ────────────────────────────

  hasAutomationSignal(evidence) {
    const pattern = /\b(manual|repetitive|excel|spreadsheets?|copy|paste|paperwork|data\s+entry|workflows?|automate|automation|automating|re-?enter|typing|scripts?|slow|delays?|mistakes?|errors?|time.consuming|tedious)\b/i;
    return (evidence || []).some(e => pattern.test(e.statement));
  }

  hasAnalyticsSignal(evidence) {
    const pattern = /\b(visibility|no\s+visibility|can't\s+see|cant\s+see|blind|track|tracking|dashboards?|reports?|reporting|metrics?|measures?|insights?|visualize|inventory|inventories|stocks?|levels?|quantities|quantity|monitor|performance|shortage|overstock|demand\s+plan|data\s+gap|no\s+data|analytics?|analysis|analyses|analyz[ee]s?)\b/i;
    return (evidence || []).some(e => pattern.test(e.statement));
  }

  hasAISignal(evidence) {
    // Also matches explicit "looking for AI solutions", "need AI", "want AI" type statements
    const pattern = /\b(ai|artificial\s+intelligence|ml|machine\s+learning|predict|predictions?|forecasts?|match|matching|screenings?|screens?|shortlists?|recommends?|recommendations?|intelligent|smart|cognitive|rankings?|ranks?|filters?|candidates?|fits?|relevance|relevant|automate.*intelligent|looking\s+for\s+ai|need\s+ai|want\s+ai|ai\s+solutions?)\b/i;
    return (evidence || []).some(e => pattern.test(e.statement));
  }

  findSupportingEvidence(evidence, keywords) {
    const found = (evidence || [])
      .filter(e => keywords.some(kw => e.statement.toLowerCase().includes(kw)))
      .map(e => e.evidenceId || '')
      .filter(Boolean);
    return found.slice(0, 3);
  }

  assessViability(evidence, keywords) {
    const allStatements = (evidence || []).map(e => e.statement.toLowerCase()).join(' ');
    const matchCount = keywords.filter(kw => allStatements.includes(kw)).length;
    if (matchCount >= 2) return 'high';
    if (matchCount >= 1) return 'medium';
    return 'low';
  }

  identifyBarrier(organization) {
    if ((organization.constraints || []).some(c => c.match(/legacy|old/i))) {
      return 'legacy_system';
    }
    return 'data_quality';
  }

  estimateTimeSaved(organization) {
    return Math.round(((organization.manualSteps || []).length + (organization.affectedProcesses || []).length) * 2);
  }

  calculateServiceDistribution(opportunities) {
    return {
      ai_solutions: opportunities.filter(o => o.serviceType === 'ai_solutions').length,
      automation: opportunities.filter(o => o.serviceType === 'automation').length,
      analytics: opportunities.filter(o => o.serviceType === 'analytics').length
    };
  }

  validateOutput(output) {
    if (!Array.isArray(output.opportunities)) {
      throw new Error('OpportunityQualificationEngine: opportunities must be array');
    }
    if (typeof output.opportunityCount !== 'number') {
      throw new Error('OpportunityQualificationEngine: opportunityCount required (number)');
    }
    if (!output.serviceDistribution || typeof output.serviceDistribution !== 'object') {
      throw new Error('OpportunityQualificationEngine: serviceDistribution required (object)');
    }
    return true;
  }
}

export default OpportunityQualificationEngine;
