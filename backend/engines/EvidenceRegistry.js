/**
 * EvidenceRegistry
 * 
 * Type: DETERMINISTIC
 * Purpose: Accumulate, deduplicate, and normalize facts into evidence
 * 
 * Input: newFacts[], existingEvidence[]
 * Output: evidence[], coverageScore, gaps[]
 * 
 * This engine is pure logic: deduplication, conflict detection, coverage scoring.
 * 
 * Phase: 1a (Skeleton - contracts only, no business logic)
 */

import { Engine } from '../types/index.js';
import { PUBLIC_CONTRACTS } from '../contracts/index.js';

class EvidenceRegistry extends Engine {
  constructor(options = {}) {
    super();
    this.similarityThreshold = options.similarityThreshold || 0.85;
  }

  /**
   * Accumulate facts into evidence
   * 
   * @param {Object} input
   * @param {Array} input.newFacts - Facts from ExtractionConfidenceGate
   * @param {Array} input.existingEvidence - Previous evidence set
   * 
   * @param {Object} context - Shared context
   * @param {Object} context.logger - For logging
   * 
   * @returns {Promise<Object>} Output matching spec
   * @returns {Array} output.evidence - Accumulated evidence
   * @returns {number} output.coverageScore - 0.0-1.0
   * @returns {Array} output.gaps - Missing evidence categories
   */
  async execute(input, context) {
    this.validateInput(input);

    const mergedEvidence = input.existingEvidence.map(evidence => this.normalizeEvidence(evidence));

    for (const fact of input.newFacts) {
      const evidence = this.factToEvidence(fact);
      
      // Find semantically similar evidence of the same category
      const existing = mergedEvidence.find(e => 
        e.category === evidence.category && 
        this.areStatementsSimilar(e.statement, evidence.statement)
      );

      if (existing) {
        existing.sources = Array.from(new Set([...(existing.sources || []), fact.factId]));
        existing.confidence = Math.max(existing.confidence, evidence.confidence);
        // If the new statement is longer/more detailed, optionally keep the more detailed one
        if (evidence.statement.length > existing.statement.length) {
          existing.statement = evidence.statement;
        }
      } else {
        evidence.sources = [fact.factId];
        mergedEvidence.push(evidence);
      }
    }

    const output = {
      evidence: mergedEvidence,
      coverageScore: this.calculateCoverageScore(mergedEvidence),
      gaps: this.calculateGaps(mergedEvidence)
    };

    this.validateOutput(output);
    return output;
  }

  areStatementsSimilar(s1, s2) {
    const normalize = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    const words1 = normalize(s1);
    const words2 = normalize(s2);
    if (words1.length === 0 || words2.length === 0) return false;

    const set1 = new Set(words1);
    const set2 = new Set(words2);

    let intersection = 0;
    for (const w of set1) {
      if (set2.has(w)) intersection++;
    }
    const union = new Set([...words1, ...words2]).size;
    const jaccard = intersection / union;

    const overlap1 = intersection / set1.size;
    const overlap2 = intersection / set2.size;

    return jaccard >= 0.65 || overlap1 >= 0.85 || overlap2 >= 0.85;
  }

  validateInput(input) {
    if (!Array.isArray(input.newFacts)) {
      throw new Error('EvidenceRegistry: newFacts required (array)');
    }
    if (!Array.isArray(input.existingEvidence)) {
      throw new Error('EvidenceRegistry: existingEvidence required (array)');
    }
    return true;
  }

  validateOutput(output) {
    if (!Array.isArray(output.evidence)) {
      throw new Error('EvidenceRegistry: evidence must be array');
    }
    if (typeof output.coverageScore !== 'number' || output.coverageScore < 0 || output.coverageScore > 1) {
      throw new Error('EvidenceRegistry: coverageScore must be 0.0-1.0');
    }
    if (!Array.isArray(output.gaps)) {
      throw new Error('EvidenceRegistry: gaps must be array');
    }
    return true;
  }

  normalizeEvidence(evidence) {
    if (!evidence || typeof evidence !== 'object') {
      throw new Error('EvidenceRegistry: evidence entries must be objects');
    }

    const statement = String(evidence.statement || '').trim();
    if (!statement) {
      throw new Error('EvidenceRegistry: evidence.statement required');
    }

    return {
      evidenceId: evidence.evidenceId || this.createEvidenceId(statement),
      category: evidence.category || 'operational_fact',
      statement,
      confidence: this.clampConfidence(evidence.confidence),
      sources: Array.isArray(evidence.sources) ? [...evidence.sources] : [],
      contradictions: Array.isArray(evidence.contradictions) ? [...evidence.contradictions] : [],
      updatedAt: evidence.updatedAt || new Date(0).toISOString()
    };
  }

  factToEvidence(fact) {
    if (!fact || typeof fact !== 'object') {
      throw new Error('EvidenceRegistry: newFacts entries must be objects');
    }

    const statement = String(fact.statement || '').trim();
    if (!statement) {
      throw new Error('EvidenceRegistry: fact.statement required');
    }

    return {
      evidenceId: `ev_${String(fact.factId || statement).replace(/[^a-zA-Z0-9]+/g, '_')}`,
      category: this.mapFactTypeToCategory(fact.type),
      statement,
      confidence: this.clampConfidence(fact.confidence),
      sources: [],
      contradictions: [],
      updatedAt: new Date(0).toISOString()
    };
  }

  mapFactTypeToCategory(type) {
    const categoryMap = {
      problem: 'problem',
      impact: 'impact',
      metric: 'metric',
      process: 'process',
      root_cause: 'root_cause',
      opportunity: 'opportunity',
      tool: 'tool',
      constraint: 'constraint',
      risk: 'risk'
    };

    return categoryMap[type] || 'operational_fact';
  }

  clampConfidence(confidence) {
    if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
      return 0;
    }
    return Math.max(0, Math.min(1, confidence));
  }

  createEvidenceId(statement) {
    return `ev_${statement.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
  }

  calculateCoverageScore(evidence) {
    const categories = new Set(evidence.map(item => item.category));
    const mappedCategories = new Set();
    for (const cat of categories) {
      if (['problem', 'process', 'tool', 'root_cause', 'opportunity', 'operational_fact'].includes(cat)) {
        mappedCategories.add('operational_fact');
      } else {
        mappedCategories.add(cat);
      }
    }
    return Math.max(0, Math.min(1, mappedCategories.size / 4));
  }

  calculateGaps(evidence) {
    const categories = new Set(evidence.map(item => item.category));
    const mappedCategories = new Set();
    for (const cat of categories) {
      if (['problem', 'process', 'tool', 'root_cause', 'opportunity', 'operational_fact'].includes(cat)) {
        mappedCategories.add('operational_fact');
      } else {
        mappedCategories.add(cat);
      }
    }
    const requiredCategories = ['operational_fact', 'metric', 'constraint', 'risk'];
    return requiredCategories.filter(category => !mappedCategories.has(category));
  }
}

EvidenceRegistry.contracts = PUBLIC_CONTRACTS;

export default EvidenceRegistry;
