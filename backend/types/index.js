/**
 * Shared Type Definitions and Constants
 * Purpose: Central repository for all engine contracts and state structures
 * 
 * This file defines the shape of data flowing through the engine pipeline.
 * All engines must conform to these contracts.
 */

// ============================================================================
// FACT TYPES
// ============================================================================

/**
 * @typedef {Object} Fact
 * @property {string} factId - Unique identifier (fact_NNN)
 * @property {string} type - problem|tool|process|metric|constraint|risk
 * @property {string} statement - The actual fact statement
 * @property {number} confidence - 0.0-1.0 confidence score
 * @property {string} source - Where this fact came from (e.g., "user statement")
 * @property {number} turnNumber - Conversation turn where fact was extracted
 */

// ============================================================================
// EVIDENCE TYPES
// ============================================================================

/**
 * @typedef {Object} Evidence
 * @property {string} evidenceId - Unique identifier (ev_NNN)
 * @property {string} category - operational_fact|metric|constraint|risk
 * @property {string} statement - The normalized evidence statement
 * @property {number} confidence - 0.0-1.0 confidence level
 * @property {string[]} sources - Array of fact IDs that support this evidence
 * @property {Evidence[]} contradictions - Array of contradicting evidence
 * @property {string} updatedAt - ISO8601 timestamp
 */

/**
 * @typedef {Object} EvidenceRegistryOutput
 * @property {Evidence[]} evidence - Complete evidence set
 * @property {number} coverageScore - 0.0-1.0 completeness score
 * @property {string[]} gaps - Pre-defined categories where evidence is missing
 */

// ============================================================================
// ORGANIZATION MODEL TYPES
// ============================================================================

/**
 * @typedef {Object} HandoffPoint
 * @property {string} from - Source role
 * @property {string} to - Destination role
 * @property {string} process - Process name
 * @property {string} riskLevel - low|medium|high
 */

/**
 * @typedef {Object} Organization
 * @property {string} primaryProblem - Main problem statement
 * @property {string[]} affectedProcesses - List of affected processes
 * @property {string[]} tools - Tools currently in use
 * @property {string[]} manualSteps - Manual steps in processes
 * @property {HandoffPoint[]} handoffPoints - Handoff points between roles
 * @property {string[]} constraints - Constraints and limitations
 */

/**
 * @typedef {Object} OrganizationModelOutput
 * @property {Organization} organization - The org model
 * @property {number} modelQuality - 0.0-1.0 quality score
 */

// ============================================================================
// FEATURE VECTOR TYPES
// ============================================================================

/**
 * @typedef {Object} Features
 * @property {number} problemClarity - 0.0-1.0
 * @property {number} impactQuantification - 0.0-1.0
 * @property {number} rootCauseDepth - 0.0-1.0
 * @property {number} processDocumentation - 0.0-1.0
 * @property {number} toolStackClarity - 0.0-1.0
 * @property {number} riskIdentification - 0.0-1.0
 * @property {number} opportunityAlignment - 0.0-1.0
 * @property {number} userPainQuantification - 0.0-1.0
 */

/**
 * @typedef {Object} FeatureVectorOutput
 * @property {Features} features - Individual feature dimensions
 * @property {number[]} featureVector - Normalized vector of feature values
 */

// ============================================================================
// OPPORTUNITY TYPES
// ============================================================================

/**
 * @typedef {Object} Opportunity
 * @property {string} opportunityId - Unique identifier (opp_NNN)
 * @property {string} serviceType - ai_solutions|automation|analytics
 * @property {string} problem - Problem statement
 * @property {string} rootCause - Root cause statement
 * @property {string[]} evidence - Evidence IDs supporting this opportunity
 * @property {string} viability - low|medium|high
 * @property {string} implementationBarrier - Barrier description
 * @property {number} potentialTimesSaved - Hours or units saved
 * @property {number} potentialErrorReduction - 0.0-1.0
 * @property {string} strategicImportance - tactical|growth_enabling|risk_reduction
 */

/**
 * @typedef {Object} OpportunityQualificationOutput
 * @property {Opportunity[]} opportunities - Array of opportunities
 * @property {number} opportunityCount - Count of opportunities
 * @property {Object} serviceDistribution - Distribution by service type
 * @property {number} serviceDistribution.ai_solutions
 * @property {number} serviceDistribution.automation
 * @property {number} serviceDistribution.analytics
 */

// ============================================================================
// CONFIDENCE TYPES
// ============================================================================

/**
 * @typedef {Object} OrganizationUnderstanding
 * @property {number} problem - 0.0-1.0
 * @property {number} rootCause - 0.0-1.0
 * @property {number} impact - 0.0-1.0
 * @property {number} riskProfile - 0.0-1.0
 */

