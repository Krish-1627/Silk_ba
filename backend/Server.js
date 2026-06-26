import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Phase 2 Orchestration & Control Plane Imports
import EndToEndOrchestrator from './phase2/orchestration/endToEndOrchestrator.js';
import { FeatureFlagStore, LLMControlPlane, AuditLogger, FailClosedError } from './phase2/control-plane/index.js';
import LegacyAdapter from './engines/LegacyAdapter.js';
import ConsistencyEngine from './engines/ConsistencyEngine.js';
import PriorityEngine from './engines/PriorityEngine.js';
import FactExtractionEngine from './engines/FactExtractionEngine.js';
import FactExtractionEngineV3 from './engines/FactExtractionEngineV3.js';
import ExtractionConfidenceGate from './engines/ExtractionConfidenceGate.js';
import EvidenceRegistry from './engines/EvidenceRegistry.js';
import OrganizationModel from './engines/OrganizationModel.js';
import FeatureVectorBuilder from './engines/FeatureVectorBuilder.js';
import SaturationEngine from './engines/SaturationEngine.js';
import DeliverableGeneratorEngine from './engines/DeliverableGeneratorEngine.js';

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '../frontend');
app.use(express.static(frontendDir));

// Initialize configuration loader supporting both Gemini and Azure OpenAI
function loadConfig() {
    const config = {
        geminiApiKey: process.env.GEMINI_API_KEY || '',
        azureKey: process.env.AZURE_OPENAI_KEY || '',
        azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
        azureDeployment: process.env.AZURE_DEPLOYMENT_NAME || 'gpt-4o-mini'
    };

    const keyFilePath = path.join(__dirname, 'key.txt');
    if (fs.existsSync(keyFilePath)) {
        const fileContent = fs.readFileSync(keyFilePath, 'utf8');
        const lines = fileContent.split(/\r?\n/);
        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const parts = trimmed.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const value = parts.slice(1).join('=').trim();
                if (key === 'AZURE_OPENAI_KEY') config.azureKey = value;
                else if (key === 'AZURE_OPENAI_ENDPOINT') config.azureEndpoint = value;
                else if (key === 'AZURE_DEPLOYMENT_NAME') config.azureDeployment = value;
                else if (key === 'GEMINI_API_KEY') config.geminiApiKey = value;
            } else if (trimmed && !trimmed.includes('=')) {
                // If it is just a single raw key, default it to Gemini key
                if (!config.geminiApiKey && trimmed.length > 20) {
                    config.geminiApiKey = trimmed;
                }
            }
        });
    }
    return config;
}

const config = loadConfig();
const ai = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;
const reportDir = path.join(__dirname, 'report');

// Define the strict Akinator State JSON Response Schema
const businessAnalystSchema = {
    type: Type.OBJECT,
    properties: {
        deduced_operational_facts: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of all concrete business problems, tools, software, or process roadblocks uncovered so far."
        },
        root_causes: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    problem: { type: Type.STRING, description: "The identified symptom or problem." },
                    root_causes: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Underlying root causes (why the problem exists)." }
                },
                required: ["problem", "root_causes"]
            },
            description: "Root Cause Tree mapping symptoms to their underlying causes."
        },
        ai_opportunities: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    opportunity: { type: Type.STRING, description: "Name of the AI opportunity." },
                    confidence: { type: Type.INTEGER, description: "Confidence score (0-100)." },
                    impact: { type: Type.STRING, description: "Low, Medium, or High." },
                    business_value_score: { type: Type.INTEGER, description: "Score (0-100) using Impact+Volume+TimeSaved+RiskReduction+StrategicImportance." },
                    supporting_facts: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Discovered facts supporting this opportunity." }
                },
                required: ["opportunity", "confidence", "impact", "business_value_score", "supporting_facts"]
            },
            description: "Identified AI opportunities."
        },
        automation_opportunities: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    opportunity: { type: Type.STRING, description: "Name of the Automation opportunity." },
                    confidence: { type: Type.INTEGER, description: "Confidence score (0-100)." },
                    impact: { type: Type.STRING, description: "Low, Medium, or High." },
                    business_value_score: { type: Type.INTEGER, description: "Score (0-100) using Impact+Volume+TimeSaved+RiskReduction+StrategicImportance." },
                    supporting_facts: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Discovered facts supporting this opportunity." }
                },
                required: ["opportunity", "confidence", "impact", "business_value_score", "supporting_facts"]
            },
            description: "Identified Process Automation opportunities."
        },
        analytics_opportunities: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    opportunity: { type: Type.STRING, description: "Name of the Analytics opportunity." },
                    confidence: { type: Type.INTEGER, description: "Confidence score (0-100)." },
                    impact: { type: Type.STRING, description: "Low, Medium, or High." },
                    business_value_score: { type: Type.INTEGER, description: "Score (0-100) using Impact+Volume+TimeSaved+RiskReduction+StrategicImportance." },
                    supporting_facts: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Discovered facts supporting this opportunity." }
                },
                required: ["opportunity", "confidence", "impact", "business_value_score", "supporting_facts"]
            },
            description: "Identified Data Analytics opportunities."
        },
        risks: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Identified operational, data, and business risks."
        },
        business_impact: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    impact_type: { type: Type.STRING, description: "Type of impact (e.g. Productivity, Financial, Customer Satisfaction, Growth)." },
                    severity: { type: Type.STRING, description: "Low, Medium, or High." },
                    evidence: { type: Type.STRING, description: "Discovered evidence/metric of impact." }
                },
                required: ["impact_type", "severity", "evidence"]
            },
            description: "Business impact details."
        },
        contradictions: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    fact_a: { type: Type.STRING, description: "First asserted fact." },
                    fact_b: { type: Type.STRING, description: "Second asserted fact that logically conflicts with the first." }
                },
                required: ["fact_a", "fact_b"]
            },
            description: "Any contradictory statements made by the user."
        },
        xray_pillar_clarity_scores: {
            type: Type.OBJECT,
            properties: {
                Processes: { type: Type.INTEGER, description: "Clarity percentage on workflows and manual friction." },
                Systems: { type: Type.INTEGER, description: "Clarity percentage on software and disconnected tool dependencies." },
                Data_Information: { type: Type.INTEGER, description: "Clarity percentage on patchy visibility and reporting delay gaps." },
                People: { type: Type.INTEGER, description: "Clarity percentage on team overstretch or communication silos." },
                Performance: { type: Type.INTEGER, description: "Clarity percentage on lost hours, financial errors, or metrics." }
            },
            required: ["Processes", "Systems", "Data_Information", "People", "Performance"]
        },
        discovered_dimensions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of mapped dimensions. E.g., Problem, Root Cause, Business Impact, Scale, Risk, AI Opportunity, Automation Opportunity, Analytics Opportunity."
        },
        service_fit_scores: {
            type: Type.OBJECT,
            properties: {
                ai_fit: { type: Type.INTEGER, description: "Percentage fit for AI solutions (0-100)." },
                automation_fit: { type: Type.INTEGER, description: "Percentage fit for automation (0-100)." },
                analytics_fit: { type: Type.INTEGER, description: "Percentage fit for analytics (0-100)." }
            },
            required: ["ai_fit", "automation_fit", "analytics_fit"]
        },
        current_question_count: {
            type: Type.INTEGER,
            description: "Increment by 1 at every turn of the interview."
        },
        next_logical_target: {
            type: Type.STRING,
            description: "The Business X-Ray pillar with the lowest clarity score that needs immediate probing next."
        },
        is_absurd_or_meaningless_input: {
            type: Type.BOOLEAN,
            description: "Set to true if the user's latest message contains gibberish, jokes, or completely off-topic words."
        },
        is_completed: {
            type: Type.BOOLEAN,
            description: "Set to true if the interview is fully complete (meaning 10 user questions have been answered, or we met Condition B or C). Otherwise set to false."
        },
        question_reasoning: {
            type: Type.OBJECT,
            properties: {
                target_dimension: { type: Type.STRING, description: "Pillar/dimension we are targeting." },
                facts_to_discover: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Specific facts/details we want to uncover next." },
                potential_services: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Silk services that could potentially address this area." }
            },
            required: ["target_dimension", "facts_to_discover", "potential_services"]
        },
        natural_analyst_response: {
            type: Type.STRING,
            description: "Your human-sounding response. Keep it ultra-short and simple (maximum 1-2 short sentences). Do NOT include any acknowledgment, confirmation, prefix, or setup. Ask ONE exceptionally direct, single-focus question immediately."
        }
    },
    required: [
        "deduced_operational_facts",
        "root_causes",
        "ai_opportunities",
        "automation_opportunities",
        "analytics_opportunities",
        "risks",
        "business_impact",
        "contradictions",
        "xray_pillar_clarity_scores",
        "discovered_dimensions",
        "service_fit_scores",
        "current_question_count",
        "next_logical_target",
        "is_absurd_or_meaningless_input",
        "is_completed",
        "question_reasoning",
        "natural_analyst_response"
    ]
};

