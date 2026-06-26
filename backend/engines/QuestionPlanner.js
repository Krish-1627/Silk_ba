/**
 * QuestionPlanner
 * 
 * Type: HYBRID
 * Purpose: Plan next question using Detect → Pivot strategy
 * 
 * Conversation Phases:
 *   Phase A (DETECT/FILL):  No services locked yet → ask broad gap-filling questions
 *   Phase C (PIVOT):        1+ service locked, others unexplored → immediately pivot to probe next service
 *   Phase D (SOLIDIFY):     Turns 7+ → stop exploring, solidify evidence for locked services
 *   Phase E (CLOSE):        All services explored OR turn limit → close and pitch
 *
 * KEY RULE: Once a service is locked (detected), NEVER ask about it again.
 *           Immediately pivot to explore the next unexplored service.
 *
 * Input: uncertaintyMatrix{}, saturation{}, featureVector[], conversationHistory[],
 *        evidence[], lockedServiceTypes[], pendingServiceTypes[]
 * Output: nextQuestion{}
 */

import { Engine } from '../types/index.js';
import { WAVE3_FORMULAS } from '../contracts/index.js';

// The 3 Silk services. We explore all 3.
const ALL_SERVICES = ['automation', 'analytics', 'ai_solutions'];

// ─── Semantic Expansion Map (Issue 2) ────────────────────────────────────────
// Catches indirect/paraphrased language that the main keyword regexes miss.
// Each entry: { pattern: RegExp, service: string, score: number }
const SEMANTIC_EXPANSION_MAP = [
  // Automation — indirect descriptions of manual data entry / legacy systems
  { pattern: /\b(hand[- ]?typ|re[- ]?key(?:ing)?|re-?enter(?:ing)?|copy.{1,20}paste|transcrib|fill.{1,15}form|legacy.{1,20}software|paper.{1,10}trail|physical.{1,10}form|fax|stamp|handwrit)\b/i, service: 'automation', score: 1.5 },
  { pattern: /\b(our\s+(?:staff|team|people|employee).{1,40}(?:enter|type|fill|input|update|write)|manually.{1,30}(?:enter|type|update|transfer|copy|move))/i, service: 'automation', score: 1.5 },
  { pattern: /\b(one\s+by\s+one|row\s+by\s+row|goes\s+through\s+each|checks\s+every|individually\s+(?:update|enter|review))\b/i, service: 'automation', score: 1.2 },
  // Analytics — indirect descriptions of visibility gaps / guesswork
  { pattern: /\b(no\s+(?:real[- ]time|clear|easy)\s+(?:view|way\s+to\s+see|way\s+to\s+know)|flying\s+blind|gut\s+(?:feel|instinct)|rely\s+on\s+guess|don'?t\s+know\s+(?:how\s+many|what|when|if)|hard\s+to\s+know\s+(?:if|when|how))\b/i, service: 'analytics', score: 1.5 },
  { pattern: /\b(pull\s+(?:data|numbers|reports?)\s+(?:manually|from\s+multiple)|spreadsheet.{1,20}to\s+track|email.{1,20}update|ask.{1,20}for\s+(?:the\s+)?number)\b/i, service: 'analytics', score: 1.2 },
  // AI — indirect descriptions of matching / selection overload
  { pattern: /\b(find.{1,25}right.{1,25}(?:person|candidate|vendor|supplier|match|product)|hard\s+to\s+(?:pick|choose|select|shortlist)|too\s+many\s+(?:option|choice|applicant|resume|application|profile))\b/i, service: 'ai_solutions', score: 1.5 },
  { pattern: /\b(sift\s+through|sort\s+through|go\s+through\s+(?:all|hundreds|thousands)|manually\s+(?:screen|review|evaluate|rank|score))\b/i, service: 'ai_solutions', score: 1.2 },
];

// Pivot question intents for each target service
const PIVOT_INTENTS = {
  automation: {
    questionIntent: 'Pivot to explore Process Automation: ask about manual, repetitive, or time-consuming tasks',
    evidenceGap: 'automation_signal',
    targetDimension: 'processDocumentation'
  },
  analytics: {
    questionIntent: 'Pivot to explore Data Analytics: ask about visibility, tracking, or reporting gaps',
    evidenceGap: 'analytics_signal',
    targetDimension: 'impactQuantification'
  },
  ai_solutions: {
    questionIntent: 'Pivot to explore AI Solutions: ask about intelligent matching, prediction, or screening needs',
    evidenceGap: 'ai_signal',
    targetDimension: 'opportunityDepth'
  }
};

class QuestionPlanner extends Engine {
  constructor() {
    super();
  }

  async execute(input, context) {
    this.validateInput(input);

    const nextQuestion = this.planNextQuestion(
      input.uncertaintyMatrix,
      input.saturation,
      input.featureVector,
      input.conversationHistory,
      input.evidence || [],
      input.previousTargetDimension || null,
      input.zeroFactsExtracted || false,
      input.opportunities || [],
      input.unanswerableDimensions || [],
      input.topicShiftDetected || false,
      input.lockedServiceTypes || [],
      input.pendingServiceTypes || [],
      input.contradictions || [],
      input.evadedDimensions || []          // Issues 1 & 5: persistent evasion memory
    );

    const output = { nextQuestion };
    this.validateOutput(output);
    return output;
  }

  validateInput(input) {
    if (!input.uncertaintyMatrix || typeof input.uncertaintyMatrix !== 'object') {
      throw new Error('QuestionPlanner: uncertaintyMatrix required (object)');
    }
    if (!input.saturation || typeof input.saturation !== 'object') {
      throw new Error('QuestionPlanner: saturation required (object)');
    }
    if (!Array.isArray(input.featureVector)) {
      throw new Error('QuestionPlanner: featureVector required (array)');
    }
    if (!Array.isArray(input.conversationHistory)) {
      throw new Error('QuestionPlanner: conversationHistory required (array)');
    }
    if (input.evidence && !Array.isArray(input.evidence)) {
      throw new Error('QuestionPlanner: evidence must be array');
    }
    return true;
  }

  planNextQuestion(
    uncertaintyMatrix,
    saturation,
    featureVector,
    conversationHistory,
    evidence = [],
    previousTargetDimension = null,
    zeroFactsExtracted = false,
    opportunities = [],
    unanswerableDimensions = [],
    topicShiftDetected = false,
    lockedServiceTypes = [],
    pendingServiceTypes = [],
    contradictions = [],
    evadedDimensions = []                  // Issues 1 & 5: carries evaded dimension history
  ) {
    const turns = Array.isArray(conversationHistory) ? Math.floor(conversationHistory.length / 2) : 0;
    const serviceSignals = this.calculateServiceSignals(evidence);

    // ─── CONTRADICTION RESOLUTION (with loop-prevention) ──────────────────
    // FIX: Prevent infinite contradiction loops. Count past resolution attempts
    // in conversation history and skip contradictions after 1 failed attempt.
    if (contradictions && contradictions.length > 0) {
      // Detect if the last user message was trivial/evasive ("I don't know", etc.)
      const lastUserMsg = this.getLastUserMessage(conversationHistory);
      const isTrivialResponse = this.isTrivialOrEvasive(lastUserMsg);

      // Count how many times we've already attempted contradiction resolution
      const priorResolutionAttempts = this.countContradictionAttempts(conversationHistory);

      // Filter to only contradictions we haven't already tried to resolve
      const unresolvedContradictions = contradictions.filter(contra => {
        const alreadyAsked = this.wasContradictionAskedAbout(contra, conversationHistory);
        return !alreadyAsked;
      });

      // If the user just said "I don't know" to a contradiction question, OR
      // we've already attempted resolution once, skip and move on
      const shouldSkipContradictions = isTrivialResponse || priorResolutionAttempts >= 1;

      if (unresolvedContradictions.length > 0 && !shouldSkipContradictions) {
        const contra = unresolvedContradictions[0];
        return {
          questionIntent: `Resolve contradiction between statement: "${contra.fact_a}" and statement: "${contra.fact_b}"`,
          evidenceGap: 'clarificationNeeded',
          targetDimension: 'problemUnderstanding',
          reasoning: `Contradiction detected: ${contra.fact_a} vs ${contra.fact_b}. Triggering clarification loop to resolve (attempt ${priorResolutionAttempts + 1}).`,
          expected_saturation_gain: 0.1,
          serviceSignals
        };
      }
      // If we reach here, contradictions exist but we've exhausted resolution attempts.
      // Log them as unresolvable risks and continue with normal question planning.
    }

    const dimensionToService = {
      processDocumentation: 'automation',
      toolStackClarity: 'automation',
      impactQuantification: 'analytics',
      opportunityDepth: 'ai_solutions'
    };
    const unanswerableServices = unanswerableDimensions.map(d => dimensionToService[d] || d);

    // ─── PHASE E: CLOSE — New smart turn-cap flowchart (Issue 4) ─────────────
    //
    // Rules:
    //  • Hard minimum: 6 turns — NEVER close before turn 6
    //  • Hard maximum: 10 turns — ALWAYS close at turn 10
    //  • Rich early close (turns 6–10): if all 3 services explored AND evidence rich → close
    //  • Consecutive IDK path (after turn 5):
    //      – If lockedServiceTypes >= 2 → ask ONE final context question, then close
    //        (signalled by setting targetDimension = 'final_context_close')
    //      – If lockedServiceTypes < 2  → continue until turn 10 (no early close)
    //  • The ONE-final-question gate: if previousTargetDimension === 'final_context_close'
    //    and zeroFactsExtracted → close immediately.

    const isFinalTurn = turns >= 10;  // Hard cap raised to 10

    // Detect consecutive IDK situation: last 2+ turns were evasive with no facts
    const recentEvasions = this.countRecentEvasions(conversationHistory);
    const consecutiveIdk = recentEvasions >= 2;

    // ONE-FINAL-QUESTION gate: we already asked the final context question last turn,
    // user still gave nothing → close now
    const finalContextAsked = previousTargetDimension === 'final_context_close';
    if (finalContextAsked && zeroFactsExtracted) {
      return {
        questionIntent: 'Close the conversation and prepare the final pitch',
        evidenceGap: 'none',
        targetDimension: 'complete',
        reasoning: 'Final context question yielded no answer. Closing interview.',
        expected_saturation_gain: 0,
        serviceSignals
      };
    }

    // Consecutive IDK path (only after turn 5, not before turn 6 is completed)
    if (consecutiveIdk && turns >= 5 && !isFinalTurn) {
      if (lockedServiceTypes.length >= 2) {
        // Have ≥2 strong leads → ask ONE final context question then close
        return {
          questionIntent: 'Ask ONE final context question based on the strongest evidence gathered so far',
          evidenceGap: 'final_context_evidence',
          targetDimension: 'final_context_close',
          reasoning: `Consecutive IDK after turn ${turns}. ${lockedServiceTypes.length} leads locked (${lockedServiceTypes.join(',')}). Asking final context question before closing.`,
          expected_saturation_gain: 0.05,
          serviceSignals
        };
      }
      // < 2 leads locked → do NOT close early; let it run to turn 10
      // Fall through to normal planning below
    }

    // Rich evidence early close (turns 6–10)
    const exploredServices = new Set([
      ...lockedServiceTypes,
      ...unanswerableServices.filter(s => ['automation', 'analytics', 'ai_solutions'].includes(s))
    ]);
    const allExplored = exploredServices.size >= 3 && evidence.length >= 6;
    const hasOverwhelmingSignal = lockedServiceTypes.length >= 2 && evidence.length >= 8;
    const isReadyToPitch = turns >= 6 && (allExplored || hasOverwhelmingSignal);

    // Early sign-off: multiple unanswerable dimensions (only after turn 6)
    const shouldCloseEarly = turns >= 6 && unanswerableDimensions.length >= 2;

    if (isFinalTurn || shouldCloseEarly || isReadyToPitch) {
      return {
        questionIntent: 'Close the conversation and prepare the final pitch',
        evidenceGap: 'none',
        targetDimension: 'complete',
        reasoning: isFinalTurn
          ? 'Hard turn limit reached (Turn 10).'
          : isReadyToPitch
            ? `Services explored (locked=${lockedServiceTypes.join(',')}, turns=${turns}). Finalizing pitch.`
            : 'Early sign-off: multiple unanswerable dimensions.',
        expected_saturation_gain: 0,
        serviceSignals
      };
    }

    // ─── PHASE C: PIVOT ───────────────────────────────────────────────────────
    // If any service is locked AND there are unexplored services → PIVOT NOW
    if (lockedServiceTypes.length > 0) {
      const unexplored = ALL_SERVICES.filter(s =>
        !lockedServiceTypes.includes(s) &&
        !unanswerableServices.includes(s)
      );

      if (unexplored.length > 0 && turns < 7) {
        const pivotAttempts = this.countPivotAttempts(conversationHistory);

        // Sort unexplored services by prior attempts ascending, then signal descending
        const sortedUnexplored = [...unexplored].sort((a, b) => {
          const attemptsA = pivotAttempts[a] || 0;
          const attemptsB = pivotAttempts[b] || 0;
          if (attemptsA !== attemptsB) {
            return attemptsA - attemptsB; // Fewer attempts first
          }
          const sigA = serviceSignals[a] || 0;
          const sigB = serviceSignals[b] || 0;
          return sigB - sigA; // Higher signal first
        });

        const targetService = sortedUnexplored[0];
        const maxSignal = serviceSignals[targetService] || 0;

        const pivotDef = PIVOT_INTENTS[targetService];
        return {
          questionIntent: pivotDef.questionIntent,
          evidenceGap: pivotDef.evidenceGap,
          targetDimension: pivotDef.targetDimension,
          reasoning: `PIVOT: ${lockedServiceTypes.join(',')} locked. Pivoting to explore ${targetService}. Signal=${maxSignal.toFixed(1)}.`,
          expected_saturation_gain: 0.2,
          serviceSignals,
          pivotingToService: targetService
        };
      }
    }

    // ─── PHASE D: SOLIDIFY (turns 7+) ─────────────────────────────────────────
    const isSolidifyMode = turns >= 7;

    // ─── PHASE A: DETECT / GAP FILL ───────────────────────────────────────────
    // No services locked yet, or we're in solidify mode
    const targetDimension = this.selectBestDimension(
      uncertaintyMatrix,
      evidence,
      previousTargetDimension,
      zeroFactsExtracted,
      opportunities,
      turns,
      unanswerableDimensions,
      serviceSignals,
      topicShiftDetected,
      lockedServiceTypes,
      isSolidifyMode,
      evadedDimensions              // Issues 1 & 5: pass evaded dimensions down
    );

    const uncertaintyData = uncertaintyMatrix[targetDimension] || {};
    const evidenceGap = (uncertaintyData.evidence_needed && uncertaintyData.evidence_needed[0]) || 'missing_evidence';
    const saturationGain = this.estimateSaturationGain(targetDimension, saturation);

    return {
      questionIntent: this.buildIntent(targetDimension, evidenceGap, serviceSignals, lockedServiceTypes),
      evidenceGap,
      targetDimension,
      reasoning: `GAP-FILL: Target=${targetDimension}; est.gain=${(saturationGain * 100).toFixed(0)}%. Signals: Auto=${serviceSignals.automation.toFixed(1)}, AI=${serviceSignals.ai_solutions.toFixed(1)}, Analytics=${serviceSignals.analytics.toFixed(1)}. Locked=${lockedServiceTypes.join(',') || 'none'}`,
      expected_saturation_gain: saturationGain,
      serviceSignals
    };
  }

  // ─── Service Signal Calculator ────────────────────────────────────────────
  calculateServiceSignals(evidence) {
    let scores = { automation: 0, analytics: 0, ai_solutions: 0 };

    const analyticsWords = /\b(visibility|blind|measure|report|track|dashboard|trends|analytics|analyse|analyze|analysis|insight|insights|visualize|inventory|stock|demand|godown|warehouse|levels|turnover|quantity|quantities|monitor|performance|shortage|overstock|reorder|forecast|capacity|utilization|kpi|metric|metrics|data\s+gap|no\s+data)\b/i;
    const automationWords = /\b(manual|repetitive|excel|copy|steps|workflow|spreadsheet|schedule|scheduling|admin|automate|automation|automating|script|error|mistake|delay|slow|time-consuming|paperwork|data\s+entry|re-?enter|tedious)\b/i;
    const aiWords = /\b(predict|forecast|ai|artificial\s+intelligence|intelligent|ml|machine\s+learning|smart|recommendation|match|matching|screening|screen|shortlist|evaluate|rank|ranking|relevant|relevance|candidate|cognitive|optimize|optimise|filter|fit|looking\s+for\s+ai|need\s+ai)\b/i;

    for (const item of (evidence || [])) {
      const stmt = item.statement || '';

      // Category-based scoring
      if (item.category === 'process' || item.category === 'tool') scores.automation += 1.0;
      if (item.category === 'metric' || item.category === 'impact') scores.analytics += 1.5;

      // Keyword-based scoring (primary regexes)
      if (analyticsWords.test(stmt)) scores.analytics += 2.0;
      if (automationWords.test(stmt)) scores.automation += 2.0;
      if (aiWords.test(stmt)) scores.ai_solutions += 2.0;

      // Issue 2: Semantic expansion pass — catches indirect/paraphrased language
      for (const entry of SEMANTIC_EXPANSION_MAP) {
        if (entry.pattern.test(stmt)) {
          scores[entry.service] = (scores[entry.service] || 0) + entry.score;
        }
      }
    }
    return scores;
  }

  // ─── Best Dimension Selector (for Phase A gap-fill) ──────────────────────
  selectBestDimension(
    fullMatrix,
    evidence = [],
    previousTargetDimension = null,
    zeroFactsExtracted = false,
    opportunities = [],
    turns = 0,
    unanswerableDimensions = [],
    serviceSignals = {},
    topicShiftDetected = false,
    lockedServiceTypes = [],
    isSolidifyMode = false,
    evadedDimensions = []          // Issues 1 & 5: permanently deprioritise evaded dimensions
  ) {
    let maxScore = -Infinity;
    let selectedDimension = null;

    for (const [dimension, data] of Object.entries(fullMatrix)) {
      let score = (data.currentUncertainty || 0) * (data.impact_if_resolved || 0);

      // Persistent penalty: unanswerable dimensions
      if (unanswerableDimensions.includes(dimension)) {
        score -= 1000.0;
      }

      // Issues 1 & 5: Persistent penalty for evaded dimensions (user said "I don't know" / "skip")
      // Same magnitude as unanswerableDimensions so they never win the scoring race.
      if (evadedDimensions.includes(dimension)) {
        score -= 1000.0;
      }

      // Cascade penalty for dependent dimensions
      if (
        (unanswerableDimensions.includes('processDocumentation') || unanswerableDimensions.includes('rootCauseDepth')) &&
        ['rootCauseDepth', 'userPainQuantification', 'processDocumentation'].includes(dimension)
      ) {
        score -= 1000.0;
      }
      if (unanswerableDimensions.includes('toolStackClarity') && dimension === 'rootCauseDepth') {
        score -= 1000.0;
      }

      // Strong penalty on opportunityDepth for already-locked services
      if (dimension === 'opportunityDepth') {
        if (lockedServiceTypes.length > 0) {
          // Already have locked services — stop asking about opportunityDepth in gap-fill mode
          // (Pivot mode handles this directly above)
          score -= 100.0;
        } else {
          // No services locked yet: boost based on signals to try to detect first service
          score += (serviceSignals.automation || 0) * 1.5;
          score += (serviceSignals.analytics || 0) * 1.5;
          score += (serviceSignals.ai_solutions || 0) * 1.5;
        }
      }

      if (!isSolidifyMode) {
        // Boost dimensions that match current evidence signals
        if (data.currentUncertainty > 0.2) {
          if ((dimension === 'toolStackClarity' || dimension === 'processDocumentation') && !lockedServiceTypes.includes('automation')) {
            score += (serviceSignals.automation || 0) * 1.5;
          }
          if (dimension === 'impactQuantification' && !lockedServiceTypes.includes('analytics')) {
            score += (serviceSignals.analytics || 0) * 1.5;
          }
        }
      } else {
        // SOLIDIFY: stop exploring, strengthen known services
        if (dimension === 'opportunityDepth') score -= 30.0;
        if (dimension === 'evidenceCompleteness' && lockedServiceTypes.length > 0) score += 15.0;
      }

      // Topic shift: reset focus to core understanding
      if (topicShiftDetected && (dimension === 'problemUnderstanding' || dimension === 'rootCauseDepth')) {
        score += 50.0;
      }

      // Loop prevention
      if (zeroFactsExtracted && dimension === previousTargetDimension) {
        score -= 500.0;
      } else if (!zeroFactsExtracted && dimension === previousTargetDimension) {
        score -= 100.0;
      }

      if (score > maxScore) {
        maxScore = score;
        selectedDimension = dimension;
      }
    }

    if (!selectedDimension) {
      const dims = Object.keys(fullMatrix);
      selectedDimension = dims.length > 0 ? dims[0] : 'problemUnderstanding';
    }

    return selectedDimension;
  }

  estimateSaturationGain(dimension, saturation) {
    const saturationData = saturation.saturation || {};
    const currentValue = saturationData[dimension] || 0;
    const gap = Math.max(0, 0.8 - currentValue);
    return Math.min(1.0, gap * 0.5);
  }

  buildIntent(dimension, evidenceGap, serviceSignals = {}, lockedServiceTypes = []) {
    const intents = {
      problemUnderstanding: `Clarify the core problem`,
      impactQuantification: `Quantify the impact`,
      rootCauseDepth: `Explore root causes`,
      processDocumentation: `Explore manual processes and workflows`,
      toolStackClarity: `Identify software tools and system gaps`,
      opportunityDepth: `Expand opportunity scope`,
      userPainQuantification: `Quantify user pain and operational friction`,
      evidenceCompleteness: `Gather supporting details`
    };

    let intent = intents[dimension] || `Gather evidence on: ${evidenceGap}`;

    // Specific pivot intent label when in gap-fill for opportunityDepth with no locked services
    if (dimension === 'opportunityDepth' && lockedServiceTypes.length === 0) {
      const topSignal = Object.entries(serviceSignals).sort((a, b) => b[1] - a[1])[0];
      if (topSignal && topSignal[1] > 0) {
        if (topSignal[0] === 'analytics') intent = `Pivot topic to probe for Data Analytics or Reporting opportunities`;
        else if (topSignal[0] === 'automation') intent = `Pivot topic to probe for Process Automation opportunities`;
        else if (topSignal[0] === 'ai_solutions') intent = `Pivot topic to probe for AI Solutions opportunities`;
      }
    }

    return intent;
  }

  // ─── Contradiction Loop Prevention Helpers ──────────────────────────────

  /**
   * Extract the last user message text from conversation history.
   */
  getLastUserMessage(conversationHistory) {
    if (!Array.isArray(conversationHistory)) return '';
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      if (conversationHistory[i].role === 'user') {
        return (conversationHistory[i].text || '').trim();
      }
    }
    return '';
  }

  /**
   * Detect if a user message is trivial, evasive, or uninformative.
   * Covers "I don't know", "no idea", gibberish, etc.
   */
  isTrivialOrEvasive(message) {
    if (!message) return true;
    const lower = message.toLowerCase().trim();
    if (lower.length < 3) return true;

    const trivialPatterns = [
      /^i\s*don'?t\s*know/i,
      /^no\s*idea/i,
      /^not\s*sure/i,
      /^i\s*do\s*not\s*know/i,
      /^can'?t\s*say/i,
      /^i\s*have\s*no\s*idea/i,
      /^maybe$/i,
      /^perhaps$/i,
      /^nothing$/i,
      /^none$/i,
      /^na$/i,
      /^n\/a$/i,
      /^no$/i,
      /^yes$/i,
      /^ok(ay)?$/i,
      /^idk$/i,
      /^dunno$/i,
      /^not really$/i,
      /^i\s*am\s*not\s*sure/i,
      /^i\s*can'?t\s*answer/i,
      /^no\s*comment/i,
      /^skip$/i,
      /^pass$/i
    ];

    return trivialPatterns.some(pattern => pattern.test(lower));
  }

  /**
   * Count how many times the assistant has already asked a contradiction-resolution
   * question in the conversation history (by scanning for keywords like "clarify",
   * "contradiction", "discrepancy").
   */
  countContradictionAttempts(conversationHistory) {
    if (!Array.isArray(conversationHistory)) return 0;
    let count = 0;
    const contradictionKeywords = /\b(clarify|contradiction|discrepancy|conflicting|contradicted|inconsisten)/i;
    for (const msg of conversationHistory) {
      if (msg.role === 'assistant' && contradictionKeywords.test(msg.text || '')) {
        count++;
      }
    }
    return count;
  }

  /**
   * Check if a specific contradiction has already been asked about by scanning
   * the assistant's messages for keywords from the contradiction's fact_a or fact_b.
   */
  wasContradictionAskedAbout(contradiction, conversationHistory) {
    if (!Array.isArray(conversationHistory)) return false;
    const factAWords = (contradiction.fact_a || '').toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const factBWords = (contradiction.fact_b || '').toLowerCase().split(/\s+/).filter(w => w.length > 4);

    for (const msg of conversationHistory) {
      if (msg.role !== 'assistant') continue;
      const text = (msg.text || '').toLowerCase();

      // Check if the assistant's message references both sides of the contradiction
      const matchesA = factAWords.filter(w => text.includes(w)).length >= 2;
      const matchesB = factBWords.filter(w => text.includes(w)).length >= 2;
      if (matchesA && matchesB) return true;
    }
    return false;
  }

  /**
   * Count how many of the most-recent consecutive turns had zero meaningful facts
   * (i.e. the user gave evasive / "I don't know" answers back-to-back).
   * Used by the Issue 4 flowchart to detect the consecutive-IDK path.
   */
  countRecentEvasions(conversationHistory) {
    if (!Array.isArray(conversationHistory)) return 0;
    let count = 0;
    // Scan from the end, counting consecutive user turns that were trivial
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      if (conversationHistory[i].role === 'user') {
        if (this.isTrivialOrEvasive(conversationHistory[i].text || '')) {
          count++;
        } else {
          break; // Stop at first substantive answer
        }
      }
    }
    return count;
  }

  /**
   * Count pivot attempts per service from assistant messages.
   */
  countPivotAttempts(conversationHistory) {
    const counts = { automation: 0, analytics: 0, ai_solutions: 0 };
    if (!Array.isArray(conversationHistory)) return counts;

    for (const msg of conversationHistory) {
      if (msg.role === 'assistant' || msg.role === 'silk') {
        const text = (msg.text || '').toLowerCase();
        if (/\b(visibility|blind|measure|report|track|dashboard|trends|analytics|analyse|analyze|analysis|kpi|metric|metrics)\b/i.test(text)) {
          counts.analytics++;
        }
        if (/\b(manual|repetitive|excel|spreadsheet|automate|automation|copy|data\s+entry)\b/i.test(text)) {
          counts.automation++;
        }
        if (/\b(predict|forecast|ai|intelligence|ml|matching|screening|recommendation|pattern)\b/i.test(text)) {
          counts.ai_solutions++;
        }
      }
    }
    return counts;
  }

  validateOutput(output) {
    if (!output.nextQuestion) throw new Error('QuestionPlanner: nextQuestion required');
    if (typeof output.nextQuestion.questionIntent !== 'string') throw new Error('QuestionPlanner: questionIntent required (string)');
    if (typeof output.nextQuestion.targetDimension !== 'string') throw new Error('QuestionPlanner: targetDimension required (string)');
    return true;
  }
}

export default QuestionPlanner;
