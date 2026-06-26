/**
 * OrganizationModel
 * 
 * Type: HYBRID
 * Purpose: Aggregate evidence into structured organization understanding
 * 
 * Input: evidence[]
 * Output: organization{}, modelQuality
 * 
 * Phase: 1b Wave 3 (deterministic aggregation + heuristic quality scoring)
 */

import { Engine } from '../types/index.js';
import { WAVE3_FORMULAS } from '../contracts/index.js';

class OrganizationModel extends Engine {
  constructor() {
    super();
  }

  /**
   * Aggregate evidence into organization model
   * 
   * @param {Object} input
   * @param {Array} input.evidence - Evidence array
   * 
   * @param {Object} context - Shared context
   * @param {Object} context.logger - For logging
   * 
   * @returns {Promise<Object>} Output matching spec
   * @returns {Object} output.organization - Organization structure
   * @returns {number} output.modelQuality - Quality score 0.0-1.0
   */
  async execute(input, context) {
    this.validateInput(input);
    
    const evidence = input.evidence || [];
    const organization = {
      primaryProblem: this.extractPrimaryProblem(evidence),
      affectedProcesses: this.extractProcesses(evidence),
      tools: this.extractTools(evidence),
      manualSteps: this.extractManualSteps(evidence),
      handoffPoints: this.extractHandoffs(evidence),
      constraints: this.extractConstraints(evidence)
    };

    const modelQuality = this.calculateModelQuality(organization, evidence);

    const output = {
      organization,
      modelQuality
    };

    this.validateOutput(output);
    return output;
  }

  validateInput(input) {
    if (!Array.isArray(input.evidence)) {
      throw new Error('OrganizationModel: evidence required (array)');
    }
    return true;
  }

  extractPrimaryProblem(evidence) {
    const problemStatements = (evidence || [])
      .filter(e => e.category === 'problem' || (e.category === 'operational_fact' && e.statement.toLowerCase().includes('problem')))
      .map(e => e.statement);
    return problemStatements[0] || '';
  }

  extractProcesses(evidence) {
    const processes = new Set();
    (evidence || [])
      .filter(e => ['process', 'operational_fact'].includes(e.category))
      .forEach(e => {
        if (e.category === 'process' || e.statement.match(/process|workflow|step|flow/i)) {
          processes.add(e.statement);
        }
      });
    return Array.from(processes);
  }

  extractTools(evidence) {
    const tools = new Set();
    (evidence || [])
      .filter(e => ['tool', 'operational_fact'].includes(e.category))
      .forEach(e => {
        if (e.category === 'tool' || e.statement.match(/tool|system|software|platform|application|api|service/i)) {
          tools.add(e.statement);
        }
      });
    return Array.from(tools);
  }

  extractManualSteps(evidence) {
    const manualSteps = new Set();
    (evidence || [])
      .filter(e => ['process', 'problem', 'operational_fact'].includes(e.category))
      .forEach(e => {
        if (e.statement.match(/manual|hand|type|spreadsheet|copy|paste|mismatch/i)) {
          manualSteps.add(e.statement);
        }
      });
    return Array.from(manualSteps);
  }

  extractHandoffs(evidence) {
    const handoffs = [];
    (evidence || [])
      .filter(e => ['process', 'problem', 'operational_fact'].includes(e.category) && e.statement.match(/handoff|hand off|pass|transfer|move to|send to/i))
      .forEach(e => {
        const match = e.statement.match(/from\s+(\w+)\s+to\s+(\w+)/i) || 
                      e.statement.match(/(\w+)\s+(?:hands|passes|sends)\s+(?:to|sends to)\s+(\w+)/i);
        if (match) {
          handoffs.push({
            from: match[1],
            to: match[2],
            process: e.statement,
            riskLevel: this.assessHandoffRisk(handoffs.length)
          });
        }
      });
    return handoffs;
  }

  extractConstraints(evidence) {
    const constraints = new Set();
    (evidence || [])
      .filter(e => e.category === 'constraint')
      .forEach(e => {
        constraints.add(e.statement);
      });
    return Array.from(constraints);
  }

  assessHandoffRisk(handoffCount) {
    if (handoffCount >= 3) return 'high';
    if (handoffCount >= 1) return 'medium';
    return 'low';
  }

  calculateModelQuality(organization, evidence) {
    const completeness = (
      (organization.primaryProblem ? 1 : 0) +
      (organization.affectedProcesses.length >= 2 ? 1 : 0.5) +
      (organization.tools.length >= 1 ? 1 : 0.5) +
      (organization.manualSteps.length >= 1 ? 1 : 0.5) +
      (organization.handoffPoints.length >= 1 ? 1 : 0.5) +
      (organization.constraints.length >= 1 ? 1 : 0.5)
    ) / 6;

    const evidenceQuality = (evidence || []).length >= 10 ? 1.0 : Math.min(1.0, (evidence || []).length / 10);
    
    return this.clamp((completeness + evidenceQuality) / 2);
  }

  clamp(value) {
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }

  validateOutput(output) {
    if (!output.organization) {
      throw new Error('OrganizationModel: organization required');
    }
    if (typeof output.modelQuality !== 'number' || output.modelQuality < 0 || output.modelQuality > 1) {
      throw new Error('OrganizationModel: modelQuality must be 0.0-1.0');
    }
    return true;
  }
}

export default OrganizationModel;