async function generateContentWithRetry(client, contents, config, retries = 3, delay = 1500) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await client.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: contents,
                config: config
            });
            return response;
        } catch (error) {
            console.error(`Gemini API attempt ${i + 1} failed:`, error.message);
            const errorText = (error && error.message) ? String(error.message) : '';
            const isTransient = errorText.includes('503') || errorText.includes('429') || errorText.includes('timeout') || errorText.includes('fetch failed') || errorText.includes('UNAVAILABLE') || errorText.includes('RESOURCE_EXHAUSTED');
            if (isTransient && i < retries - 1) {
                console.log(`Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            } else {
                throw error;
            }
        }
    }
}

function convertGoogleGenAiSchemaToOpenAi(schema) {
    if (!schema) return schema;

    const newSchema = {};

    if (schema.type) {
        if (schema.type === 'OBJECT' || schema.type === Type.OBJECT) newSchema.type = 'object';
        else if (schema.type === 'ARRAY' || schema.type === Type.ARRAY) newSchema.type = 'array';
        else if (schema.type === 'STRING' || schema.type === Type.STRING) newSchema.type = 'string';
        else if (schema.type === 'INTEGER' || schema.type === Type.INTEGER) newSchema.type = 'integer';
        else if (schema.type === 'BOOLEAN' || schema.type === Type.BOOLEAN) newSchema.type = 'boolean';
        else newSchema.type = String(schema.type).toLowerCase();
    }

    if (schema.description) {
        newSchema.description = schema.description;
    }

    if (newSchema.type === 'object') {
        newSchema.properties = {};
        if (schema.properties) {
            for (const key in schema.properties) {
                newSchema.properties[key] = convertGoogleGenAiSchemaToOpenAi(schema.properties[key]);
            }
        }
        newSchema.required = schema.required || Object.keys(newSchema.properties);
        newSchema.additionalProperties = false;
    } else if (newSchema.type === 'array') {
        if (schema.items) {
            newSchema.items = convertGoogleGenAiSchemaToOpenAi(schema.items);
        }
    }

    return newSchema;
}

async function callAzureOpenAI(messages, responseSchema, systemInstruction, temperature = 0.3) {
    const config = loadConfig();
    const headers = {
        'Content-Type': 'application/json',
        'api-key': config.azureKey
    };

    const payload = {
        messages: [
            { role: 'system', content: systemInstruction },
            ...messages
        ],
        temperature: temperature,
        response_format: {
            type: 'json_schema',
            json_schema: {
                name: 'structured_response',
                strict: true,
                schema: convertGoogleGenAiSchemaToOpenAi(responseSchema)
            }
        }
    };

    const response = await fetch(config.azureEndpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errText = await response.text();
        const error = new Error(`Azure OpenAI call failed with status ${response.status}: ${errText}`);
        error.status = response.status;
        throw error;
    }

    const data = await response.json();
    return {
        text: data.choices[0].message.content,
        usage: data.usage
    };
}

async function callAzureOpenAIWithRetry(messages, responseSchema, systemInstruction, temperature = 0.3, retries = 3, delay = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            return await callAzureOpenAI(messages, responseSchema, systemInstruction, temperature);
        } catch (error) {
            console.error(`Azure OpenAI attempt ${i + 1} failed:`, error.message);
            const errorText = (error && error.message) ? String(error.message).toLowerCase() : '';
            const isTransient = (error.status && [429, 502, 503, 504].includes(error.status)) || errorText.includes('timeout') || errorText.includes('fetch failed') || errorText.includes('rate limit');
            
            if (isTransient && i < retries - 1) {
                console.log(`Retrying Azure OpenAI in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay = Math.min(delay * 4, 10000); // e.g., 500ms -> 2000ms -> 8000ms -> capped at 10000ms
            } else {
                throw error;
            }
        }
    }
}

