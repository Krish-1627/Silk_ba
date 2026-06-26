const REGISTRY_VERSION = 'm1a-1.0.0';

const VERSION_REGISTRY = Object.freeze({
  policyVersion: '1.0.0',
  modelVersions: {
    primary: 'configured-at-runtime',
    fallback: 'none'
  },
  promptTemplateVersions: {
    fact_extraction_v1: '1.0.0',
    root_cause_assist_v1: '1.0.0',
    conversation_realize_question_v1: '1.0.0'
  }
});

export function getRegistryVersion() {
  return REGISTRY_VERSION;
}

export function getVersionRegistry() {
  return VERSION_REGISTRY;
}

export function getVersionSnapshot() {
  return {
    registryVersion: REGISTRY_VERSION,
    policyVersion: VERSION_REGISTRY.policyVersion,
    modelVersions: VERSION_REGISTRY.modelVersions,
    promptTemplateVersions: VERSION_REGISTRY.promptTemplateVersions
  };
}
