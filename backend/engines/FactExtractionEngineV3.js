import { Engine } from '../types/index.js';
import { PUBLIC_CONTRACTS } from '../contracts/index.js';

const extractionSchema = {
    type: "object",
    properties: {
        extractedFacts: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    statement: { type: "string", description: "The exact semantic fact expressed by the user." },
                    confidence: { type: "number", description: "Confidence score from 0.0 to 1.0 that this is a factual statement relevant to a business problem." },
                    type: { type: "string", enum: ["problem", "impact", "root_cause", "opportunity", "metric", "process", "tool", "constraint", "risk"] }
                },
                required: ["statement", "confidence", "type"]
            }
        }
    },
    required: ["extractedFacts"]
};

const extractionPrompt = `
You are a Business Analyst extraction engine.
Your job is to read the latest user message and extract all distinct, granular facts.
Categorize each fact strictly into one of the following exact types:
- "problem" (Business problems or bottlenecks)
- "metric" (Process delays or metrics like time, cost, volume)
- "root_cause" (Root causes or reasons for failure)
- "impact" (Business impact or consequences)
- "opportunity" (Proposed opportunities or solutions)
- "process" (Process definitions or workflows)
- "tool" (Software systems, apps, spreadsheets, or tools used)

Rules:
1. Synthesize and summarize each extracted fact into a clean, professional, and concise third-person statement (e.g., "Company portal and LinkedIn are used for vacancy posting", "Shortlists candidates manually", "Uses SQL for retrieving website data"). Avoid raw copy-pasting of conversational filler or pronouns.
2. If the user states multiple independent facts in one sentence, split them into separate facts.
3. If the user mentions ANY specific numbers, costs, frequencies, timeframes, or specific software tool names (e.g., NetSuite, Salesforce, Cerner, etc.), you MUST extract them as separate 'metric' or 'tool' facts. Do not merge them.
4. Be comprehensive. Do not leave any metric, complaint, or proposed solution behind.
5. If a fact is irrelevant to business analysis (e.g., "Hello", "Yes"), do not extract it.
6. Only extract facts explicitly stated by the user.
7. Do not infer or speculate, but DO summarize, combine redundant points, and format each fact professionally.
8. Each extracted fact must be a professional standalone business insight representing a fact from the user's message.
`;

class FactExtractionEngineV3 extends Engine {
    constructor(options = {}) {
        super();
        this.llmProvider = options.llmProvider;
        if (!this.llmProvider) {
            throw new Error("FactExtractionEngineV3 requires an llmProvider");
        }
    }