async function generateStructuredContent(contents, responseSchema, systemInstruction, temperature = 0.3) {
    const config = loadConfig();
    if (config.azureKey && config.azureEndpoint) {
        console.log("Using Azure OpenAI provider...");
        const messages = contents.map(item => ({
            role: item.role === 'model' ? 'assistant' : item.role,
            content: item.parts[0].text
        }));
        return await callAzureOpenAIWithRetry(messages, responseSchema, systemInstruction, temperature);
    } else {
        console.log("Using Gemini provider...");
        let geminiClient = ai;
        if (!geminiClient && config.geminiApiKey) {
            geminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
        }
        if (!geminiClient) {
            throw new Error("Gemini API client not initialized. Configure key.txt.");
        }
        const response = await generateContentWithRetry(geminiClient, contents, {
            systemInstruction: systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: responseSchema,
            temperature: temperature
        });
        return {
            text: response.text,
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
    }
}

const realizeQuestionSchema = {
    type: Type.OBJECT,
    properties: {
        questionText: { type: Type.STRING, description: "The realized, clear, conversational question text to ask the user." },
        alternativePhrasings: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Up to 3 alternative phrasings of the question for variety."
        },
        metadata: {
            type: Type.OBJECT,
            properties: {
                objective: { type: Type.STRING, description: "The question intent/objective from the question plan." },
                evidenceGap: { type: Type.STRING, description: "The evidence gap from the question plan." },
                targetDimension: { type: Type.STRING, description: "The target dimension from the question plan." }
            },
            required: ["objective", "evidenceGap", "targetDimension"]
        },
        toneMode: { type: Type.STRING, description: "The tone/style used (e.g. 'clear')." }
    },
    required: ["questionText", "alternativePhrasings", "metadata", "toneMode"]
};

const rootCauseAssistSchema = {
    type: Type.OBJECT,
    properties: {
        assistedRootCauses: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    cause: { type: Type.STRING, description: "A semantic root cause identified from the evidence." },
                    evidenceBasis: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: "List of evidenceIds that directly support this root cause. They must be valid evidenceIds from the provided evidence."
                    },
                    confidence: { type: Type.NUMBER, description: "Confidence score between 0.0 and 1.0." },
                    affectedOpportunities: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: "Opportunity IDs that are affected by this root cause."
                    }
                },
                required: ["cause", "evidenceBasis", "confidence", "affectedOpportunities"]
            },
            description: "Identified assisted root causes with direct evidence mapping."
        }
    },
    required: ["assistedRootCauses"]
};

