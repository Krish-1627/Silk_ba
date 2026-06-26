/**
 * ConversationLayer
 *
 * Type: M4 Milestone 1 Controlled Realization
 * Purpose: Realize QuestionPlanner intent into user-facing language without changing planner ownership.
 *
 * Guardrails:
 * - Consumes QuestionPlanner outputs only.
 * - Must not select or mutate objectives.
 * - Must not reprioritize questions.
 * - Must not modify completion or opportunity decisions.
 * - All language generation goes through the M1a control plane.
 * - Fails closed when controlled realization is unavailable or invalid.
 */

import { Engine } from '../types/index.js';

const FORBIDDEN_RESPONSE_FIELDS = Object.freeze([
  'priority',
  'completionDecision',
  'completed',
  'opportunityDecision',
  'opportunityPriority',
  'selectedObjective',
  'nextObjective'
]);

const SemanticMapper = {
  translate(plan) {
    const intentMap = {
      'Clarify the core problem': 'Identify the primary business challenge',
      'Quantify the impact': 'Quantify the business cost or frequency',
      'Explore root causes': 'Investigate underlying bottlenecks and constraints',
      'Expand opportunity scope': 'Discover improvement opportunities',
      'Gather supporting details': 'Gather supporting details and examples',
      'Explore manual processes and workflows': 'Understand the manual workflows and step-by-step processes',
      'Identify software tools and system gaps': 'Identify the systems, applications, and technology gaps',
      'Quantify user pain and operational friction': 'Understand team friction, overstretch, and user pain',
      // Confirm intents
      'Confirm and quantify the manual process burden': 'Confirm the extent and frequency of manual work',
      'Confirm visibility gaps and measurement needs': 'Confirm what data visibility or reporting is missing',
      'Confirm intelligent decision-making or matching requirements': 'Confirm where AI-based matching or prediction is needed',
      // Pivot intents
      'Pivot topic to probe for Data Analytics or Reporting opportunities': 'Explore if there are data visibility or reporting challenges',
      'Pivot topic to probe for Process Automation opportunities': 'Explore if there are manual or repetitive process challenges',
      'Pivot topic to probe for AI Solutions or intelligent decision-making opportunities': 'Explore if intelligent matching, screening, or prediction would help',
      'Pivot to explore Process Automation: ask about manual, repetitive, or time-consuming tasks': 'Explore if there are manual or repetitive process challenges',
      'Pivot to explore Data Analytics: ask about visibility, tracking, or reporting gaps': 'Explore if there are data visibility or reporting challenges',
      'Pivot to explore AI Solutions: ask about intelligent matching, prediction, or screening needs': 'Explore if intelligent matching, screening, or prediction would help'
    };

    const gapMap = {
      'automation_signal': 'Identify processes that can be automated',
      'ai_signal': 'Identify intelligent assistance opportunities',
      'analytics_signal': 'Investigate visibility limitations',
      'constraint': 'Identify bottlenecks',
      'handoff': 'Investigate workflow transitions',
      'system_dependency': 'Identify technical limitations',
      'metric': 'Determine the exact volume, frequency, or cost',
      'volume': 'Measure the scale of the process',
      'time_saved': 'Estimate potential time savings',
      'problem_statement': 'Define the problem clearly',
      'pain_point': 'Identify the most painful part of the current state',
      'current_process': 'Map out the current process steps',
      'missing_evidence': 'Find concrete examples of the issue',
      'additional_example': 'Gather more examples',
      'supporting_detail': 'Gather supporting details',
      'process_definition': 'Map out the step-by-step sequential workflow',
      'workflow_step': 'Describe specific step-by-step tasks or hands-on activities',
      'manual_effort': 'Understand where the team spends the most manual time',
      'software_tool': 'List the software applications and systems used',
      'integration_gap': 'Identify where data has to be copied manually between disconnected tools',
      'manual_workaround': 'Identify manual workarounds or spreadsheets used to bridge systems',
      'frustration_signal': 'Understand what tasks cause the most frustration or stress',
      'team_burnout': 'Investigate signs of team overstretch, burnout, or excessive workload',
      'retention_risk': 'Identify if operational friction is causing employee retention risks'
    };

    return {
      businessObjective: intentMap[plan.questionIntent] || plan.questionIntent,
      targetEvidence: gapMap[plan.evidenceGap] || plan.evidenceGap,
      internalMetadata: {
        intent: plan.questionIntent,
        gap: plan.evidenceGap,
        dimension: plan.targetDimension
      }
    };
  }
};

class ConversationLayer extends Engine {
  constructor(options = {}) {
    super();
    this.defaultToneMode = options.defaultToneMode || 'clear';
  }

