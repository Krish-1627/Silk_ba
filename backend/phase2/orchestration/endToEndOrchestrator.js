import FactExtractionEngine from '../../engines/FactExtractionEngine.js';
import ExtractionConfidenceGate from '../../engines/ExtractionConfidenceGate.js';
import EvidenceRegistry from '../../engines/EvidenceRegistry.js';
import OrganizationModel from '../../engines/OrganizationModel.js';
import FeatureVectorBuilder from '../../engines/FeatureVectorBuilder.js';
import OpportunityQualificationEngine from '../../engines/OpportunityQualificationEngine.js';
import ConfidenceCalculator from '../../engines/ConfidenceCalculator.js';
import SaturationEngine from '../../engines/SaturationEngine.js';
import UncertaintyMatrix from '../../engines/UncertaintyMatrix.js';
import RootCauseEngine from '../../engines/RootCauseEngine.js';
import ConsistencyEngine from '../../engines/ConsistencyEngine.js';
import QuestionPlanner from '../../engines/QuestionPlanner.js';
import ConversationLayer from '../../engines/ConversationLayer.js';
import CompletionAuthority from '../../engines/CompletionAuthority.js';
import DeliverableGeneratorEngine from '../../engines/DeliverableGeneratorEngine.js';

/**
 * M5.1 End-to-End Orchestration integration.
 * Pipeline:
 * FactExtractionEngine -> ExtractionConfidenceGate -> EvidenceRegistry -> OrganizationModel
 * -> FeatureVectorBuilder -> OpportunityQualificationEngine -> ConfidenceCalculator
 * -> SaturationEngine -> UncertaintyMatrix -> RootCauseEngine -> QuestionPlanner
 * -> ConversationLayer -> CompletionAuthority -> DeliverableGeneratorEngine
 */
class EndToEndOrchestrator {
  constructor(options = {}) {
    this.factExtractionEngine = options.factExtractionEngine || new FactExtractionEngine(options.factExtraction || {});
    this.extractionConfidenceGate = options.extractionConfidenceGate || new ExtractionConfidenceGate(options.extractionGate || {});
    this.evidenceRegistry = options.evidenceRegistry || new EvidenceRegistry(options.evidenceRegistry || {});
    this.organizationModel = options.organizationModel || new OrganizationModel(options.organizationModel || {});
    this.featureVectorBuilder = options.featureVectorBuilder || new FeatureVectorBuilder(options.featureVectorBuilder || {});
    this.opportunityQualificationEngine = options.opportunityQualificationEngine || new OpportunityQualificationEngine(options.opportunityQualificationEngine || {});
    this.confidenceCalculator = options.confidenceCalculator || new ConfidenceCalculator(options.confidenceCalculator || {});
    this.saturationEngine = options.saturationEngine || new SaturationEngine(options.saturationEngine || {});
    this.uncertaintyMatrix = options.uncertaintyMatrix || new UncertaintyMatrix(options.uncertaintyMatrix || {});
    this.rootCauseEngine = options.rootCauseEngine || new RootCauseEngine(options.rootCauseEngine || {});
    this.questionPlanner = options.questionPlanner || new QuestionPlanner(options.questionPlanner || {});
    this.conversationLayer = options.conversationLayer || new ConversationLayer(options.conversationLayer || {});
    this.completionAuthority = options.completionAuthority || new CompletionAuthority(options.completionAuthority || {});
    this.deliverableGeneratorEngine = options.deliverableGeneratorEngine || new DeliverableGeneratorEngine(options.deliverableGeneratorEngine || {});
  }

