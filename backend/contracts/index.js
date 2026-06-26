/**
 * Versioned Public Contracts
 *
 * Purpose: Freeze the public interface surface before Phase 1b implementation.
 * These definitions are immutable metadata for the engine pipeline contracts.
 */

const CONTRACT_VERSION = 'v1';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }
  return value;
}

const PUBLIC_CONTRACTS = deepFreeze({
  Fact: {
    fields: ['factId', 'type', 'statement', 'confidence', 'source', 'turnNumber']
  },
  Evidence: {
    fields: ['evidenceId', 'category', 'statement', 'confidence', 'sources', 'contradictions', 'updatedAt']
  },
  Organization: {
    fields: ['primaryProblem', 'affectedProcesses', 'tools', 'manualSteps', 'handoffPoints', 'constraints']
  },
  Opportunity: {
    fields: ['opportunityId', 'serviceType', 'problem', 'rootCause', 'evidence', 'viability', 'implementationBarrier', 'potentialTimesSaved', 'potentialErrorReduction', 'strategicImportance']
  },
  ConfidenceOutput: {
    fields: ['opportunityConfidence', 'organizationUnderstanding', 'overallConfidence', 'confidenceRationale']
  },
  SaturationOutput: {
    fields: ['saturation', 'overallSaturation', 'readiness', 'gaps']
  },
  QuestionPlan: {
    fields: ['nextQuestion']
  },
  DualState: {
    fields: ['engineState', 'legacyState', 'schemaVersion', 'timestamp']
  },
  LegacyState: {
    fields: ['deduced_operational_facts', 'root_causes', 'ai_opportunities', 'automation_opportunities', 'analytics_opportunities', 'xray_pillar_clarity_scores', 'is_completed', 'interview_completion_percentage']
  }
});

const CONTRACT_NAMES = deepFreeze(Object.keys(PUBLIC_CONTRACTS));

const WAVE1_DEPENDENCIES = deepFreeze({
  EvidenceRegistry: ['Fact'],
  FeatureVectorBuilder: ['Organization', 'Evidence'],
  PriorityEngine: ['Opportunity'],
  ConsistencyEngine: ['Evidence'],
  CompletionAuthority: ['SaturationOutput', 'ConfidenceOutput', 'EvidenceCount'],
  LegacyAdapter: ['EvidenceRegistry', 'FeatureVectorBuilder', 'PriorityEngine', 'ConsistencyEngine', 'CompletionAuthority']
});

const WAVE1_FORMULAS = deepFreeze({
  EvidenceRegistry: {
    similarityThreshold: 0.85,
    coverageScore: '((categoryCoverage * 0.7) + (evidenceVolumeScore * 0.3)) capped to [0,1]',
    gaps: ['missing_operational_fact', 'missing_metric', 'missing_constraint', 'missing_risk', 'insufficient_evidence_volume']
  },
  FeatureVectorBuilder: {
    dimensions: [
      'problemClarity = avg(problemPresence, supportDensity, specificity)',
      'impactQuantification = avg(metricEvidence, numericEvidence, impactSignals)',
      'rootCauseDepth = avg(handoffDepth, constraintDepth, causeSignals)',
      'processDocumentation = avg(processCount, manualStepCount, operationalEvidence)',
      'toolStackClarity = avg(toolCount, toolSpecificity, toolEvidence)',
      'riskIdentification = avg(constraintCount, riskEvidence, riskSignals)',
      'opportunityAlignment = avg(manualWorkSignals, toolGapSignals, serviceSignals)',
      'userPainQuantification = avg(painSignals, numericEvidence, problemPresence)'
    ]
  },
  PriorityEngine: {
    impactMap: { low: 10, medium: 25, high: 35, critical: 40 },
    volumeFormula: 'min(20, round(volume / 67))',
    timeSavedFormula: 'min(20, round(timeSaved * 1.05))',
    riskReductionFormula: 'round(riskReduction * 10)',
    strategicImportanceMap: { tactical: 2, growth_enabling: 5, risk_reduction: 8 },
    priorityThresholds: { critical: 90, high: 70, medium: 50 }
  },
  ConsistencyEngine: {
    contradictionTopics: ['manual_vs_automated', 'visibility_vs_blindness', 'metrics_vs_no_metrics', 'integrated_vs_disconnected'],
    severityRule: 'high when avg confidence >= 0.85, medium when avg confidence >= 0.65, otherwise low'
  },
  CompletionAuthority: {
    saturationThreshold: 0.8,
    confidenceThreshold: 0.60,
    evidenceMinimum: 10,
    turnsEstimate: 'ceil((saturationGap * 5) + (confidenceGap * 4) + (evidenceGap / 5))'
  },
  LegacyAdapter: {
    deducedFactsSource: 'evidenceRegistry.evidence[].statement',
    opportunitiesSplit: 'opportunities grouped by serviceType',
    clarityScoresSource: 'featureVector/features mapped to legacy display scores'
  }
});