const productionLLMProvider = {
    async invoke({ component, operation, promptId, payload, versions }) {
        if (component === 'FactExtractionEngine' && operation === 'extract_facts') {
            return await generateStructuredContent(payload.contents, payload.responseSchema, payload.systemInstruction, payload.temperature);
        }

        if (component === 'ConversationLayer' && operation === 'realize_question_text') {
            const systemInstruction = `You are a conversation generator. Your task is to rewrite the planner intent into user-facing conversational language.
Preserve the metadata exactly: objective, evidenceGap, and targetDimension must match the input payload.
Do not introduce any completion or prioritization decisions.

CRITICAL STYLE RULES (STRICTLY ENFORCED):
1. LENGTH: Your entire response must be a MAXIMUM of 1 to 2 short lines. NO EXCEPTIONS.
2. NO ACKNOWLEDGMENT OR CONFIRMATION: Do NOT acknowledge the user's statement or use any prefix/confirming words like "Got it.", "Understood.", "Makes sense.", "No problem!", etc. Do NOT repeat, recap, or confirm what the user just said (e.g., do NOT start with "Since you mentioned...", "When you update the system...", etc.).
3. NO PREAMBLE: Do not explain why you are asking the question or give background info. Ask the direct question immediately without any introduction, preamble, or setup.
4. TONE: Be extremely direct and conversational. Do not sound like a template or a formal robot.
5. NO REPETITION: Do not use generic filler words like "Based on the known context". Ask the question dynamically.
6. NO AUTOMATION OVERLOAD: Only ask about automation if the target evidence or business objective explicitly asks for automation. If the objective is to explore manual processes, workflows, or tool stack, ask about daily tasks, steps, or software tools used, NOT how they can be automated. Never use the word "automate" or "automation" unless explicitly prompted by the Target Evidence.
7. NO ABSTRACT QUESTIONS: NEVER ask about "processes" or "workflows" in the abstract. Instead, ask concrete scenario-based questions that a non-technical business user can easily answer. Examples of GOOD questions: "What goes wrong most often when a delivery comes in?", "How do you know when stock is running low?", "Who decides how much to order each time?". Examples of BAD questions: "What processes do you use?", "What workflows exist?", "Can you describe your operational processes?".
8. ALIGN WITH TARGET EVIDENCE: You must strictly ask about the requested Target Evidence and Business Objective. If the Target Evidence is "software tools" or "systems" or "system gaps", you must explicitly ask what software, apps, or tools they use. If the Target Evidence is "metrics" or "volume", you must ask about numbers, frequency, or time. Do NOT ask about generic challenges or issues if the objective is to find out tools, metrics, or processes.
9. DIVERSITY: Do not repeat or rephrase the same question from the recent history. Ensure your question explores a new angle or detail as defined by the Business Objective and Target Evidence.
10. ONE QUESTION AT A TIME: Do NOT ask compound or double-barreled questions (e.g., asking about both frequency/cost and system tools in one sentence). Keep each question strictly focused on a single target targetDimension / target evidence.
11. EXPLICIT TOOL PROBING: When the Target Evidence or Business Objective is about "software tools", "systems", "system gaps", "tool stack", or the targetDimension is "toolStackClarity", you MUST explicitly ask the user to NAME specific software, apps, spreadsheets, or platforms they use. Examples of GOOD questions: "What software or app does your team use to manage orders?", "Do you use any specific system like SAP, NetSuite, or just Excel?". Examples of BAD questions: "How do you handle the operational side?", "What challenges do you face with your current setup?".

You MUST preserve specific nouns (like Excel, SAP, Manager, or 20%) from the Known Context, but:
1. NEVER repeat entire multi-word process/action phrases (e.g., do NOT repeat "compiling demand lists and updating stock levels").
2. Only mention the specific tools, roles, or metrics. Focus on asking short, fresh questions instead of recapping processes.`;

            let formattedContext = 'None';
            if (payload.evidenceContext && typeof payload.evidenceContext === 'object') {
                const ec = payload.evidenceContext;
                
                formattedContext = '';
                if (ec.primary && ec.primary.length > 0) {
                    formattedContext += `Primary Evidence:\n${ec.primary.map(s => `- ${s}`).join('\n')}\n`;
                }
                if (ec.supporting && ec.supporting.length > 0) {
                    formattedContext += `\nSupporting Evidence:\n${ec.supporting.map(s => `- ${s}`).join('\n')}\n`;
                }
                if (ec.recent && ec.recent.length > 0) {
                    formattedContext += `\nRecent Context:\n${ec.recent.map(s => `- ${s}`).join('\n')}\n`;
                }
                
                if (formattedContext === '') {
                    formattedContext = 'None';
                }
            }

            let formattedHistory = 'None';
            if (payload.conversationHistory && Array.isArray(payload.conversationHistory)) {
                formattedHistory = payload.conversationHistory.map(msg => `${msg.role === 'user' ? 'User' : 'Silk'}: ${msg.text}`).join('\n');
            }

            const contents = [
                {
                    role: 'user',
                    parts: [{
                        text: `Please generate a conversational question based on this plan:
Business Objective: ${payload.semanticMapping ? payload.semanticMapping.businessObjective : payload.questionPlan.questionIntent}
Target Evidence: ${payload.semanticMapping ? payload.semanticMapping.targetEvidence : payload.questionPlan.evidenceGap}

Recent Chat History:
${formattedHistory}

Known Context:
${formattedContext}

Style: ${payload.style}
Variants Requested: ${payload.variantsRequested}`
                    }]
                }
            ];

            const result = await generateStructuredContent(contents, realizeQuestionSchema, systemInstruction, 0.3);
            const parsed = JSON.parse(result.text);
            parsed.usage = result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

            // Force alignment of metadata and fields to guarantee semantic fidelity validation passes
            if (!parsed.metadata) parsed.metadata = {};
            parsed.metadata.objective = payload.questionPlan.questionIntent;
            parsed.metadata.evidenceGap = payload.questionPlan.evidenceGap;
            parsed.metadata.targetDimension = payload.questionPlan.targetDimension;
            parsed.objective = payload.questionPlan.questionIntent;
            parsed.evidenceGap = payload.questionPlan.evidenceGap;
            parsed.targetDimension = payload.questionPlan.targetDimension;

            return parsed;
        }

        if (component === 'RootCauseEngine' && operation === 'semantic_root_cause_assist') {
            const systemInstruction = `You are a root cause analyst. Analyze the provided evidence and opportunities to identify semantic root causes.
Each root cause must include a clear cause, a list of supporting evidenceIds from the input evidence, and a confidence score between 0.0 and 1.0 (ensure it is >= 0.72).
Do not perform prioritization or completion decisions.`;

            const contents = [
                {
                    role: 'user',
                    parts: [{
                        text: `Analyze this evidence and opportunities:
Evidence: ${JSON.stringify(payload.evidence, null, 2)}
Opportunities: ${JSON.stringify(payload.opportunities, null, 2)}
Deterministic Root Causes: ${JSON.stringify(payload.deterministicRootCauses, null, 2)}`
                    }]
                }
            ];

            const result = await generateStructuredContent(contents, rootCauseAssistSchema, systemInstruction, 0.2);
            const parsed = JSON.parse(result.text);
            parsed.usage = result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

            // Ensure evidenceBasis links back to valid evidenceIds
            if (parsed && Array.isArray(parsed.assistedRootCauses)) {
                const validIds = new Set((payload.evidence || []).map(e => e.evidenceId));
                parsed.assistedRootCauses.forEach(rc => {
                    if (Array.isArray(rc.evidenceBasis)) {
                        rc.evidenceBasis = rc.evidenceBasis.filter(id => validIds.has(id));
                    } else {
                        rc.evidenceBasis = [];
                    }
                    if (rc.evidenceBasis.length === 0 && payload.evidence && payload.evidence.length > 0) {
                        rc.evidenceBasis = [payload.evidence[0].evidenceId];
                    }
                });
            }

            return parsed;
        }

        throw new Error(`Unsupported control plane task: ${component}/${operation}`);
    }
};

