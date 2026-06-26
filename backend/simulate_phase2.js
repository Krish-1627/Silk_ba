import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPhase2Simulation() {
    console.log("=== PHASE 2 SIMULATION: Healthcare Scenario ===\n");
    const PORT = 3000;
    const url = `http://localhost:${PORT}/api/chat`;
    const reportUrl = `http://localhost:${PORT}/api/generate-report`;

    const chatHistory = [];
    let analystState = {};
    const turnResults = [];

    // 8 turns: Turn 3 directly says "data analytics", Turn 5 indirectly hints AI
    const turns = [
        "We are struggling with patient appointment scheduling and billing in our hospital. Our staff spends hours manually entering patient records from paper forms.",
        "We handle about 200 patients daily and the billing team uses Excel spreadsheets to track payments and insurance claims, often making errors in calculations.",
        "We are looking for data analytics to understand patient flow patterns, peak hours and identify bottlenecks in our scheduling process.",
        "The front desk staff manually calls patients one by one to confirm appointments, and about 30% of our appointment slots go unused due to no-shows.",
        "We need some intelligence in our system that can learn from past patterns and predict which patients are likely to miss appointments, and also match the right specialist to each case automatically.",
        "We lose about 15% of revenue due to billing errors and appointment no-shows every month, and the finance team spends 2 full days reconciling insurance claims.",
        "I don't know",
        "I don't know"
    ];

    for (let i = 0; i < turns.length; i++) {
        const userMsg = turns[i];
        console.log(`\n${'='.repeat(80)}`);
        console.log(`--- TURN ${i + 1} ---`);
        console.log(`User: "${userMsg}"`);
        console.log(`${'='.repeat(80)}`);
        
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

            // Capture detailed engine state for analysis
            const engineState = result.engineState || {};
            const turnData = {
                turnNumber: i + 1,
                userMessage: userMsg,
                assistantResponse: result.natural_analyst_response,
                isCompleted: result.is_completed,
                
                // Fact Extraction
                factExtraction: {
                    extractedFacts: engineState.factExtraction?.extractedFacts || [],
                    extractionQuality: engineState.factExtraction?.extractionQuality || 0
                },
                
                // Extraction Gate
                extractionGate: {
                    factsApproved: engineState.extractionConfidenceGate?.factsApprovedForRegistry?.length || 0,
                    decisionLedger: engineState.extractionConfidenceGate?.decisionLedger || {}
                },
                
                // Evidence Registry
                evidenceRegistry: {
                    totalEvidence: engineState.evidenceRegistry?.evidence?.length || 0,
                    evidence: engineState.evidenceRegistry?.evidence || []
                },
                
                // Feature Vector
                featureVector: engineState.featureVector?.features || {},
                
                // Opportunity Qualification
                opportunities: engineState.opportunityQualification?.opportunities || [],
                lockedServices: engineState.opportunityQualification?.lockedServiceTypes || [],
                pendingServices: engineState.opportunityQualification?.pendingServiceTypes || [],
                
                // Saturation
                saturation: engineState.saturation || {},
                
                // Consistency
                contradictions: engineState.consistency?.contradictions || [],
                
                // Question Planner
                questionPlanner: {
                    nextQuestion: engineState.questionPlanner?.nextQuestion || engineState.questionPlanning?.nextQuestion || {},
                },
                
                // Completion Authority
                completionAuthority: engineState.completionAuthority || {},
                
                // Pillar Scores
                pillarScores: result.xray_pillar_clarity_scores || {},
                
                // Service Fit Scores
                serviceFitScores: result.service_fit_scores || {},
                
                // Deduced Facts
                deducedFacts: result.deduced_operational_facts || [],
                
                // Root Causes
                rootCauses: engineState.rootCause || {}
            };

            turnResults.push(turnData);

            console.log(`\nAssistant: "${result.natural_analyst_response}"`);
            console.log(`\n--- Engine Snapshot ---`);
            console.log(`Pillar Clarity: ${JSON.stringify(result.xray_pillar_clarity_scores)}`);
            console.log(`Deduced Facts Count: ${result.deduced_operational_facts?.length || 0}`);
            console.log(`Evidence Count: ${turnData.evidenceRegistry.totalEvidence}`);
            console.log(`Locked Services: ${JSON.stringify(turnData.lockedServices)}`);
            console.log(`Pending Services: ${JSON.stringify(turnData.pendingServices)}`);
            console.log(`Contradictions: ${turnData.contradictions.length}`);
            console.log(`Service Fit: ${JSON.stringify(result.service_fit_scores)}`);
            console.log(`Is Completed: ${result.is_completed}`);
            
            const qp = turnData.questionPlanner.nextQuestion;
            console.log(`\n--- Question Planner ---`);
            console.log(`Target Dimension: ${qp.targetDimension}`);
            console.log(`Question Intent: ${qp.questionIntent}`);
            console.log(`Evidence Gap: ${qp.evidenceGap}`);
            console.log(`Reasoning: ${qp.reasoning}`);
            console.log(`Service Signals: ${JSON.stringify(qp.serviceSignals)}`);

            chatHistory.push({ role: 'assistant', text: result.natural_analyst_response });

            if (result.is_completed) {
                console.log("\n*** CONVERSATION COMPLETED ***");
            }

        } catch (err) {
            console.error(`Error in Turn ${i + 1}:`, err.message);
            turnResults.push({ turnNumber: i + 1, error: err.message });
            break;
        }
    }

    // Generate report
    console.log("\n\n--- GENERATING FINAL REPORT ---");
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

        // Save full simulation data
        const logPath = path.join(__dirname, 'report', 'phase2-simulation.json');
        fs.writeFileSync(logPath, JSON.stringify({ 
            scenario: 'Healthcare - Patient Scheduling & Billing',
            chatHistory, 
            analystState, 
            turnResults,
            report 
        }, null, 2));
        console.log(`\nSaved simulation results to ${logPath}`);

    } catch (err) {
        console.error("Error generating report:", err.message);
        // Still save partial results
        const logPath = path.join(__dirname, 'report', 'phase2-simulation.json');
        fs.writeFileSync(logPath, JSON.stringify({ 
            scenario: 'Healthcare - Patient Scheduling & Billing',
            chatHistory, 
            analystState,
            turnResults
        }, null, 2));
    }
}

runPhase2Simulation();
