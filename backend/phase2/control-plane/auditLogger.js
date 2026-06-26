import fs from 'fs';
import path from 'path';

export const FailureClassification = Object.freeze({
  RATE_LIMIT: 'RATE_LIMIT',
  NETWORK_FAILURE: 'NETWORK_FAILURE',
  TIMEOUT: 'TIMEOUT',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  JSON_PARSE_FAILURE: 'JSON_PARSE_FAILURE',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  UNKNOWN: 'UNKNOWN'
});

export class AuditLogger {
  constructor() {
    this.events = [];
    // Centralized success rate counters
    this.metrics = {
      providerCalls: 0,
      providerSuccesses: 0,
      extractionCalls: 0,
      extractionSuccesses: 0
    };
  }

  record(event) {
    // Generate a correlation ID if not present
    const correlationId = event.correlationId || `silk-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).substr(2, 6)}`;
    
    // Update Provider Success Rate KPIs
    if (event.eventType === 'llm_task_requested') {
      this.metrics.providerCalls++;
    } else if (event.eventType === 'llm_task_allowed') {
      this.metrics.providerSuccesses++;
    } else if (event.eventType === 'llm_task_denied' && event.decision === 'fail_closed') {
      // Provider failed
    } else if (event.eventType === 'engine_extraction_completed') {
      this.metrics.extractionCalls++;
      if (event.extractionSuccess) {
        this.metrics.extractionSuccesses++;
      }
    }

    const eventObj = {
      timestamp: new Date().toISOString(),
      correlationId,
      ...event
    };
    this.events.push(eventObj);

    // Fire-and-forget persistent write
    const logPath = process.env.AUDIT_LOG_PATH || path.resolve('backend/telemetry/audit_log.jsonl');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFile(logPath, JSON.stringify(eventObj) + '\n', (err) => {
        if (err) console.error('Failed to write telemetry:', err);
    });
  }

  getEvents() {
    return [...this.events];
  }
  
  getMetrics() {
    const providerSuccessRate = this.metrics.providerCalls > 0 
      ? (this.metrics.providerSuccesses / this.metrics.providerCalls) * 100 
      : 0;
    const extractionSuccessRate = this.metrics.extractionCalls > 0 
      ? (this.metrics.extractionSuccesses / this.metrics.extractionCalls) * 100 
      : 0;

    return {
      ...this.metrics,
      providerSuccessRate: providerSuccessRate.toFixed(2) + '%',
      extractionSuccessRate: extractionSuccessRate.toFixed(2) + '%'
    };
  }

  clear() {
    this.events = [];
  }
}