/**
 * @typedef {Object} ConfidenceCalculatorOutput
 * @property {Object} opportunityConfidence - Map of opportunityId to confidence
 * @property {OrganizationUnderstanding} organizationUnderstanding - Org confidence
 * @property {number} overallConfidence - 0.0-1.0
 * @property {Object} confidenceRationale - Map of opportunityId to rationale
 */

// ============================================================================
// SATURATION TYPES
// ============================================================================

/**
 * @typedef {Object} SaturationDimension
 * @property {number} problemUnderstanding - 0.0-1.0
 * @property {number} impactQuantification - 0.0-1.0
 * @property {number} rootCauseDepth - 0.0-1.0
 * @property {number} opportunityDepth - 0.0-1.0
 * @property {number} evidenceCompleteness - 0.0-1.0
 */

/**
 * @typedef {Object} Gap
 * @property {string} dimension - Dimension name
 * @property {number} currentScore - 0.0-1.0
 * @property {number} minimumRequired - 0.0-1.0
 * @property {number} deficit - gap amount
 */

/**
 * @typedef {Object} SaturationEngineOutput
 * @property {SaturationDimension} saturation - Saturation by dimension
 * @property {number} overallSaturation - 0.0-1.0
 * @property {Object} readiness - Readiness assessment
 * @property {boolean} readiness.forRecommendation
 * @property {string} readiness.rationale
 * @property {Gap[]} gaps - Array of gaps
 */

// ============================================================================
// UNCERTAINTY TYPES
// ============================================================================

/**
 * @typedef {Object} UncertaintyDimension
 * @property {number} currentUncertainty - 0.0-1.0
 * @property {string[]} evidence_needed - Evidence categories needed
 * @property {number} impact_if_resolved - 0.0-1.0 impact of resolution
 * @property {string} priority - critical|high|medium|low
 */

/**
 * @typedef {Object} HighestImpactQuestion
 * @property {string} objective - Question intent
 * @property {string} evidenceGap - Gap to address
 * @property {number} expectedUncertaintyReduction - 0.0-1.0
 */

/**
 * @typedef {Object} UncertaintyMatrixOutput
 * @property {Object} uncertaintyMap - Map of dimension to uncertainty
 * @property {HighestImpactQuestion} highestImpactQuestion - Next question
 */

// ============================================================================
// QUESTION PLANNING TYPES
// ============================================================================

/**
 * @typedef {Object} NextQuestion
 * @property {string} questionIntent - Intent/objective of question
 * @property {string} evidenceGap - Gap being addressed
 * @property {string} targetDimension - Feature dimension being addressed
 * @property {string} reasoning - Why this question
 * @property {number} expected_saturation_gain - Expected improvement
 * @property {string} conversational_hint - Tone/style hint for LLM
 */

/**
 * @typedef {Object} QuestionPlannerOutput
 * @property {NextQuestion} nextQuestion - The planned question
 */

// ============================================================================
// PRIORITY/SCORING TYPES
// ============================================================================

/**
 * @typedef {Object} ScoreBreakdown
 * @property {number} impact - 0-40
 * @property {number} volume - 0-20
 * @property {number} timeSaved - 0-20
 * @property {number} riskReduction - 0-10
 * @property {number} strategicImportance - 0-10
 */

/**
 * @typedef {Object} PriorityEngineOutput
 * @property {string} opportunity - Opportunity ID
 * @property {number} businessValueScore - 0-100
 * @property {ScoreBreakdown} scoreBreakdown - Score components
 * @property {string} priority - low|medium|high|critical
 */

// ============================================================================
// CONSISTENCY TYPES
// ============================================================================

/**
 * @typedef {Object} Contradiction
 * @property {string} contradictionId - Unique ID
 * @property {string} fact_a - First fact
 * @property {string} fact_b - Second fact
 * @property {string} severity - low|medium|high
 * @property {boolean} resolution_needed - Needs clarification
 */

/**
 * @typedef {Object} ConsistencyEngineOutput
 * @property {Contradiction[]} contradictions - Array of contradictions
 */

// ============================================================================
// ROOT CAUSE TYPES
// ============================================================================

/**
 * @typedef {Object} RootCauseTree
 * @property {string} problem - Primary problem
 * @property {string[]} immediateRootCauses - Direct causes
 * @property {Object} secondaryRootCauses - Secondary causes by primary cause
 * @property {Object} evidenceMapping - Map of cause to evidence IDs
 */

/**
 * @typedef {Object} RootCauseEngineOutput
 * @property {RootCauseTree} rootCauseTree - The tree structure
 */

// ============================================================================
// COMPLETION TYPES
// ============================================================================

