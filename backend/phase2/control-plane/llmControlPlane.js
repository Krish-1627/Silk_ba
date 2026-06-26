import { PolicyViolationError, FailClosedError } from './errors.js';
import { isOperationAllowed, isOperationForbidden } from './policy.js';
import { validatePromptOwnership } from './promptRegistry.js';
import { getVersionSnapshot } from './versionRegistry.js';
import { FeatureFlagStore } from './featureFlags.js';
import { AuditLogger, FailureClassification } from './auditLogger.js';

const COMPONENT_FLAG_MAP = Object.freeze({
  FactExtractionEngine: 'phase2.factExtraction.enabled',
  RootCauseEngine: 'phase2.rootCause.hybridEnabled',
  ConversationLayer: 'phase2.conversationLayer.enabled'
});

export class LLMControlPlane {
  constructor(options = {}) {
    this.flags = options.flags || new FeatureFlagStore();
    this.auditLogger = options.auditLogger || new AuditLogger();
    this.provider = options.provider || null;
  }

  async executeTask(task) {
    const {
      component,
      operation,
      promptId,
      payload,
      sessionId = 'unknown_session',
      tenantId = 'default'
    } = task || {};

    this.assertValidTask(component, operation, promptId);

    // Initialize a correlation ID for this session/task
    const correlationId = task.correlationId || `silk-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).substr(2, 6)}`;
    const startTime = performance.now();

    this.auditLogger.record({
      eventType: 'llm_task_requested',
      component,
      operation,
      promptId,
      sessionId,
      tenantId,
      correlationId
    });

    try {
      this.enforceGlobalFlags(component);
      this.enforcePolicy(component, operation, promptId);
    } catch (error) {
      // Log policy/flag violation denials before re-throwing
      const latencyMs = Math.round(performance.now() - startTime);
      this.auditLogger.record({
        eventType: 'llm_task_denied',
        decision: 'policy_violation',
        reason: error.code || 'policy_check_failed',
        failureClass: FailureClassification.UNKNOWN,
        errorMessage: error.message,
        component,
        operation,
        promptId,
        sessionId,
        tenantId,
        correlationId,
        latencyMs
      });
      throw error;
    }

    if (!this.provider || typeof this.provider.invoke !== 'function') {
      const latencyMs = Math.round(performance.now() - startTime);
      this.auditLogger.record({
        eventType: 'llm_task_denied',
        decision: 'fail_closed',
        reason: 'provider_unavailable',
        failureClass: FailureClassification.PROVIDER_UNAVAILABLE,
        component,
        operation,
        promptId,
        sessionId,
        tenantId,
        correlationId,
        latencyMs
      });
      throw new FailClosedError('LLM provider unavailable; fail-closed engaged', { component, operation });
    }

    try {
      const response = await this.provider.invoke({
        component,
        operation,
        promptId,
        payload,
        versions: getVersionSnapshot()
      });

      const latencyMs = Math.round(performance.now() - startTime);
      const usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const promptTokens = usage.promptTokens || usage.prompt_tokens || 0;
      const completionTokens = usage.completionTokens || usage.completion_tokens || 0;
      const totalTokens = usage.totalTokens || usage.total_tokens || 0;

      this.auditLogger.record({
        eventType: 'llm_task_allowed',
        decision: 'allow',
        component,
        operation,
        promptId,
        sessionId,
        tenantId,
        correlationId,
        latencyMs,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        totalTokens: totalTokens,
        promptVersion: getVersionSnapshot()?.prompts?.[promptId] || 'v1.0',
        modelVersion: 'azure-openai-v1', // Should ideally be retrieved from the provider
        extractionSuccess: component === 'FactExtractionEngine' ? !!response.extractedFacts : undefined
      });

      return {
        response,
        auditTrail: this.auditLogger.getEvents(),
        versions: getVersionSnapshot()
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);
      
      let failureClass = FailureClassification.UNKNOWN;
      const errorMsg = error.message.toLowerCase();
      if (errorMsg.includes('rate limit') || errorMsg.includes('429')) failureClass = FailureClassification.RATE_LIMIT;
      else if (errorMsg.includes('timeout')) failureClass = FailureClassification.TIMEOUT;
      else if (errorMsg.includes('fetch failed')) failureClass = FailureClassification.NETWORK_FAILURE;
      else if (errorMsg.includes('json')) failureClass = FailureClassification.JSON_PARSE_FAILURE;

      this.auditLogger.record({
        eventType: 'llm_task_denied',
        decision: 'fail_closed',
        reason: 'provider_error',
        failureClass,
        errorMessage: error.message,
        component,
        operation,
        promptId,
        sessionId,
        tenantId,
        correlationId,
        latencyMs
      });

      throw new FailClosedError('Provider error; fail-closed engaged', {
        component,
        operation,
        cause: error.message
      });
    }
  }

  assertValidTask(component, operation, promptId) {
    if (!component || !operation || !promptId) {
      throw new PolicyViolationError('Task requires component, operation, and promptId', {
        component,
        operation,
        promptId
      });
    }
  }

  enforceGlobalFlags(component) {
    if (this.flags.isEnabled('phase2.disableAll')) {
      throw new PolicyViolationError('Phase 2 globally disabled by kill-switch', {
        flag: 'phase2.disableAll'
      });
    }

    if (!this.flags.isEnabled('phase2.llm.integration.enabled')) {
      throw new PolicyViolationError('LLM integration disabled by feature flag', {
        flag: 'phase2.llm.integration.enabled'
      });
    }

    const componentFlag = COMPONENT_FLAG_MAP[component];
    if (componentFlag && !this.flags.isEnabled(componentFlag)) {
      throw new PolicyViolationError('Component feature flag disabled', {
        flag: componentFlag,
        component
      });
    }

    // Shadow mode flags are prepared for M2 shadow validation patterns.
    // For M1a, they remain inactive and do not affect execution flow.
    // TODO(M2): Implement shadow mode validation logic that runs LLM task
    // in shadow mode without using result to validate new models before production.
    if (this.flags.isEnabled('phase2.factExtraction.shadowMode')) {
      // Shadow mode placeholder: activated in M2
    }
    if (this.flags.isEnabled('phase2.extractionGate.shadowMode')) {
      // Shadow mode placeholder: activated in M2
    }
  }

  enforcePolicy(component, operation, promptId) {
    if (isOperationForbidden(operation)) {
      throw new PolicyViolationError('Forbidden operation denied', { component, operation });
    }

    if (!isOperationAllowed(component, operation)) {
      throw new PolicyViolationError('Operation not allowed for component', { component, operation });
    }

    const promptValidation = validatePromptOwnership(promptId, component, operation);
    if (!promptValidation.valid) {
      throw new PolicyViolationError('Prompt ownership validation failed', {
        component,
        operation,
        promptId,
        ...promptValidation
      });
    }
  }
}