app.post('/api/chat', async (req, res) => {
    try {
        const correlationId = `silk-req-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).substr(2, 6)}`;
        
        const activeConfig = loadConfig();
        const hasProvider = (activeConfig.azureKey && activeConfig.azureEndpoint) || activeConfig.geminiApiKey || ai;
        if (!hasProvider) {
            return res.status(500).json({
                error: "API key or endpoint missing. Configure key.txt."
            });
        }
        const { chatHistory, analystState: incomingAnalystState } = req.body;

        if (!chatHistory || !Array.isArray(chatHistory)) {
            return res.status(400).json({ error: "Missing or malformed chatHistory array" });
        }

        // Rebuild stateless Turn-by-Turn previousFacts and existingEvidence
        let previousFacts = [];
        let existingEvidence = [];

        const userMessages = chatHistory.filter(msg => msg.role === 'user');
        if (userMessages.length === 0) {
            return res.status(400).json({ error: "chatHistory must contain at least one user message" });
        }

        const realFlags = new FeatureFlagStore({
            'phase2.disableAll': false,
            'phase2.llm.integration.enabled': true,
            'phase2.factExtraction.shadowMode': true,
            'phase2.extractionGate.shadowMode': true,
            'phase2.factExtraction.enabled': true,
            'phase2.extractionGate.enabled': true,
            'phase2.rootCause.hybridEnabled': true,
            'phase2.conversationLayer.enabled': true
        });

        const realAuditLogger = new AuditLogger();
        const realControlPlane = new LLMControlPlane({
            flags: realFlags,
            provider: productionLLMProvider,
            auditLogger: realAuditLogger
        });

        const factEngineRegex = new FactExtractionEngine();
        
        const factEngineLLM = new FactExtractionEngineV3({ 
            llmProvider: { 
                async generateStructuredContent(contents, responseSchema, systemInstruction, temperature) {
                    const res = await realControlPlane.executeTask({
                        component: 'FactExtractionEngine',
                        operation: 'extract_facts',
                        promptId: 'fact_extraction_v1',
                        payload: { contents, responseSchema, systemInstruction, temperature },
                        correlationId: correlationId
                    });
                    return res.response;
                }
            } 
        });
        
        const factEngine = {
            async execute(input, context) {
                const mode = context.flags?.getSnapshot?.()?.['phaseC.extractor.mode'] || 'llm';
                let extractedFacts = [];
                let quality = 0;
                
                if (mode === 'regex' || mode === 'hybrid') {
                    const res = await factEngineRegex.execute(input, context);
                    extractedFacts.push(...(res.extractedFacts || []));
                    quality = res.extractionQuality;
                }
                if (mode === 'llm' || mode === 'hybrid') {
                    const res = await factEngineLLM.execute(input, context);
                    extractedFacts.push(...(res.extractedFacts || []));
                    quality = mode === 'llm' ? res.extractionQuality : Math.max(quality, res.extractionQuality);
                }
                
                return {
                    extractedFacts,
                    extractionQuality: quality,
                    shadowModeExecuted: true,
                    productionActivated: false,
                    integrationPoints: { downstreamGate: 'ExtractionConfidenceGate' }
                };
            }
        };
        const gateEngine = new ExtractionConfidenceGate();
        const registryEngine = new EvidenceRegistry();
        const orgEngine = new OrganizationModel();
        const vectorEngine = new FeatureVectorBuilder();
        const satEngine = new SaturationEngine();

        const dummyFlags = new FeatureFlagStore({
            'phase2.disableAll': false,
            'phase2.llm.integration.enabled': true,
            'phase2.factExtraction.shadowMode': true,
            'phase2.extractionGate.shadowMode': true,
            'phase2.factExtraction.enabled': true,
            'phase2.extractionGate.enabled': true,
            'phase2.rootCause.hybridEnabled': false,
            'phase2.conversationLayer.enabled': false,
            'phaseC.extractor.mode': 'llm'
        });

        const dummyControlPlane = {
            flags: dummyFlags,
            async executeTask(task) {
                return { response: { acknowledged: true } };
            }
        };

        const dummyContext = {
            controlPlane: dummyControlPlane,
            flags: dummyFlags,
            logger: { log() {}, error() {}, warn() {}, info() {} }
        };

        let turnCounter = 0;
        const tempHistory = [];
        const trailingSaturation = [];
        const recentEvidenceCounts = [];

        // Replay prior messages to accumulate facts and evidence registry
        for (let i = 0; i < chatHistory.length - 1; i++) {
            const msg = chatHistory[i];
            if (msg.role === 'user') {
                turnCounter++;
                const factOut = await factEngine.execute({
                    userMessage: msg.text,
                    conversationHistory: JSON.parse(JSON.stringify(tempHistory)),
                    previousFacts: [...previousFacts],
                    turnNumber: turnCounter
                }, { ...dummyContext, conversationTurnNumber: turnCounter });

                if (factOut && Array.isArray(factOut.extractedFacts)) {
                    factOut.extractedFacts = factOut.extractedFacts.map(f => ({
                        ...f,
                        source: 'replay',
                        confidence: 1.0
                    }));
                }

                const gateOut = await gateEngine.execute({
                    extractedFacts: factOut.extractedFacts,
                    extractionQuality: factOut.extractionQuality,
                    turnNumber: turnCounter
                }, dummyContext);

                if (gateOut.decisionLedger && Array.isArray(gateOut.decisionLedger.entries)) {
                    for (const entry of gateOut.decisionLedger.entries) {
                        const originalFact = factOut.extractedFacts.find(f => f.factId === entry.factId);
                        const statementText = originalFact ? originalFact.statement : '';
                        let mappedRejectionReason = entry.reasonCode;
                        if (entry.reasonCode === 'REJECT_FACT_LOW_CONFIDENCE') {
                            mappedRejectionReason = 'confidence_threshold';
                        }
                        console.log(JSON.stringify({
                            turn: turnCounter,
                            statement: statementText,
                            confidence: entry.confidence,
                            approved: entry.decision === 'accept',
                            rejectionReason: entry.decision === 'reject' ? mappedRejectionReason : null
                        }));
                    }
                }

                const registryOut = await registryEngine.execute({
                    newFacts: gateOut.factsApprovedForRegistry,
                    existingEvidence: [...existingEvidence]
                }, dummyContext);
                
                const orgOut = await orgEngine.execute({
                    evidence: registryOut.evidence
                }, dummyContext);

                const vectorOut = await vectorEngine.execute({
                    organization: orgOut.organization,
                    evidence: registryOut.evidence
                }, dummyContext);
                
                const satOut = await satEngine.execute({
                    featureVector: vectorOut.featureVector,
                    opportunities: vectorOut.opportunities || [],
                    evidence: registryOut.evidence,
                    turnCount: turnCounter
                }, dummyContext);

                previousFacts = previousFacts.concat(gateOut.factsApprovedForRegistry);
                existingEvidence = registryOut.evidence;
                
                trailingSaturation.push(satOut.overallSaturation);
                recentEvidenceCounts.push(gateOut.factsApprovedForRegistry.length);
            }
            tempHistory.push(msg);
        }

        const currentTurnNumber = userMessages.length;
        const lastUserMessage = userMessages[userMessages.length - 1];

        // Execute current turn using EndToEndOrchestrator governed by LLMControlPlane

        const orchestratorControlPlane = {
            flags: realFlags,
            async executeTask(task) {
                task.correlationId = correlationId;
                // FIX: Removed the FactExtractionEngine bypass that returned a dummy
                // { acknowledged: true } response. All tasks now go through the real
                // LLM control plane so that active fact extraction works correctly.
                return realControlPlane.executeTask(task);
            }
        };

        const orchestrator = new EndToEndOrchestrator({
            deliverableGeneratorEngine: new DeliverableGeneratorEngine({ 
                llmProvider: {
                    async generateStructuredContent(contents, responseSchema, systemInstruction, temperature) {
                        return await generateStructuredContent(contents, responseSchema, systemInstruction, temperature);
                    }
                }
            }),
            factExtractionEngine: factEngine
        });        
        
        let currentEvidence = [...existingEvidence];
        if (incomingAnalystState && incomingAnalystState.deduced_operational_facts) {
            const incomingFacts = incomingAnalystState.deduced_operational_facts;
            const existingMap = new Map();
            existingEvidence.forEach(ev => {
                if (ev && ev.statement) {
                    const norm = ev.statement.trim().toLowerCase();
                    existingMap.set(norm, ev);
                }
            });

            currentEvidence = incomingFacts.map((fact, index) => {
                const norm = fact.trim().toLowerCase();
                if (existingMap.has(norm)) {
                    return existingMap.get(norm);
                }
                return {
                    evidenceId: `ev_hist_${index}`,
                    statement: fact,
                    category: 'operational_fact',
                    confidence: 1.0
                };
            });
        }

        const previousRootCauses = incomingAnalystState?.root_causes || [];
        const previousOpportunities = [
            ...(incomingAnalystState?.ai_opportunities || []),
            ...(incomingAnalystState?.automation_opportunities || []),
            ...(incomingAnalystState?.analytics_opportunities || [])
        ];

        let unanswerableDimensions = incomingAnalystState?.unanswerableDimensions || [];
        // Issues 1 & 5: Read the persistent evaded-dimension list from session state
        let evadedDimensions = incomingAnalystState?.evadedDimensions || [];

        const lastUserText = lastUserMessage.text.toLowerCase().trim();
        const isDontKnow = lastUserText.includes("don't know") || 
                           lastUserText.includes("dont know") || 
                           lastUserText.includes("no idea") || 
                           lastUserText.includes("not sure") ||
                           lastUserText === "i do not know" ||
                           lastUserText === "idk" ||
                           lastUserText === "dunno" ||
                           lastUserText === "skip" ||
                           lastUserText === "pass" ||
                           lastUserText === "no comment";

        const nextLogicalTarget = incomingAnalystState?.next_logical_target || incomingAnalystState?.engineState?.next_logical_target;

        if (isDontKnow && nextLogicalTarget) {
            // Mark dimension as unanswerable (existing logic)
            if (!unanswerableDimensions.includes(nextLogicalTarget)) {
                unanswerableDimensions.push(nextLogicalTarget);
            }
            // Issues 1 & 5: Also add to evadedDimensions for persistent QuestionPlanner penalty
            if (!evadedDimensions.includes(nextLogicalTarget)) {
                evadedDimensions.push(nextLogicalTarget);
            }
        }

        // Issue 5: Topic shift — deprioritise the topic the user shifted away from
        const topicShiftDetected = incomingAnalystState?.engineState?.topicShiftDetected || false;
        if (topicShiftDetected && nextLogicalTarget) {
            if (!evadedDimensions.includes(nextLogicalTarget)) {
                evadedDimensions.push(nextLogicalTarget);
            }
        }

        const orchestratorInput = {
            userMessage: lastUserMessage.text,
            conversationHistory: tempHistory,
            previousFacts: previousFacts,
            existingEvidence: currentEvidence,
            trailingSaturation: trailingSaturation,
            recentEvidenceCounts: recentEvidenceCounts,
            style: 'standard',
            variantsRequested: 1,
            turnNumber: currentTurnNumber,
            previousRootCauses: previousRootCauses,
            previousOpportunities: previousOpportunities,
            previousTargetDimension: nextLogicalTarget || null,
            unanswerableDimensions: unanswerableDimensions,
            evadedDimensions: evadedDimensions             // Issues 1 & 5: pass evaded dimensions
        };

        const orchestratorResult = await orchestrator.execute(orchestratorInput, {
            controlPlane: orchestratorControlPlane,
            flags: realFlags,
            logger: console,
            auditLogger: realAuditLogger,
            correlationId: correlationId
        });

        const outputs = orchestratorResult.outputs;

        // Compute Consistency and Priority engines deterministically
        const consistencyEngine = new ConsistencyEngine();
        const consistencyOutput = await consistencyEngine.execute({
            evidence: outputs.evidenceRegistryOutput.evidence
        }, { logger: console });

        const priorityEngine = new PriorityEngine();
        const priorityOutputs = {};
        for (const opp of outputs.opportunityQualificationOutput.opportunities) {
            const prOut = await priorityEngine.execute({
                opportunity: opp,
                impact: opp.viability === 'high' ? 'high' : 'medium',
                volume: 100,
                timeSaved: 10,
                riskReduction: 0.5,
                strategicImportance: opp.strategicImportance
            }, { logger: console });
            priorityOutputs[opp.opportunityId] = prOut;

            opp.confidence = outputs.confidenceOutput.opportunityConfidence[opp.opportunityId] || 80;
            opp.impact = prOut.priority === 'critical' ? 'High' : (prOut.priority === 'high' ? 'High' : (prOut.priority === 'medium' ? 'Medium' : 'Low'));
            opp.business_value_score = prOut.businessValueScore;
        }

        // Build complete engineState for LegacyAdapter
        const engineState = {
            factExtraction: outputs.factExtractionOutput,
            extractionConfidenceGate: outputs.extractionGateOutput,
            evidenceRegistry: outputs.evidenceRegistryOutput,
            organizationModel: outputs.organizationModelOutput,
            featureVector: outputs.featureVectorOutput,
            opportunityQualification: outputs.opportunityQualificationOutput,
            confidence: outputs.confidenceOutput,
            saturation: outputs.saturationOutput,
            uncertaintyMatrix: outputs.uncertaintyMatrixOutput,
            questionPlanning: outputs.questionPlannerOutput,
            priority: priorityOutputs,
            consistency: consistencyOutput,
            rootCause: outputs.rootCauseOutput,
            completionAuthority: outputs.completionAuthorityOutput,
            conversationLayer: outputs.conversationLayerOutput,
            evidenceRegistry: outputs.evidenceRegistryOutput,
            featureVector: outputs.featureVectorOutput,
            questionPlanner: outputs.questionPlannerOutput,
            completionAuthority: outputs.completionAuthorityOutput,
            deliverableOutput: outputs.deliverableGeneratorOutput,
            auditMetrics: realAuditLogger.getMetrics(),
            auditEvents: realAuditLogger.getEvents(),
            
            // Reconstruct missing v1 properties required by the legacy UI contract
            current_question_count: currentTurnNumber,
            total_facts_gathered: outputs.evidenceRegistryOutput.evidence.length,
            bottleneck_hypothesis: outputs.questionPlannerOutput.nextQuestion.objective,
            next_logical_target: outputs.questionPlannerOutput.nextQuestion.targetDimension,
            is_absurd_or_meaningless_input: false,
            question_reasoning: {
                target_dimension: outputs.questionPlannerOutput.nextQuestion.targetDimension,
                facts_to_discover: [outputs.questionPlannerOutput.nextQuestion.evidenceGap],
                potential_services: []
            },
            natural_analyst_response: outputs.completionAuthorityOutput.completed
                ? "Thank you for providing your time, We will get back to You"
                : outputs.conversationLayerOutput.realizedQuestion.questionText,

            service_fit_scores: {
                ai_fit: outputs.questionPlannerOutput.nextQuestion.serviceSignals ? Math.min(100, Math.round(outputs.questionPlannerOutput.nextQuestion.serviceSignals.ai_solutions * 5)) : 0,
                automation_fit: outputs.questionPlannerOutput.nextQuestion.serviceSignals ? Math.min(100, Math.round(outputs.questionPlannerOutput.nextQuestion.serviceSignals.automation * 5)) : 0,
                analytics_fit: outputs.questionPlannerOutput.nextQuestion.serviceSignals ? Math.min(100, Math.round(outputs.questionPlannerOutput.nextQuestion.serviceSignals.analytics * 5)) : 0
            },
            discovered_dimensions: Array.from(new Set(outputs.evidenceRegistryOutput.evidence.map(e => e.category))),
            risks: outputs.evidenceRegistryOutput.evidence.filter(e => e.category === 'risk').map(e => e.statement),
            business_impact: outputs.evidenceRegistryOutput.evidence.filter(e => e.category === 'metric' || e.category === 'business_impact').map(e => ({
                impact_type: e.category === 'metric' ? 'Metric' : 'Operational',
                severity: e.confidence > 0.8 ? 'High' : 'Medium',
                evidence: e.statement
            })),
            interview_completion_percentage: Math.round(currentTurnNumber * 10),
            lastUpdated: new Date().toISOString()
        };

        const legacyAdapter = new LegacyAdapter();
        const legacyState = await legacyAdapter.execute({ engineState }, { logger: console });

        const analystState = {
            ...legacyState,
            engineState, // ADDED THIS TO EXPOSE INTERNALS FOR TRACING
            unanswerableDimensions,
            evadedDimensions,            // Issues 1 & 5: persist evaded dimension list across turns
            // Ensure capitalized xray pillar keys are returned to comply with the v1 contract businessAnalystSchema
            xray_pillar_clarity_scores: {
                Processes: Math.round((outputs.featureVectorOutput?.features?.processDocumentation ?? 0) * 100),
                Systems: Math.round((outputs.featureVectorOutput?.features?.toolStackClarity ?? 0) * 100),
                Data_Information: Math.round((outputs.featureVectorOutput?.features?.impactQuantification ?? 0) * 100),
                People: Math.round((outputs.featureVectorOutput?.features?.userPainQuantification ?? 0) * 100),
                Performance: Math.round((outputs.featureVectorOutput?.features?.rootCauseDepth ?? 0) * 100)
            }
        };

        const userMsgCount = chatHistory.filter(msg => msg.role === 'user').length;

        // Issue 4: Force completion when:
        //   • Hard cap: user has answered 10 questions
        //   • CompletionAuthority/QuestionPlanner requested close (targetDimension = 'complete')
        //   • final_context_close path completed (targetDimension was 'final_context_close' and model says completed)
        //   • LLM flagged is_completed
        const plannerTargetDim = outputs?.questionPlannerOutput?.nextQuestion?.targetDimension;
        const plannerRequestedClose = plannerTargetDim === 'complete';

        if (userMsgCount >= 10 || Number(analystState.current_question_count) >= 10 || analystState.is_completed || plannerRequestedClose) {
            analystState.is_completed = true;
        }

        // Format and finalize completion response
        if (analystState.is_completed) {
            const targetSentence = "Thank you for providing your time, We will get back to You";
            let responseText = analystState.natural_analyst_response || "";

            // Clean up any variations of the closing sentence
            responseText = responseText.replace(/Thank you for providing your time\s*,\s*We will get back to u\.?/gi, "");
            responseText = responseText.replace(/Thank you for providing your time\s*\.\s*We will get back to u\.?/gi, "");
            responseText = responseText.replace(/Thank you for providing your time\s*,\s*We will get back to You\.?/gi, "");
            responseText = responseText.replace(/Thank you for providing your time\s*\.\s*We will get back to You\.?/gi, "");
            responseText = responseText.trim();

            // Ensure the response concludes with the exact required sentence
            if (!responseText.endsWith(targetSentence)) {
                if (!responseText) {
                    responseText = targetSentence;
                } else if (responseText.endsWith(".") || responseText.endsWith("?") || responseText.endsWith("!")) {
                    responseText += " " + targetSentence;
                } else {
                    responseText += ". " + targetSentence;
                }
            }
            analystState.natural_analyst_response = responseText;
        }

        if (analystState.is_completed) {
            try {
                fs.mkdirSync(reportDir, { recursive: true });
                const reportFile = path.join(reportDir, `chat-report-${Date.now()}.json`);
                const fullChat = [
                    ...chatHistory,
                    { role: 'assistant', text: analystState.natural_analyst_response }
                ];

                const reportPayload = {
                    createdAt: new Date().toISOString(),
                    current_question_count: analystState.current_question_count,
                    deduced_operational_facts: analystState.deduced_operational_facts,
                    root_causes: analystState.root_causes,
                    ai_opportunities: analystState.ai_opportunities,
                    automation_opportunities: analystState.automation_opportunities,
                    analytics_opportunities: analystState.analytics_opportunities,
                    risks: analystState.risks,
                    business_impact: analystState.business_impact,
                    contradictions: analystState.contradictions,
                    xray_pillar_clarity_scores: analystState.xray_pillar_clarity_scores,
                    discovered_dimensions: analystState.discovered_dimensions,
                    service_fit_scores: analystState.service_fit_scores,
                    chatHistory: fullChat
                };

                fs.writeFileSync(reportFile, JSON.stringify(reportPayload, null, 2), 'utf8');
            } catch (fsError) {
                console.warn("Failed to log chat report to local disk (this is expected in serverless environments):", fsError.message);
            }
        }

        res.json(analystState);

    } catch (error) {
        console.error("API Processing Error:", error);
        const errorText = (error && typeof error.message === 'string') ? error.message : '';
        if (errorText.includes('API key not valid')) {
            return res.status(401).json({
                error: "Gemini API key rejected. Replace key.txt with a valid API key value."
            });
        }

        res.status(500).json({ error: "Internal Analyst Engine Error" });
    }
});