  async execute(input, context = {}) {
    this.validateInput(input, context);

    const logger = context.logger || console;
    const turnNumber = Number.isFinite(input.turnNumber) && input.turnNumber > 0
      ? input.turnNumber
      : (input.conversationHistory.length + 1);

    const factExtractionOutput = await this.factExtractionEngine.execute({
      userMessage: input.userMessage,
      conversationHistory: input.conversationHistory,
      previousFacts: input.previousFacts,
      turnNumber
    }, {
      ...context,
      logger,
      conversationTurnNumber: turnNumber
    });

    const extractionGateOutput = await this.extractionConfidenceGate.execute({
      extractedFacts: factExtractionOutput.extractedFacts,
      extractionQuality: factExtractionOutput.extractionQuality,
      turnNumber
    }, {
      ...context,
      logger
    });

    const evidenceRegistryOutput = await this.evidenceRegistry.execute({
      newFacts: extractionGateOutput.factsApprovedForRegistry,
      existingEvidence: input.existingEvidence
    }, {
      ...context,
      logger
    });

    const organizationModelOutput = await this.organizationModel.execute({
      evidence: evidenceRegistryOutput.evidence
    }, {
      ...context,
      logger
    });

    const featureVectorOutput = await this.featureVectorBuilder.execute({
      organization: organizationModelOutput.organization,
      evidence: evidenceRegistryOutput.evidence,
      previousRootCauses: input.previousRootCauses,
      previousOpportunities: input.previousOpportunities
    }, {
      ...context,
      logger
    });

    const opportunityQualificationOutput = await this.opportunityQualificationEngine.execute({
      organization: organizationModelOutput.organization,
      evidence: evidenceRegistryOutput.evidence,
      featureVector: featureVectorOutput.featureVector
    }, {
      ...context,
      logger
    });

    const confidenceOutput = await this.confidenceCalculator.execute({
      opportunities: opportunityQualificationOutput.opportunities,
      evidence: evidenceRegistryOutput.evidence,
      featureVector: featureVectorOutput.featureVector
    }, {
      ...context,
      logger
    });

    const saturationOutput = await this.saturationEngine.execute({
      featureVector: featureVectorOutput.featureVector,
      opportunities: opportunityQualificationOutput.opportunities,
      evidence: evidenceRegistryOutput.evidence,
      turnCount: turnNumber
    }, {
      ...context,
      logger
    });

    const uncertaintyMatrixOutput = await this.uncertaintyMatrix.execute({
      featureVector: featureVectorOutput.featureVector,
      saturation: saturationOutput,
      opportunities: opportunityQualificationOutput.opportunities
    }, {
      ...context,
      logger
    });

    const rootCauseOutput = await this.rootCauseEngine.execute({
      evidence: evidenceRegistryOutput.evidence,
      opportunities: opportunityQualificationOutput.opportunities
    }, {
      ...context,
      logger
    });

    const topicShiftDetected = extractionGateOutput.factsApprovedForRegistry.some(f => 
      ['problem', 'root_cause', 'impact'].includes(f.type || f.category)
    );

    const consistencyEngine = new ConsistencyEngine();
    const consistencyOutput = await consistencyEngine.execute({
      evidence: evidenceRegistryOutput.evidence
    }, { logger });

    const questionPlannerOutput = await this.questionPlanner.execute({
      uncertaintyMatrix: uncertaintyMatrixOutput.uncertaintyMap,
      saturation: saturationOutput,
      featureVector: featureVectorOutput.featureVector,
      conversationHistory: input.conversationHistory,
      evidence: evidenceRegistryOutput.evidence,
      previousTargetDimension: input.previousTargetDimension,
      zeroFactsExtracted: extractionGateOutput.factsApprovedForRegistry.length === 0,
      opportunities: opportunityQualificationOutput.opportunities,
      unanswerableDimensions: input.unanswerableDimensions || [],
      topicShiftDetected: topicShiftDetected,
      lockedServiceTypes: opportunityQualificationOutput.lockedServiceTypes || [],
      pendingServiceTypes: opportunityQualificationOutput.pendingServiceTypes || [],
      contradictions: consistencyOutput.contradictions || [],
      evadedDimensions: input.evadedDimensions || []   // Issues 1 & 5: thread through evaded dimension memory
    }, {
      ...context,
      logger
    });

    // Evidence Prioritizer
    const targetDimension = questionPlannerOutput.nextQuestion.targetDimension;
    const allEvidence = evidenceRegistryOutput.evidence || [];
    
    let evidenceContext = [];
    evidenceContext.primary = [];
    evidenceContext.supporting = [];
    evidenceContext.recent = [];

    if (allEvidence.length > 0) {
      // 1. Recent Context
      evidenceContext.recent = [allEvidence[allEvidence.length - 1].statement];
      evidenceContext.push(allEvidence[allEvidence.length - 1].statement);

      // 2. Category-Aware Relevance Scoring
      const getRelevance = (cat) => {
        if (targetDimension === 'problemUnderstanding') return ['problem', 'impact'].includes(cat) ? 1.0 : 0.0;
        if (targetDimension === 'impactQuantification') return ['impact', 'metric'].includes(cat) ? 1.0 : (cat === 'problem' ? 0.5 : 0.0);
        if (targetDimension === 'rootCauseDepth') return ['root_cause', 'process', 'constraint'].includes(cat) ? 1.0 : (['problem', 'impact'].includes(cat) ? 0.2 : 0.0);
        if (targetDimension === 'opportunityDepth') return ['opportunity', 'process', 'root_cause'].includes(cat) ? 1.0 : 0.0;
        return 0.5;
      };

      const remainingEvidence = allEvidence.slice(0, -1);
      if (remainingEvidence.length > 0) {
        const ranked = remainingEvidence.map((e, index) => {
          const relevance = getRelevance(e.category);
          const recency = index / remainingEvidence.length;
          const score = (relevance * 0.6) + (recency * 0.4);
          return { statement: e.statement, score };
        }).sort((a, b) => b.score - a.score);

        evidenceContext.primary = ranked.slice(0, 2).map(e => e.statement);
        evidenceContext.supporting = ranked.slice(2, 4).map(e => e.statement);
        evidenceContext.push(...ranked.slice(0, 4).map(e => e.statement));
      }
    }

    const conversationLayerOutput = await this.conversationLayer.execute({
      questionPlan: questionPlannerOutput.nextQuestion,
      evidenceContext: evidenceContext,
      conversationHistory: input.conversationHistory,
      style: input.style,
      variantsRequested: input.variantsRequested
    }, {
      ...context,
      logger
    });


    const completionAuthorityOutput = await this.completionAuthority.execute({
      saturation: saturationOutput,
      confidence: confidenceOutput,
      turnCount: turnNumber,
      evidenceCount: evidenceRegistryOutput.evidence.length,
      trailingSaturation: input.trailingSaturation || [],
      recentEvidenceCounts: input.recentEvidenceCounts || [],
      topicShiftDetected: topicShiftDetected,
      unanswerableDimensions: input.unanswerableDimensions || [],
      plannerOutput: questionPlannerOutput
    }, {
      ...context,
      logger
    });

    let deliverableOutput = null;
    if (completionAuthorityOutput.completed) {
      deliverableOutput = await this.deliverableGeneratorEngine.execute({
        evidence: evidenceRegistryOutput.evidence
      }, {
        ...context,
        logger
      });
    }

    const pipeline = [
      'FactExtractionEngine',
      'ExtractionConfidenceGate',
      'EvidenceRegistry',
      'OrganizationModel',
      'FeatureVectorBuilder',
      'OpportunityQualificationEngine',
      'ConfidenceCalculator',
      'SaturationEngine',
      'UncertaintyMatrix',
      'RootCauseEngine',
      'QuestionPlanner',
      'ConversationLayer',
      'CompletionAuthority'
    ];
    if (completionAuthorityOutput.completed) {
      pipeline.push('DeliverableGeneratorEngine');
    }

    return {
      pipeline,
      outputs: {
        factExtractionOutput,
        extractionGateOutput,
        evidenceRegistryOutput,
        organizationModelOutput,
        featureVectorOutput,
        opportunityQualificationOutput,
        confidenceOutput,
        saturationOutput,
        uncertaintyMatrixOutput,
        rootCauseOutput,
        questionPlannerOutput,
        conversationLayerOutput,
        completionAuthorityOutput,
        deliverableOutput
      }
    };
  }

  validateInput(input, context) {
    if (!input || typeof input.userMessage !== 'string' || !input.userMessage.trim()) {
      throw new Error('EndToEndOrchestrator: userMessage required (string)');
    }
    if (!Array.isArray(input.conversationHistory)) {
      throw new Error('EndToEndOrchestrator: conversationHistory required (array)');
    }
    if (!Array.isArray(input.previousFacts)) {
      throw new Error('EndToEndOrchestrator: previousFacts required (array)');
    }
    if (!Array.isArray(input.existingEvidence)) {
      throw new Error('EndToEndOrchestrator: existingEvidence required (array)');
    }

    const controlPlane = context?.controlPlane;
    if (!controlPlane || typeof controlPlane.executeTask !== 'function') {
      throw new Error('EndToEndOrchestrator: controlPlane.executeTask is required');
    }
  }
}

export default EndToEndOrchestrator;
export { EndToEndOrchestrator };
