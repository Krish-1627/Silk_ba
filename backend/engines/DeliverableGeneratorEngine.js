import { Engine } from '../types/index.js';

class DeliverableGeneratorEngine extends Engine {
  constructor(options = {}) {
    super();
    this.llmProvider = options.llmProvider || null;
  }

  async execute(input, context = {}) {
    this.validateInput(input);

    const { evidence } = input;
    
    // If there is no evidence or the provider is missing, return empty structure
    if (!this.llmProvider || !evidence || evidence.length === 0) {
      const emptyDeliverable = {
        executiveSummary: "No evidence gathered.",
        problemStatement: "Unknown",
        rootCauses: [],
        impacts: [],
        opportunities: [],
        confidence: { overall: 0, problem: 0, impact: 0, rootCause: 0, opportunity: 0 }
      };
      return {
        deliverable: emptyDeliverable,
        markdown: this.renderMarkdown(emptyDeliverable)
      };
    }

    const instruction = `You are a Senior Business Analyst. You have completed an interview and gathered the following evidence facts.
Your task is to synthesize this raw evidence into a highly professional Business Requirements Document (BRD) snippet.
You MUST ensure that every single evidence fact listed below is preserved and explicitly represented in the appropriate sections of the generated output (Executive Summary, Problem Statement, Root Causes, Impacts, or Opportunities). Do not drop any key metrics, problems, or opportunities. Do not invent information. Only use the provided evidence.

Evidence Facts:
${evidence.map(e => `- [${e.category.toUpperCase()}] ${e.statement}`).join('\n')}`;

    const contents = [
      {
        role: 'user',
        parts: [{ text: "Generate the final BA deliverable based on the evidence." }]
      }
    ];

    const schema = {
      type: "object",
      properties: {
        executiveSummary: { type: "string", description: "A 2-3 sentence overview of the current situation." },
        problemStatement: { type: "string", description: "Clear definition of the core problem." },
        rootCauses: { type: "array", items: { type: "string" }, description: "List of identified root causes." },
        impacts: { type: "array", items: { type: "string" }, description: "Quantifiable or qualitative business impacts." },
        opportunities: { type: "array", items: { type: "string" }, description: "Potential solutions or opportunities." },
        confidence: { 
          type: "object", 
          properties: {
            overall: { type: "number" },
            problem: { type: "number" },
            impact: { type: "number" },
            rootCause: { type: "number" },
            opportunity: { type: "number" }
          },
          required: ["overall", "problem", "impact", "rootCause", "opportunity"],
          description: "Confidence scores from 0.0 to 1.0 based on the evidence quality." 
        }
      },
      required: ["executiveSummary", "problemStatement", "rootCauses", "impacts", "opportunities", "confidence"]
    };

    try {
      // Use 0.2 temperature for more deterministic generation
      const result = await this.llmProvider.generateStructuredContent(contents, schema, instruction, 0.2);
      const parsedDeliverable = JSON.parse(result.text);
      
      const output = {
        deliverable: parsedDeliverable,
        markdown: this.renderMarkdown(parsedDeliverable)
      };
      this.validateOutput(output);
      return output;
    } catch (err) {
      if (context.logger) {
        context.logger.error("Error generating deliverable", err);
      }
      const emptyDeliverable = {
        executiveSummary: "Error generating deliverable.",
        problemStatement: "Unknown",
        rootCauses: [],
        impacts: [],
        opportunities: [],
        confidence: { overall: 0, problem: 0, impact: 0, rootCause: 0, opportunity: 0 }
      };
      return {
        deliverable: emptyDeliverable,
        markdown: this.renderMarkdown(emptyDeliverable)
      };
    }
  }

  renderMarkdown(deliverable) {
    let md = `## Executive Summary\n${deliverable.executiveSummary}\n\n`;
    md += `## Problem Statement\n${deliverable.problemStatement}\n\n`;
    
    md += `## Root Causes\n`;
    if (deliverable.rootCauses && deliverable.rootCauses.length > 0) {
      deliverable.rootCauses.forEach(rc => md += `- ${rc}\n`);
    } else {
      md += `*None identified.*\n`;
    }
    md += `\n`;

    md += `## Business Impact\n`;
    if (deliverable.impacts && deliverable.impacts.length > 0) {
      deliverable.impacts.forEach(i => md += `- ${i}\n`);
    } else {
      md += `*None identified.*\n`;
    }
    md += `\n`;

    md += `## Opportunities\n`;
    if (deliverable.opportunities && deliverable.opportunities.length > 0) {
      deliverable.opportunities.forEach(o => md += `- ${o}\n`);
    } else {
      md += `*None identified.*\n`;
    }
    md += `\n`;

    md += `## Confidence Scores\n`;
    md += `- **Overall:** ${(deliverable.confidence.overall * 100).toFixed(0)}%\n`;
    md += `- **Problem:** ${(deliverable.confidence.problem * 100).toFixed(0)}%\n`;
    md += `- **Impact:** ${(deliverable.confidence.impact * 100).toFixed(0)}%\n`;
    md += `- **Root Cause:** ${(deliverable.confidence.rootCause * 100).toFixed(0)}%\n`;
    md += `- **Opportunity:** ${(deliverable.confidence.opportunity * 100).toFixed(0)}%\n`;

    return md;
  }

  validateInput(input) {
    if (!input || typeof input !== 'object') {
      throw new Error('DeliverableGeneratorEngine: input must be an object');
    }
    return true;
  }

  validateOutput(output) {
    if (!output || typeof output.deliverable !== 'object' || typeof output.markdown !== 'string') {
      throw new Error('DeliverableGeneratorEngine: output must contain deliverable and markdown');
    }
    return true;
  }
}

export default DeliverableGeneratorEngine;
