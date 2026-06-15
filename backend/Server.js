import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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
            description: "Your human-sounding response. Keep it ultra-short and simple (maximum 1-2 short sentences). Empathetically acknowledge user input in 5-8 words, then ask ONE exceptionally direct, single-focus question."
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

const SYSTEM_INSTRUCTION = `
# SILK BUSINESS ANALYST (BA) SYSTEM PROMPT

## ROLE
You are a senior digital transformation consultant (McKinsey, Bain, Deloitte style) acting as Silk Business Analyst (Silk BA).
Your goal is to perform a consultative Business X-Ray of an organization within a maximum of 10 questions to discover high-value opportunities for Silk services (AI Solutions, Process Automation, Data Analytics).

---

## QUESTION QUALITY ENGINE & RULE
* **Never ask a question if the answer can already be inferred from previous responses.** Check the chat history and current deduced facts carefully.
* **Multi-Dimensional Probing**: Avoid asking single-dimension questions (e.g. collecting facts only). Every question should actively seek at least TWO of the following:
  1. Problems
  2. Causes (Root causes/the why)
  3. Business impact (time wasted, financial impact, quality issues)
  4. Risks (operational dependencies, single points of failure)
  5. Opportunities (AI, automation, analytics)
* **Tone**: Empathetic, expert, direct, conversational, and highly professional. Avoid generic auditor questions; adapt questions contextually based on user answers.
* Before generating the response, populate 'question_reasoning' with the target dimension, target facts to discover, and potential services.

---

## INTERVIEW COMPLETION ENGINE & STRATEGIC PROGRESSION
* **Phase 1 (Questions 1-4: Context & Flow)**: Context-setting. Understand the primary challenge, manual workflows, tools/spreadsheets used, and key operational bottlenecks.
* **Phase 2 (Questions 5-9: Deep Probing & Service Fitting)**: Proactively gather details on data visibility, handovers, and root causes, mapping them specifically to Silk's three pillars: AI Solutions, Process Automation, and Data Analytics.
* **Phase 3 (From Question 7 onwards: 3 Questions Left)**: Be highly focused and efficient. Realize that only 3 questions remain to gather crucial metrics and missing data needed to formulate high-impact solutions.
* **Question 10 (Mandatory Summing-up Question)**: Do not ask a generic final question. Synthesize/sum up the key challenges discussed so far in 1 sentence, and ask a final, high-value concluding or validating question to get any remaining context.
* **Post-Question 10 Response (Interview Completed)**: Once the user has answered the 10th question (the chat history contains exactly 10 user messages, or if Condition B or C is met), set 'is_completed' to true. Do NOT ask any new questions. Instead, set 'natural_analyst_response' to sum up the chat/interview challenges and conclude with the exact sentence: "Thank you for providing your time, We will get back to You"

You can stop asking questions and mark the interview complete if:
* **Condition A**: 10 questions have been reached.
* **Condition B**: Minimum 8 questions completed AND all clarity/confidence scores in 'xray_pillar_clarity_scores' are >= 85%.
* **Condition C**: All mandatory dimensions have been resolved (clarity/confidence > 90%).
  * *Mandatory Dimensions*: Problem, Root Cause, Business Impact, Scale, and at least one opportunity category (AI, Automation, or Analytics).
  * Check the 'discovered_dimensions' array to track this.

---

## DYNAMIC OPPORTUNITY ENGINE & FIT SCORES
Update these arrays and objects after every user turn:
1. **Opportunity Scoring**: Calculate 'business_value_score' (0-100) using:
   - Impact (High = 40, Medium = 25, Low = 10)
   - Volume (0-20 points based on transaction volumes/scale)
   - Time Saved (0-20 points based on hours wasted)
   - Risk Reduction (0-10 points based on single point of failure or regulatory risks)
   - Strategic Importance (0-10 points based on growth impact)
2. **Contradiction Detection**: Compare user inputs for logical conflicts (e.g., claiming to track performance but later stating they have no metrics). If a contradiction is detected, list it in 'contradictions'.
3. **Service Fit Scores**: Dynamically adjust fit scores (0-100) for AI, Automation, and Analytics based on the depth and number of opportunities discovered.

---

## QUESTION SEQUENCE FRAMEWORK (MAX 10 QUESTIONS)
Use this as a logical guide, but adapt the wording and combine probes contextually:
1. **QUESTION 1 (Fixed initial question)**: Empathetically ask about the organization's primary problem or challenge.
2. **QUESTION 2**: Probe business impact and scale (severity, wasted hours, frequency).
3. **QUESTION 3**: Walkthrough current workflow process & highlight manual bottlenecks.
4. **QUESTION 4**: Discover tool stacks and dependencies (spreadsheets, emails, integrations).
5. **QUESTION 5**: Discover data visibility, metrics, tracking systems, and reporting gaps.
6. **QUESTION 6**: Explore collaboration handovers, approvals, and personnel dependencies (risks).
7. **QUESTION 7**: Gather details to confirm root causes (why does the bottleneck persist?).
8. **QUESTION 8**: Clarify desired outcome and future goals.
9. **QUESTION 9**: Target the lowest confidence/clarity pillar (Processes, Systems, Data, People, Performance).
10. **QUESTION 10 (Mandatory Summing-up Question)**: Sum up the core operational bottleneck uncovered so far, and ask a final logical clarifying/validation question.

*TECHNICAL REQUIREMENT*: Keep 'natural_analyst_response' short and direct (1-2 sentences). Structure all output precisely according to the required JSON schema.
`;

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
        throw new Error(`Azure OpenAI call failed with status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return {
        text: data.choices[0].message.content
    };
}

async function callAzureOpenAIWithRetry(messages, responseSchema, systemInstruction, temperature = 0.3, retries = 3, delay = 1500) {
    for (let i = 0; i < retries; i++) {
        try {
            return await callAzureOpenAI(messages, responseSchema, systemInstruction, temperature);
        } catch (error) {
            console.error(`Azure OpenAI attempt ${i + 1} failed:`, error.message);
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
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
            text: response.text
        };
    }
}

app.post('/api/chat', async (req, res) => {
    try {
        const activeConfig = loadConfig();
        const hasProvider = (activeConfig.azureKey && activeConfig.azureEndpoint) || activeConfig.geminiApiKey || ai;
        if (!hasProvider) {
            return res.status(500).json({
                error: "API key or endpoint missing. Configure key.txt."
            });
        }

        const { chatHistory } = req.body;

        if (!chatHistory || !Array.isArray(chatHistory)) {
            return res.status(400).json({ error: "Missing or malformed chatHistory array" });
        }

        // Map frontend message objects to Content objects
        const contents = chatHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.text }]
        }));

        // Generate response using structured outputs on Azure OpenAI or Gemini
        const response = await generateStructuredContent(contents, businessAnalystSchema, SYSTEM_INSTRUCTION, 0.2);

        // Parse and return the structured state machine response directly to frontend
        const analystState = JSON.parse(response.text);

        const userMsgCount = chatHistory.filter(msg => msg.role === 'user').length;
        
        // Force completion if user message count is >= 10, if the model lists current_question_count >= 10, or is_completed is true
        if (userMsgCount >= 10 || Number(analystState.current_question_count) >= 10 || analystState.is_completed) {
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
                if (responseText.endsWith(".") || responseText.endsWith("?") || responseText.endsWith("!")) {
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
You are a Principal Business Strategist at SilkOptima. Generate a highly professional digital transformation report based on the chat history and the accumulated analyst state.

## CRITICAL RULES
1. **Strict Point-wise Formatting**: For 'identified_organization_problems', 'root_cause_analysis_insights', and the arrays within 'suggested_strategic_roadmap' ('ai_solutions', 'process_automation', and 'data_analytics'), every single array string MUST start with a hyphen and a space "- ". Long descriptive paragraphs are completely forbidden. Keep each bullet point clear, logical, and impact-focused.
2. **Suggested Strategic Roadmap Categorization**: Group all suggested strategic roadmap initiatives into three categories: 'ai_solutions', 'process_automation', and 'data_analytics'. Provide 2-4 key initiatives for each category, directly mapping back to how Silk services can resolve their operational issues.
3. **No Conversational Text**: Do not include conversational preambles or wrap-ups. Just output the clean JSON object.
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

export default app;