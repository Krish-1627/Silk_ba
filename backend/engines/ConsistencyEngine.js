/**
 * ConsistencyEngine
 * 
 * Type: DETERMINISTIC
 * Purpose: Detect contradictions in evidence
 * 
 * Input: evidence[]
 * Output: contradictions[]
 * 
 * This is pure logic: compare evidence statements for contradictions.
 * 
 * Phase: 1a (Skeleton - contracts only, no business logic)
 */

import { Engine } from '../types/index.js';

class ConsistencyEngine extends Engine {
  constructor() {
    super();
  }

  /**
   * Detect contradictions in evidence
   * 
   * @param {Object} input
   * @param {Array} input.evidence - Evidence set to check
   * 
   * @param {Object} context - Shared context
   * @param {Object} context.logger - For logging
   * 
   * @returns {Promise<Object>} Output matching spec
   * @returns {Array} output.contradictions
   */
  async execute(input, context) {
    this.validateInput(input);

    const output = {
      contradictions: this.detectContradictions(input.evidence)
    };

    this.validateOutput(output);
    return output;
  }

  validateInput(input) {
    if (!Array.isArray(input.evidence)) {
      throw new Error('ConsistencyEngine: evidence required (array)');
    }
    return true;
  }

  detectContradictions(evidence) {
    const contradictions = [];

    for (let left = 0; left < evidence.length; left += 1) {
      for (let right = left + 1; right < evidence.length; right += 1) {
        const contradiction = this.compareEvidence(evidence[left], evidence[right], contradictions.length + 1);
        if (contradiction) {
          contradictions.push(contradiction);
        }
      }
    }

    return contradictions;
  }

  compareEvidence(left, right, index) {
    const leftText = this.normalizeText(left?.statement);
    const rightText = this.normalizeText(right?.statement);

    if (!leftText || !rightText) {
      return null;
    }

    // FIX: Require that left and right share at least one meaningful subject keyword
    // to ensure they are about the same topic before flagging a contradiction.
    const subjectWords = this.extractSubjectKeywords(leftText);
    const rightSubjectWords = this.extractSubjectKeywords(rightText);
    const sharedSubjects = subjectWords.filter(w => rightSubjectWords.includes(w));

    if (sharedSubjects.length === 0) {
      // Statements are about entirely different subjects — not a contradiction
      return null;
    }

    // Issue 3: Numeric contradiction pass — detect semantic value conflicts
    // (e.g. "5 claims/day" vs "5,000 claims/day" on the same subject)
    if (this.detectNumericContradiction(leftText, rightText, sharedSubjects)) {
      return {
        contradictionId: `contra_${String(index).padStart(3, '0')}`,
        fact_a: left.statement,
        fact_b: right.statement,
        severity: 'medium', // Numeric mismatches might be unit differences, so medium by default
        resolution_needed: true
      };
    }

    const contradictionPatterns = [
      [/\bno\b.*\bvisibility\b/, /\btrack\b|(?:\breal[- ]?time\b.*\bmetrics\b)|\bfull\s+visibility\b/],
      [/\bmanual\b/, /\bautomated\b|(?:\bfully\b.*\bautomation\b)/],
      [/\bnot\b.*\bused\b/, /\bused\b/],
      [/\bslow\b|\bdelayed\b/, /\bfast\b|\binstant\b/]
    ];

    // Check if one statement matches the negative pattern and the OTHER matches the positive
    const matched = contradictionPatterns.some(([negative, positive]) => (
      (negative.test(leftText) && positive.test(rightText)) ||
      (negative.test(rightText) && positive.test(leftText))
    ));

    if (!matched) {
      return null;
    }

    return {
      contradictionId: `contra_${String(index).padStart(3, '0')}`,
      fact_a: left.statement,
      fact_b: right.statement,
      severity: this.determineSeverity(left, right),
      resolution_needed: true
    };
  }

  /**
   * Issue 3: Detect numeric contradictions between two evidence statements.
   *
   * A numeric contradiction is flagged when:
   *   1. Both statements share at least one meaningful subject keyword (same topic)
   *   2. Both statements contain numbers
   *   3. Any pair of numbers has a magnitude ratio >= NUMERIC_CONTRADICTION_RATIO_THRESHOLD (10x)
   *
   * This catches cases like:
   *   - "we process 5 claims a day" vs "our daily claims volume is 5,000"
   *   - "team size is 3 people" vs "we have 30 staff on this"
   *
   * Uses a configurable threshold constant so it can be tuned without code changes.
   */
  static get NUMERIC_CONTRADICTION_RATIO_THRESHOLD() {
    return 10; // Factor of 10x or more = likely contradiction
  }

  detectNumericContradiction(leftText, rightText, sharedSubjects) {
    // Require shared subject context — without it, numbers are unrelated
    if (!sharedSubjects || sharedSubjects.length === 0) return false;

    const extractNumbers = (text) => {
      const matches = text.match(/[\d,]+(?:\.\d+)?/g) || [];
      return matches
        .map(n => parseFloat(n.replace(/,/g, '')))
        .filter(n => !isNaN(n) && n > 0);
    };

    const leftNums = extractNumbers(leftText);
    const rightNums = extractNumbers(rightText);

    // Both sides must have numeric content to compare
    if (leftNums.length === 0 || rightNums.length === 0) return false;

    const threshold = ConsistencyEngine.NUMERIC_CONTRADICTION_RATIO_THRESHOLD;

    for (const ln of leftNums) {
      for (const rn of rightNums) {
        const larger  = Math.max(ln, rn);
        const smaller = Math.min(ln, rn);
        // Guard against division by zero for very small numbers
        if (smaller > 0 && (larger / smaller) >= threshold) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Extract meaningful subject keywords (nouns/verbs) from evidence text
   * for same-subject matching. Filters out common stop words.
   */
  extractSubjectKeywords(text) {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to',
      'for', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'has', 'have', 'had',
      'that', 'this', 'which', 'their', 'its', 'our', 'we', 'they', 'it', 'be',
      'been', 'being', 'do', 'does', 'did', 'will', 'would', 'should', 'could',
      'may', 'might', 'not', 'no', 'all', 'very', 'also', 'just', 'each',
      'organization', 'company', 'team', 'process', 'currently', 'using', 'used',
      'takes', 'leads', 'due', 'per', 'week', 'month', 'day', 'hours'
    ]);
    return text.split(/\s+/)
      .map(w => w.replace(/[^a-z]/g, ''))
      .filter(w => w.length > 3 && !stopWords.has(w));
  }

  normalizeText(value) {
    return String(value || '').toLowerCase();
  }

  determineSeverity(left, right) {
    const confidence = Math.min(this.getConfidence(left), this.getConfidence(right));
    if (confidence >= 0.9) return 'high';
    if (confidence >= 0.7) return 'medium';
    return 'low';
  }

  getConfidence(item) {
    return typeof item?.confidence === 'number' ? item.confidence : 0;
  }

  validateOutput(output) {
    if (!Array.isArray(output.contradictions)) {
      throw new Error('ConsistencyEngine: contradictions must be array');
    }
    output.contradictions.forEach((c, idx) => {
      if (!c.contradictionId) throw new Error(`Contradiction ${idx}: contradictionId required`);
      if (!['low', 'medium', 'high'].includes(c.severity)) {
        throw new Error(`Contradiction ${idx}: invalid severity`);
      }
    });
    return true;
  }
}

export default ConsistencyEngine;
