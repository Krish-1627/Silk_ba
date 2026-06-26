import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSimulation() {
    console.log("Starting Silk BI Chat Simulation...");
    const PORT = 3000;
    
    // We will simulate the HTTP requests sent to http://localhost:3000/api/chat
    const url = `http://localhost:${PORT}/api/chat`;
    const reportUrl = `http://localhost:${PORT}/api/generate-report`;

    const chatHistory = [];
    let analystState = {};

    const turns = [
        "We are struggling with inventory management in our warehouse. The team manually copies and pastes data from Excel to our database, taking 15 hours a week.",
        "We have absolutely no visibility of our stock levels, which leads to frequent stockouts.",
        "Actually, we track all stock metrics instantly on our automated real-time dashboards.",
        "We need an intelligent system to predict future demand and match suppliers, but we don't need any AI solutions.",
        "I don't know"
    ];

    for (let i = 0; i < turns.length; i++) {
        const userMsg = turns[i];
        console.log(`\n--- TURN ${i + 1} ---`);
        console.log(`User: "${userMsg}"`);
        
        chatHistory.push({ role: 'user', text: userMsg });

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatHistory, analystState })
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Chat API error (${response.status}): ${text}`);
            }

            const result = await response.json();
            analystState = result;

            console.log(`Analyst: "${result.natural_analyst_response}"`);
            console.log("Pillar Clarity Scores:", JSON.stringify(result.xray_pillar_clarity_scores));
            console.log("Deduced Facts Count:", result.deduced_operational_facts?.length || 0);
            console.log("Contradictions Detected:", JSON.stringify(result.contradictions));
            console.log("Is Completed:", result.is_completed);

            chatHistory.push({ role: 'assistant', text: result.natural_analyst_response });

        } catch (err) {
            console.error(`Error in Turn ${i + 1}:`, err.message);
            break;
        }
    }

    console.log("\n--- GENERATING REPORT ---");
    try {
        const response = await fetch(reportUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatHistory, analystState })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Report API error (${response.status}): ${text}`);
        }

        const report = await response.json();
        console.log("Report generated successfully!");
        console.log(JSON.stringify(report, null, 2));

        // Save simulation log
        const logPath = path.join(__dirname, 'report', 'simulation-run.json');
        fs.writeFileSync(logPath, JSON.stringify({ chatHistory, analystState, report }, null, 2));
        console.log(`Saved simulation results to ${logPath}`);

    } catch (err) {
        console.error("Error generating report:", err.message);
    }
}

// Run the simulation after waiting for the server to spin up
setTimeout(runSimulation, 2000);
