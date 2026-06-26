import FactExtractionEngine from '../../engines/FactExtractionEngine.js';
import ExtractionConfidenceGate from '../../engines/ExtractionConfidenceGate.js';
import EvidenceRegistry from '../../engines/EvidenceRegistry.js';
import { FeatureFlagStore } from '../control-plane/featureFlags.js';
import { PUBLIC_CONTRACTS } from '../../contracts/index.js';

/**
 * M2 Milestone 3 integration runner for extraction flow only.
 * Pipeline: FactExtractionEngine -> ExtractionConfidenceGate -> EvidenceRegistry
 */
export class ExtractionFlowPipeline {
  constructor(options = {}) {
    this.flags = options.flags || new FeatureFlagStore();
    this.controlPlane = options.controlPlane;
    this.factExtractionEngine = options.factExtractionEngine || new FactExtractionEngine(options.factExtraction || {});
    this.extractionConfidenceGate = options.extractionConfidenceGate || new ExtractionConfidenceGate(options.extractionGate || {});
    this.evidenceRegistry = options.evidenceRegistry || new EvidenceRegistry(options.evidenceRegistry || {});
  }

  async execute(input, context = {}) {
    this.validateInput(input);

    const turnNumber = Number.isFinite(input.turnNumber) && input.turnNumber > 0
      ? input.turnNumber
      : ((input.conversationHistory || []).length + 1);

    const factOutput = await this.factExtractionEngine.execute({
      userMessage: input.userMessage,
      conversationHistory: input.conversationHistory || [],
      previousFacts: input.previousFacts || [],
      turnNumber
    }, {
      ...context,
      logger: context.logger || console,
      flags: this.flags,
      controlPlane: this.controlPlane,
      conversationTurnNumber: turnNumber
    });

    const gateOutput = await this.extractionConfidenceGate.execute({
      extractedFacts: factOutput.extractedFacts,
      extractionQuality: factOutput.extractionQuality,
      turnNumber
    }, {
      ...context,
      logger: context.logger || console,
      flags: this.flags
    });

    const evidenceOutput = await this.evidenceRegistry.execute({
      newFacts: gateOutput.factsApprovedForRegistry,
      existingEvidence: input.existingEvidence || []
    }, {
      ...context,
      logger: context.logger || console
    });

    const approvedFactIds = new Set(gateOutput.factsApprovedForRegistry.map(fact => fact.factId));
    const rejectedFacts = factOutput.extractedFacts.filter(fact => !approvedFactIds.has(fact.factId));

    const contractCompatibility = this.buildContractCompatibility(gateOutput.factsApprovedForRegistry);

    return {
      factOutput,
      gateOutput,
      evidenceOutput,
      handoffValidation: {
        candidateFactsCount: factOutput.extractedFacts.length,
        approvedFactsCount: gateOutput.factsApprovedForRegistry.length,
        rejectedFactsCount: rejectedFacts.length,
        approvedFactsForwardedToEvidenceRegistry: gateOutput.factsApprovedForRegistry.length,
        rejectedFactsForwardedToEvidenceRegistry: 0,
        pipelinePreserved: true
      },
      shadowMetrics: {
        flow: 'FactExtractionEngine -> ExtractionConfidenceGate -> EvidenceRegistry',
        shadowModeExecuted: Boolean(factOutput.shadowModeExecuted) && Boolean(gateOutput.shadowModeValidation?.enabled),
        extractionQuality: factOutput.extractionQuality,
        approvalRate: factOutput.extractedFacts.length === 0
          ? 0
          : Number((gateOutput.factsApprovedForRegistry.length / factOutput.extractedFacts.length).toFixed(4)),
        evidenceGrowth: evidenceOutput.evidence.length - (input.existingEvidence || []).length
      },
      contractCompatibility
    };
  }

  validateInput(input) {
    if (!input || typeof input.userMessage !== 'string' || !input.userMessage.trim()) {
      throw new Error('ExtractionFlowPipeline: userMessage required (string)');
    }
    if (!Array.isArray(input.conversationHistory)) {
      throw new Error('ExtractionFlowPipeline: conversationHistory required (array)');
    }
    if (!Array.isArray(input.previousFacts)) {
      throw new Error('ExtractionFlowPipeline: previousFacts required (array)');
    }
    if (!Array.isArray(input.existingEvidence)) {
      throw new Error('ExtractionFlowPipeline: existingEvidence required (array)');
    }
  }

  buildContractCompatibility(approvedFacts) {
    const requiredFields = [...PUBLIC_CONTRACTS.Fact.fields];
    const missingFields = approvedFacts.flatMap((fact, index) => {
      return requiredFields
        .filter(field => !Object.prototype.hasOwnProperty.call(fact, field))
        .map(field => ({ index, factId: fact.factId || 'unknown_fact', field }));
    });

    return {
      contractName: 'Fact',
      requiredFields,
      compatible: missingFields.length === 0,
      missingFields
    };
  }
}

export default ExtractionFlowPipeline;