const WAVE2_DEPENDENCIES = deepFreeze({
  SaturationEngine: ['FeatureVectorBuilder', 'EvidenceRegistry', 'OpportunityQualificationEngine'],
  UncertaintyMatrix: ['SaturationOutput', 'FeatureVectorBuilder', 'OpportunityQualificationEngine']
});

const WAVE2_FORMULAS = deepFreeze({
  SaturationEngine: {
    thresholds: {
      problemUnderstanding: 0.8,
      impactQuantification: 0.8,
      rootCauseDepth: 0.8,
      opportunityDepth: 0.8,
      evidenceCompleteness: 0.8
    },
    dimensions: [
      'problemUnderstanding = avg(featureVector[0], evidenceCoverageScore)',
      'impactQuantification = avg(featureVector[1], metricEvidenceScore)',
      'rootCauseDepth = avg(featureVector[2], constraintDepthScore)',
      'opportunityDepth = avg(featureVector[6], opportunityCoverageScore)',
      'evidenceCompleteness = avg(evidenceCoverageScore, evidenceVolumeScore)'
    ],
    overallSaturation: 'avg(all 5 saturation dimensions)',
    readinessRule: 'true only when every saturation dimension meets threshold'
  },
  UncertaintyMatrix: {
    currentUncertainty: '1 - saturationDimension',
    impactIfResolved: 'currentUncertainty * 0.5 + opportunityRelevance * 0.5',
    priorityOrder: 'sort by (currentUncertainty * impactIfResolved) descending',
    evidenceGapMap: {
      problemUnderstanding: ['problem_statement', 'pain_point', 'current_process'],
      impactQuantification: ['metric', 'volume', 'time_saved'],
      rootCauseDepth: ['constraint', 'handoff', 'system_dependency'],
      opportunityDepth: ['automation_signal', 'ai_signal', 'analytics_signal'],
      evidenceCompleteness: ['missing_evidence', 'additional_example', 'supporting_detail']
    }
  }
});

const WAVE3_DEPENDENCIES = deepFreeze({
  OrganizationModel: ['EvidenceRegistry'],
  OpportunityQualificationEngine: ['OrganizationModel', 'EvidenceRegistry', 'FeatureVectorBuilder'],
  RootCauseEngine: ['EvidenceRegistry', 'OpportunityQualificationEngine'],
  QuestionPlanner: ['UncertaintyMatrix', 'SaturationEngine'],
  ConfidenceCalculator: ['OpportunityQualificationEngine', 'EvidenceRegistry', 'FeatureVectorBuilder']
});

const WAVE3_FORMULAS = deepFreeze({
  OrganizationModel: {
    extractionRules: 'evidence grouping by category (operational_fact, metric, constraint, risk)',
    qualityFormula: '(completeness + evidenceQuality) / 2',
    handoffRiskLevels: { high: '3+ handoffs', medium: '1-2 handoffs', low: '0 handoffs' }
  },
  OpportunityQualificationEngine: {
    detectionRules: [
      'Rule 1: manual work + high volume → automation opportunity',
      'Rule 2: low visibility + high decision volume → analytics opportunity'
    ],
    viabilityFormula: 'match_count >= 2 ? high : (match_count >= 1 ? medium : low)',
    barrierAssessment: 'identify from constraints and tool fragmentation'
  },
  RootCauseEngine: {
    analysisMethod: 'Phase 1b: deterministic constraint extraction + gap detection (placeholders for LLM-assisted Phase 2+)',
    qualityFormula: '(avgConfidence + evidenceCoverage) / 2'
  },
  QuestionPlanner: {
    dimensionSelection: 'highest (currentUncertainty * impact_if_resolved)',
    saturationGainEstimate: 'gap * 0.5',
    ownership: 'objective selection and evidence-gap planning only (no conversation strategy)'
  },
  ConfidenceCalculator: {
    opportunityConfidenceFormula: 'baseConfidence * sourceMultiplier * qualityFactor where sourceMultiplier = min(1.15, 1.0 + (supportingEvidence * 0.01))',
    organizationUnderstandingSource: 'feature vector dimensions',
    overallConfidenceWeighting: '(avgOppConfidence * 0.6) + (avgOrgConfidence * 0.4)'
  }
});

export { CONTRACT_VERSION, CONTRACT_NAMES, PUBLIC_CONTRACTS, WAVE1_DEPENDENCIES, WAVE1_FORMULAS, WAVE2_DEPENDENCIES, WAVE2_FORMULAS, WAVE3_DEPENDENCIES, WAVE3_FORMULAS, deepFreeze };

export default Object.freeze({
  CONTRACT_VERSION,
  CONTRACT_NAMES,
  PUBLIC_CONTRACTS,
  WAVE1_DEPENDENCIES,
  WAVE1_FORMULAS,
  WAVE2_DEPENDENCIES,
  WAVE2_FORMULAS,
  WAVE3_DEPENDENCIES,
  WAVE3_FORMULAS
});