  async execute(input, context = {}) {
    this.validateInput(input);

    const controlPlane = context?.controlPlane;
    if (!controlPlane || typeof controlPlane.executeTask !== 'function') {
      throw new Error('ConversationLayer: fail-closed, controlPlane.executeTask is required');
    }

    const questionPlan = input.questionPlan;
    const semanticMapping = SemanticMapper.translate(questionPlan);

    const controlPlaneResult = await controlPlane.executeTask({
      component: 'ConversationLayer',
      operation: 'realize_question_text',
      promptId: 'conversation_realize_question_v1',
      payload: {
        questionPlan,
        semanticMapping,
        evidenceContext: input.evidenceContext || [],
        conversationHistory: input.conversationHistory || [],
        style: input.style || this.defaultToneMode,
        variantsRequested: input.variantsRequested || 3
      }
    });

    const response = controlPlaneResult?.response || {};
    this.assertNoOwnershipDrift(response);
    this.assertSemanticFidelity(questionPlan, response);

    const questionText = this.pickQuestionText(response);
    const alternativePhrasings = this.pickAlternativePhrasings(response, questionText);
    const toneMode = this.pickToneMode(response, input.style);

    const output = {
      input,
      realizedQuestion: {
        questionText,
        alternativePhrasings,
        toneMode,
        objective: questionPlan.questionIntent,
        evidenceGap: questionPlan.evidenceGap,
        targetDimension: questionPlan.targetDimension,
        reasoning: questionPlan.reasoning,
        expected_saturation_gain: questionPlan.expected_saturation_gain
      },
      semanticFidelity: {
        objectivePreserved: true,
        evidenceGapPreserved: true,
        targetDimensionPreserved: true,
        sourcePlanFingerprint: this.buildPlanFingerprint(questionPlan)
      },
      methodTrace: {
        path: 'controlled_realization',
        controlPlaneOperation: 'ConversationLayer.realize_question_text',
        variantsCount: alternativePhrasings.length + 1,
        auditEventTypes: Array.isArray(controlPlaneResult?.auditTrail)
          ? controlPlaneResult.auditTrail.map(event => event.eventType)
          : []
      }
    };

    this.validateOutput(output);
    return output;
  }

  assertNoOwnershipDrift(response) {
    for (const field of FORBIDDEN_RESPONSE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(response, field)) {
        throw new Error(`ConversationLayer: ownership drift prohibited (${field})`);
      }
    }
  }

  assertSemanticFidelity(questionPlan, response) {
    const echoedObjective = response.objective ?? response.questionIntent ?? response.metadata?.objective;
    const echoedEvidenceGap = response.evidenceGap ?? response.metadata?.evidenceGap;
    const echoedTargetDimension = response.targetDimension ?? response.metadata?.targetDimension;

    if (echoedObjective && echoedObjective !== questionPlan.questionIntent) {
      throw new Error('ConversationLayer: objective mutation prohibited');
    }
    if (echoedEvidenceGap && echoedEvidenceGap !== questionPlan.evidenceGap) {
      throw new Error('ConversationLayer: evidence gap mutation prohibited');
    }
    if (echoedTargetDimension && echoedTargetDimension !== questionPlan.targetDimension) {
      throw new Error('ConversationLayer: target dimension mutation prohibited');
    }
  }

  pickQuestionText(response) {
    const questionText = response.questionText || response.renderedText || response.primaryText;
    if (typeof questionText !== 'string' || !questionText.trim()) {
      throw new Error('ConversationLayer: fail-closed, questionText required from control plane');
    }
    return questionText.trim();
  }

  pickAlternativePhrasings(response, questionText) {
    const rawAlternatives = Array.isArray(response.alternativePhrasings)
      ? response.alternativePhrasings
      : Array.isArray(response.variants)
        ? response.variants
        : [];

    return rawAlternatives
      .filter(item => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
      .filter(item => item !== questionText)
      .slice(0, 3);
  }

  pickToneMode(response, inputStyle) {
    const toneMode = response.toneMode || response.style || inputStyle || this.defaultToneMode;
    return typeof toneMode === 'string' && toneMode.trim() ? toneMode.trim() : this.defaultToneMode;
  }

  buildPlanFingerprint(questionPlan) {
    return [
      questionPlan.questionIntent,
      questionPlan.evidenceGap,
      questionPlan.targetDimension,
      questionPlan.expected_saturation_gain
    ].join('|');
  }

  validateInput(input) {
    const questionPlan = input?.questionPlan;
    if (!questionPlan || typeof questionPlan !== 'object') {
      throw new Error('ConversationLayer: questionPlan required (object)');
    }
    if (typeof questionPlan.questionIntent !== 'string' || !questionPlan.questionIntent.trim()) {
      throw new Error('ConversationLayer: questionIntent required (string)');
    }
    if (typeof questionPlan.evidenceGap !== 'string' || !questionPlan.evidenceGap.trim()) {
      throw new Error('ConversationLayer: evidenceGap required (string)');
    }
    if (typeof questionPlan.targetDimension !== 'string' || !questionPlan.targetDimension.trim()) {
      throw new Error('ConversationLayer: targetDimension required (string)');
    }
    if (typeof questionPlan.reasoning !== 'string') {
      throw new Error('ConversationLayer: reasoning required (string)');
    }
    if (typeof questionPlan.expected_saturation_gain !== 'number') {
      throw new Error('ConversationLayer: expected_saturation_gain required (number)');
    }
    return true;
  }

  validateOutput(output) {
    if (!output.realizedQuestion || typeof output.realizedQuestion !== 'object') {
      throw new Error('ConversationLayer: realizedQuestion required');
    }
    if (typeof output.realizedQuestion.questionText !== 'string' || !output.realizedQuestion.questionText.trim()) {
      throw new Error('ConversationLayer: questionText required');
    }
    if (!Array.isArray(output.realizedQuestion.alternativePhrasings)) {
      throw new Error('ConversationLayer: alternativePhrasings must be array');
    }
    if (!output.semanticFidelity || typeof output.semanticFidelity !== 'object') {
      throw new Error('ConversationLayer: semanticFidelity required');
    }
    if (!output.methodTrace || typeof output.methodTrace !== 'object') {
      throw new Error('ConversationLayer: methodTrace required');
    }
    return true;
  }
}

export default ConversationLayer;
