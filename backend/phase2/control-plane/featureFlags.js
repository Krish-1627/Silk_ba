const DEFAULT_FLAGS = Object.freeze({
  'phase2.disableAll': false,
  'phase2.llm.integration.enabled': false,
  'phase2.factExtraction.enabled': false,
  'phase2.extractionGate.enabled': false,
  'phase2.rootCause.hybridEnabled': false,
  'phase2.conversationLayer.enabled': false,
  'phase2.factExtraction.shadowMode': false,
  'phase2.extractionGate.shadowMode': false
});

export class FeatureFlagStore {
  constructor(initialFlags = {}) {
    this.flags = {
      ...DEFAULT_FLAGS,
      ...initialFlags
    };
  }

  isEnabled(flagName) {
    return Boolean(this.flags[flagName]);
  }

  setFlag(flagName, value) {
    this.flags[flagName] = Boolean(value);
  }

  getSnapshot() {
    return { ...this.flags };
  }
}

export function getDefaultFlags() {
  return DEFAULT_FLAGS;
}