    async execute(input, context = {}) {
        this.validateInput(input);
        const turnNumber = this.resolveTurnNumber(input, context);

        let processedMessage = (input.userMessage || '').trim();
        const msgLower = processedMessage.toLowerCase();

        const trivialWords = ['yes', 'no', 'okay', 'ok', 'nothing', 'none', 'na', 'n/a', 'correct', 'right', 'thanks'];
        const trivialPhrases = [
            "i don't know", "i dont know", "not sure", "no idea", "maybe", "perhaps", "can't say", "cant say", "nothing comes to mind",
            "nothing else", "no other problems", "nothing has changed", "just the", "that's it", "i already told you"
        ];

        const isTrivial = trivialWords.includes(msgLower) || trivialPhrases.some(phrase => msgLower.includes(phrase));

        const wordCount = processedMessage.split(/\s+/).length;
        if (!isTrivial && wordCount <= 15 && processedMessage.length > 0) {
            processedMessage = `The user specifically highlighted this business term/phrase: "${processedMessage}". Please extract it as a factual statement and assign it to the correct category (e.g., 'tool' if it's software like Excel/SAP, 'process' if it's an activity like billing/hiring, or 'problem' if it's an issue like data entry).`;
        }

        const contents = [{
            role: 'user',
            parts: [{
                text: JSON.stringify({
                    userMessage: processedMessage,
                    conversationHistory: input.conversationHistory
                })
            }]
        }];

        let result = await this.llmProvider.generateStructuredContent(contents, extractionSchema, extractionPrompt, 0.2);
        let parsed;
        try {
            parsed = JSON.parse(result.text);
            console.log("EXTRACTED:", processedMessage, "->", parsed);
        } catch (e) {
            parsed = { extractedFacts: [] };
        }

        let rawFacts = parsed.extractedFacts || [];

        // Intelligent Empty Retry Logic
        if (rawFacts.length === 0 && input.userMessage) {
            if (!isTrivial) {
                const retryPrompt = extractionPrompt + "\n\nCRITICAL: The previous extraction returned empty, but the user message appears substantial. You MUST extract any valid business facts present. Look closely at the statement.";
                result = await this.llmProvider.generateStructuredContent(contents, extractionSchema, retryPrompt, 0.3);
                try {
                    parsed = JSON.parse(result.text);
                    rawFacts = parsed.extractedFacts || [];
                } catch (e) {
                    // Fallback to empty
                }

                // Deterministic Fallback if LLM fails twice
                if (rawFacts.length === 0) {
                    console.log(`[FactExtractionEngineV3] Retry failed. Attempting deterministic fallback for: "${input.userMessage}"`);
                    const fallbackTerms = ['data entry', 'excel', 'sap', 'billing', 'hiring', 'inventory', 'payroll', 'procurement', 'manual', 'copy paste', 'customer support'];
                    const lowerMsg = input.userMessage.toLowerCase();
                    for (const term of fallbackTerms) {
                        if (lowerMsg.includes(term)) {
                            rawFacts.push({
                                statement: term,
                                confidence: 0.9,
                                type: (term === 'excel' || term === 'sap') ? 'tool' : 'process'
                            });
                            console.log(`[FactExtractionEngineV3] Fallback successfully rescued term: ${term}`);
                        }
                    }
                }
            }
        }

        const getWordTokens = (text) => {
            const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 'for', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'uses', 'used', 'has', 'have', 'we', 'they', 'our', 'us', 'company', 'organization']);
            return new Set(
                String(text).toLowerCase()
                    .replace(/[^\w\s]/g, '')
                    .split(/\s+/)
                    .filter(word => word.length > 2 && !stopWords.has(word))
            );
        };

        const calculateJaccard = (setA, setB) => {
            if (setA.size === 0 || setB.size === 0) return 0;
            let intersectionSize = 0;
            for (const val of setA) {
                if (setB.has(val)) intersectionSize++;
            }
            return intersectionSize / (setA.size + setB.size - intersectionSize);
        };

        const previousStatements = (input.previousFacts || []).map(f => (f.statement || '').toLowerCase().trim());
        const previousTokens = previousStatements.map(stmt => getWordTokens(stmt));

        if (Array.isArray(input.conversationHistory)) {
            input.conversationHistory.forEach(msg => {
                if (msg.role === 'user') {
                    const text = (msg.text || '').toLowerCase().trim();
                    previousStatements.push(text);
                    previousTokens.push(getWordTokens(text));
                }
            });
        }

        rawFacts = rawFacts.filter(fact => {
            const stmt = (fact.statement || '').toLowerCase().trim();
            if (stmt.length === 0) return false;
            if (previousStatements.includes(stmt)) return false;

            const factTokens = getWordTokens(stmt);
            for (const prevTok of previousTokens) {
                if (calculateJaccard(factTokens, prevTok) > 0.60) {
                    return false;
                }
            }
            return true;
        });

        const boostPattern = /\b(ai|artificial\s+intelligence|ml|machine\s+learning|automate|automation|dashboard|report|analytics)\b/i;
        const extractedFacts = rawFacts.map((fact, idx) => {
            let conf = fact.confidence;
            const stmt = (fact.statement || '').toLowerCase();
            const userMsg = (input.userMessage || '').toLowerCase();
            if (boostPattern.test(stmt) || boostPattern.test(userMsg)) {
                conf = Math.max(conf, 0.95);
            }
            return {
                factId: `fact_shadow_t${turnNumber}_${idx}_${fact.type}`,
                type: (fact.type || '').toLowerCase().trim(),
                statement: fact.statement,
                confidence: conf,
                source: 'user_message',
                turnNumber
            };
        });

        const output = {
            extractedFacts,
            extractionQuality: this.calculateExtractionQuality(extractedFacts),
            shadowModeExecuted: true,
            productionActivated: false,
            integrationPoints: {
                downstreamGate: 'ExtractionConfidenceGate',
                evidenceRegistryContract: 'Fact',
                evidenceRegistryFields: [...PUBLIC_CONTRACTS.Fact.fields]
            }
        };

        if (context && context.auditLogger) {
            context.auditLogger.record({
                eventType: 'engine_extraction_completed',
                component: 'FactExtractionEngine',
                extractionSuccess: extractedFacts.length > 0,
                correlationId: context.correlationId || 'unknown'
            });
        }

        this.validateOutput(output);
        return output;
    }

    validateInput(input) {
        if (!input || !input.userMessage) throw new Error("FactExtractionEngineV3 requires userMessage");
    }

    validateOutput(output) {
        if (!output || !Array.isArray(output.extractedFacts)) throw new Error("FactExtractionEngineV3 output must contain extractedFacts array");
    }

    resolveTurnNumber(input, context) {
        return input.turnNumber || input.turnCount || 1;
    }

    buildFactId(turnNumber, index, statement) {
        return `fact_t${turnNumber}_${index}`;
    }

    calculateExtractionQuality(facts) {
        if (facts.length === 0) return 0.0;
        const avgConfidence = facts.reduce((acc, f) => acc + f.confidence, 0) / facts.length;
        return avgConfidence;
    }
}

export default FactExtractionEngineV3;