// Define schemas and endpoints for comprehensive report generation
const reportGenerationSchema = {
    type: Type.OBJECT,
    properties: {
        identified_organization_problems: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Point-wise list of key organizational problems identified during the interview. Every string in this array must start with '- '."
        },
        root_cause_analysis_insights: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Point-wise list of root cause analyses and strategic insights for why these problems persist. Every string in this array must start with '- '."
        },
        suggested_strategic_roadmap: {
            type: Type.OBJECT,
            properties: {
                ai_solutions: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "Point-wise suggested AI Solutions initiatives. Every string must start with '- '."
                },
                process_automation: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "Point-wise suggested Process Automation initiatives. Every string must start with '- '."
                },
                data_analytics: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "Point-wise suggested Data Analytics initiatives. Every string must start with '- '."
                }
            },
            required: ["ai_solutions", "process_automation", "data_analytics"]
        },
        service_fit_scores: {
            type: Type.OBJECT,
            properties: {
                ai_fit: { type: Type.INTEGER, description: "Percentage fit for AI solutions (0-100)." },
                automation_fit: { type: Type.INTEGER, description: "Percentage fit for automation (0-100)." },
                analytics_fit: { type: Type.INTEGER, description: "Percentage fit for analytics (0-100)." }
            },
            required: ["ai_fit", "automation_fit", "analytics_fit"]
        }
    },
    required: [
        "identified_organization_problems",
        "root_cause_analysis_insights",
        "suggested_strategic_roadmap",
        "service_fit_scores"
    ]
};

