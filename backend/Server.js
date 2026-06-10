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

// Initialize the Google Gen AI SDK
// Reads API key from env or key.txt and tolerates common formats like GEMINI_API_KEY=... or quoted values.
function extractApiKey(rawValue) {
    if (!rawValue || typeof rawValue !== 'string') return '';

    const trimmed = rawValue.trim();
    const firstLine = trimmed.split(/\r?\n/).find(line => line.trim())?.trim() || '';
    const valuePart = firstLine.includes('=') ? firstLine.split('=').slice(1).join('=').trim() : firstLine;
    const unquoted = valuePart.replace(/^['\"]|['\"]$/g, '').trim();

    // Support both classic Google API keys (AIza...) and newer token-style keys (AQ....).
    const explicitMatch = unquoted.match(/(?:AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z._-]{20,})/);
    if (explicitMatch) return explicitMatch[0];

    // Fallback for key files that include only the raw token value.
    return /^[0-9A-Za-z._-]{20,}$/.test(unquoted) ? unquoted : '';
}

function resolveGeminiApiKey() {
    const envKey = extractApiKey(process.env.GEMINI_API_KEY || '');
    if (envKey) return envKey;

    const keyFilePath = path.join(__dirname, 'key.txt');
    if (!fs.existsSync(keyFilePath)) return '';

    const fileValue = fs.readFileSync(keyFilePath, 'utf8');
    return extractApiKey(fileValue);
}

const GEMINI_API_KEY = resolveGeminiApiKey();
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
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
        natural_analyst_response: {
            type: Type.STRING,
            description: "Your human-sounding response. Keep it ultra-short and simple (maximum 1-2 short sentences). Empathetically acknowledge user input in 5-8 words, then ask ONE exceptionally direct, single-focus question."
        }
    },
    required: [
        "deduced_operational_facts",
        "xray_pillar_clarity_scores",
        "current_question_count",
        "next_logical_target",
        "is_absurd_or_meaningless_input",
        "natural_analyst_response"
    ]
};

const SYSTEM_INSTRUCTION = `
You are an elite AI Business Analyst representing the firm SilkOptima. Your objective is to run a logical "Business X-Ray" interview framework to uncover structural inefficiencies, automation candidates, and data visibility gaps.

CORE OPERATIONAL RULES:
1. AKINATOR STRATEGY: Do not follow a static question script. Actively evaluate user inputs, deduct context, and calculate clarity scores. Target your questions strictly at the weakest score area.
2. BREVITY & SIMPLICITY: Your questions must be incredibly simple, short, and bite-sized. Avoid long or multi-part questions. Speak plainly. Use a maximum of 1-2 sentences total for your entire response.
3. EMPATHETIC & GROWN-UP: Sound human. Validate their structural frustrations briefly instead of robotically jumping to the next template item. Avoid all buzzword-heavy sales consulting jargon.
4. ANTI-REPETITION GUARD: Check your "deduced_operational_facts" list before asking anything. If a user previously mentioned a tool or workflow, cross it off mentally. Never ask basic or overlapping discovery questions twice.
5. ABSURD RESPONSE PROTECTION: If the user provides an absurd response (e.g., gibberish, random text), flag "is_absurd_or_meaningless_input" as true, ignore their response, bypass complex topics, and formulate a drastically simplified question to guide them back safely.
6. SESSION TERMINATION: Maximize data collection. The conversation strictly caps at 10 turns.
`;

app.post('/api/chat', async (req, res) => {
    try {
        if (!ai) {
            return res.status(500).json({
                error: "Gemini API key missing or invalid format. Put only the raw API key in key.txt or set GEMINI_API_KEY."
            });
        }

        const { chatHistory } = req.body;

        if (!chatHistory || !Array.isArray(chatHistory)) {
            return res.status(400).json({ error: "Missing or malformed chatHistory array" });
        }

        // Map frontend message objects to Content objects needed by the SDK
        const contents = chatHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.text }]
        }));

        // Call Gemini 2.5 Flash API with strict JSON schema formatting
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
                systemInstruction: SYSTEM_INSTRUCTION,
                responseMimeType: 'application/json',
                responseSchema: businessAnalystSchema,
                temperature: 0.2, // Kept low for highly structured, predictable decision paths
            }
        });

        // Parse and return the structured state machine response directly to frontend
        const analystState = JSON.parse(response.text);

        if (Number(analystState.current_question_count) >= 10) {
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
                xray_pillar_clarity_scores: analystState.xray_pillar_clarity_scores,
                chatHistory: fullChat
            };

            fs.writeFileSync(reportFile, JSON.stringify(reportPayload, null, 2), 'utf8');
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

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`Silk Analyst Backend Live on http://localhost:${PORT}`));