/**
 * @typedef {Object} CompletionCriteria
 * @property {Object} saturation_threshold - Saturation gate status
 * @property {number} saturation_threshold.current - Current value
 * @property {number} saturation_threshold.required - Required value
 * @property {boolean} saturation_threshold.met - Whether met
 * @property {Object} confidence_threshold - Confidence gate status
 * @property {number} confidence_threshold.current
 * @property {number} confidence_threshold.required
 * @property {boolean} confidence_threshold.met
 * @property {Object} evidence_minimum - Evidence count gate
 * @property {number} evidence_minimum.current
 * @property {number} evidence_minimum.required
 * @property {boolean} evidence_minimum.met
 */

/**
 * @typedef {Object} CompletionAuthorityOutput
 * @property {boolean} completed - Interview complete?
 * @property {string} rationale - Why completed or not
 * @property {CompletionCriteria} completionCriteria - Gate status
 * @property {number} estimatedTurnsRemaining - Estimated turns left
 */

// ============================================================================
// EXTRACTION CONFIDENCE GATE TYPES
// ============================================================================

/**
 * @typedef {Object} QualityAssessment
 * @property {boolean} passedGate - Did facts pass quality gate?
 * @property {number} extractionQuality - 0.0-1.0 quality score
 * @property {string[]} riskFactors - Array of risk factors
 * @property {string} recommendation - proceed|clarify|reject
 */

/**
 * @typedef {Object} ExtractionConfidenceGateOutput
 * @property {QualityAssessment} qualityAssessment - Gate result
 * @property {Fact[]} factsApprovedForRegistry - Approved facts
 * @property {boolean} clarificationNeeded - Need clarification?
 * @property {string} clarificationPrompt - Prompt for user
 */

// ============================================================================
// ENGINE STATE TYPES
// ============================================================================

/**
 * @typedef {Object} EngineState
 * @property {Object} factExtraction - FactExtractionEngine output
 * @property {Object} extractionConfidenceGate - Gate output
 * @property {Object} evidenceRegistry - EvidenceRegistry output
 * @property {Object} organizationModel - OrganizationModel output
 * @property {Object} featureVector - FeatureVectorBuilder output
 * @property {Object} opportunityQualification - OpportunityQualificationEngine output
 * @property {Object} confidence - ConfidenceCalculator output
 * @property {Object} saturation - SaturationEngine output
 * @property {Object} uncertaintyMatrix - UncertaintyMatrix output
 * @property {Object} questionPlanning - QuestionPlanner output
 * @property {Object} priority - PriorityEngine output
 * @property {Object} consistency - ConsistencyEngine output
 * @property {Object} rootCause - RootCauseEngine output
 * @property {Object} completionAuthority - CompletionAuthority output
 * @property {string} lastUpdated - ISO8601 timestamp
 */

/**
 * @typedef {Object} LegacyState
 * Purpose: Backward-compatible state for existing UI
 * @property {string[]} deduced_operational_facts - Facts for display
 * @property {Object[]} root_causes - Root cause objects
 * @property {Object[]} ai_opportunities - AI opportunities
 * @property {Object[]} automation_opportunities - Automation opportunities
 * @property {Object[]} analytics_opportunities - Analytics opportunities
 * @property {Object} xray_pillar_clarity_scores - Clarity scores for UI
 * @property {boolean} is_completed - Interview complete?
 * @property {number} interview_completion_percentage - UI progress bar
 */

/**
 * @typedef {Object} DualState
 * @property {EngineState} engineState - Authoritative state from engines
 * @property {LegacyState} legacyState - Backward-compatible state for UI
 * @property {number} schemaVersion - Version of state schema
 * @property {string} timestamp - ISO8601 timestamp
 */

// ============================================================================
// ENGINE INTERFACE DEFINITION
// ============================================================================

/**
 * Base Engine Interface
 * All engines must implement this contract
 */
export class Engine {
  /**
   * Execute the engine
   * @param {Object} input - Engine-specific input object
   * @param {Object} context - Shared context (evidence registry, conversation history)
   * @returns {Promise<Object>} Engine output matching the spec
   */
  async execute(input, context) {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Validate input against engine contract
   * @param {Object} input - Input to validate
   * @returns {boolean} True if valid
   * @throws {Error} If validation fails
   */
  validateInput(input) {
    throw new Error('validateInput() must be implemented by subclass');
  }

  /**
   * Validate output against engine contract
   * @param {Object} output - Output to validate
   * @returns {boolean} True if valid
   * @throws {Error} If validation fails
   */
  validateOutput(output) {
    throw new Error('validateOutput() must be implemented by subclass');
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Types are exported as JSDoc comments above for IDE support.
// Runtime type checking happens in individual engine implementations.