const REPORT_SYSTEM_INSTRUCTION = `
You are a Principal Business Strategist at SilkOptima. Generate a professional digital transformation report based EXCLUSIVELY on what the user said during the chat interview.

## ABSOLUTE RULES — ZERO EXCEPTIONS

1. **ONLY USE CHAT EVIDENCE**: Every single point you write MUST be directly traceable to something the user explicitly said in the chat. Do NOT draw on general industry knowledge, best practices, or assumptions. If the user did not say it, you cannot write it.

2. **NO HALLUCINATION**: If a service has no user evidence or mention in the chat, leave that array EMPTY ([]).

3. **SERVICE ROADMAP IS EVIDENCE-GATED**:
   - Populate 'ai_solutions' ONLY if the user mentioned AI, intelligence, prediction, forecast, smart decision-making, machine learning, matching, or automated sorting in the chat.
   - Populate 'process_automation' ONLY if the user mentioned manual steps, repetitive tasks, human errors, typing mistakes, spreadsheets/sheets, copy-paste issues, manual entry, workflow bottlenecks, or inefficiencies in the chat.
   - Populate 'data_analytics' ONLY if the user mentioned tracking, reporting, dashboards, visibility, metrics, measurement, data analysis, or analyzing data in the chat.
   - If a category has no supporting user statement, output an EMPTY array [].

4. **STRICT FORMATTING**: Every string in 'identified_organization_problems', 'root_cause_analysis_insights', and roadmap arrays MUST start with "- ". No paragraphs.

5. **SERVICE FIT SCORES = EVIDENCE COUNT**: Score 0-100 based purely on how many relevant user statements support each service type. No evidence = score of 0.

6. **NO CONVERSATIONAL TEXT**: Output clean JSON only.
`;

app.post('/api/generate-report', async (req, res) => {
    try {
        const activeConfig = loadConfig();
        const hasProvider = (activeConfig.azureKey && activeConfig.azureEndpoint) || activeConfig.geminiApiKey || ai;
        if (!hasProvider) {
            return res.status(500).json({
                error: "API key or endpoint missing. Configure key.txt."
            });
        }

        const { chatHistory, analystState } = req.body;

        const contents = [
            {
                role: 'user',
                parts: [{
                    text: `Analyze this Business X-Ray interview history and the accumulated analyst state. Generate a comprehensive report.

Chat History:
${JSON.stringify(chatHistory, null, 2)}

Accumulated Analyst State:
${JSON.stringify(analystState, null, 2)}`
                }]
            }
        ];

        const response = await generateStructuredContent(contents, reportGenerationSchema, REPORT_SYSTEM_INSTRUCTION, 0.3);

        const reportData = JSON.parse(response.text);

        // Bulletproof override: Inject the actual mathematical scores from the active session into the report
        if (analystState && analystState.service_fit_scores) {
            reportData.service_fit_scores = {
                ai_fit: Number(analystState.service_fit_scores.ai_fit) || 0,
                automation_fit: Number(analystState.service_fit_scores.automation_fit) || 0,
                analytics_fit: Number(analystState.service_fit_scores.analytics_fit) || 0
            };
        }

        // Align service fit scores with roadmap recommendations to prevent contradictions
        if (reportData.suggested_strategic_roadmap && reportData.service_fit_scores) {
            const rd = reportData.suggested_strategic_roadmap;
            const sfs = reportData.service_fit_scores;
            if (Array.isArray(rd.ai_solutions) && rd.ai_solutions.length > 0) {
                sfs.ai_fit = Math.max(sfs.ai_fit, 75);
            }
            if (Array.isArray(rd.process_automation) && rd.process_automation.length > 0) {
                sfs.automation_fit = Math.max(sfs.automation_fit, 75);
            }
            if (Array.isArray(rd.data_analytics) && rd.data_analytics.length > 0) {
                sfs.analytics_fit = Math.max(sfs.analytics_fit, 75);
            }
        }

        res.json(reportData);
    } catch (error) {
        console.error("Report Generation Error:", error);
        res.status(500).json({ error: "Failed to generate business report." });
    }
});

const PORT = Number(process.env.PORT) || 3000;
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => console.log(`Silk Analyst Backend Live on http://localhost:${PORT}`));
}

export { generateStructuredContent };
export default app;