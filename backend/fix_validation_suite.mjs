/**
 * fix_validation_suite.mjs
 *
 * Scenario-based validation of all 5 engine fixes.
 * Runs entirely in-process — no server needed.
 *
 * Usage:  node fix_validation_suite.mjs
 */

import QuestionPlanner from './engines/QuestionPlanner.js';
import ConsistencyEngine from './engines/ConsistencyEngine.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const PASS = '\x1b[32m✔ PASS\x1b[0m';
const FAIL = '\x1b[31m✘ FAIL\x1b[0m';
const HEAD = '\x1b[1;36m';
const RST  = '\x1b[0m';

let totalTests = 0;
let passed     = 0;
const results  = [];

function test(suiteName, caseName, condition, got, expected) {
  totalTests++;
  const ok = Boolean(condition);
  if (ok) passed++;
  const status = ok ? PASS : FAIL;
  console.log(`  ${status} ${caseName}`);
  if (!ok) {
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         got     : ${JSON.stringify(got)}`);
  }
  results.push({ suite: suiteName, case: caseName, ok, got, expected });
}

function header(title) {
  console.log(`\n${HEAD}━━━ ${title} ${'━'.repeat(Math.max(0, 60 - title.length))}${RST}`);
}

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const BASE_UNCERTAINTY_MATRIX = {
  problemUnderstanding:  { currentUncertainty: 0.8, impact_if_resolved: 0.9, evidence_needed: ['problem_statement'] },
  impactQuantification:  { currentUncertainty: 0.9, impact_if_resolved: 0.95, evidence_needed: ['revenue_loss', 'time_cost'] },
  rootCauseDepth:        { currentUncertainty: 0.7, impact_if_resolved: 0.8, evidence_needed: ['root_cause'] },
  processDocumentation:  { currentUncertainty: 0.6, impact_if_resolved: 0.7, evidence_needed: ['process_definition'] },
  toolStackClarity:      { currentUncertainty: 0.5, impact_if_resolved: 0.6, evidence_needed: ['software_tool'] },
  opportunityDepth:      { currentUncertainty: 0.4, impact_if_resolved: 0.5, evidence_needed: ['automation_signal'] },
  userPainQuantification:{ currentUncertainty: 0.5, impact_if_resolved: 0.6, evidence_needed: ['frustration_signal'] },
  evidenceCompleteness:  { currentUncertainty: 0.3, impact_if_resolved: 0.4, evidence_needed: ['missing_evidence'] },
};

const BASE_SATURATION = {
  saturation: {
    problemUnderstanding: 0.2, impactQuantification: 0.1, rootCauseDepth: 0.3,
    processDocumentation: 0.4, toolStackClarity: 0.5, opportunityDepth: 0.6,
    userPainQuantification: 0.5, evidenceCompleteness: 0.7
  },
  overallSaturation: 0.4
};

const BASE_FEATURE_VECTOR = [0.2, 0.1, 0.3, 0.4, 0.5, 0.0, 0.6, 0.5];

const IDK_MSGS = [
  { role: 'silk', text: 'Can you quantify the revenue impact?' },
  { role: 'user', text: "I don't know the exact revenue loss" },
  { role: 'silk', text: 'Even a rough estimate would help — what range do you think?' },
  { role: 'user', text: "Not sure, no idea at all" },
];

// Rich evidence for a real session
const RICH_EVIDENCE = [
  { evidenceId: 'e1', statement: 'Team manually enters 200 invoices a day into SAP', category: 'process', confidence: 0.9 },
  { evidenceId: 'e2', statement: 'No visibility into stock levels across warehouses', category: 'problem', confidence: 0.85 },
  { evidenceId: 'e3', statement: 'Hiring process takes 6 weeks due to manual resume screening', category: 'process', confidence: 0.88 },
  { evidenceId: 'e4', statement: 'Revenue loss estimated at 15% due to stockouts', category: 'metric', confidence: 0.92 },
  { evidanceId: 'e5', statement: 'Staff spend 3 hours daily compiling demand reports in Excel', category: 'process', confidence: 0.87 },
  { evidenceId: 'e6', statement: 'No automated alerts for low inventory', category: 'problem', confidence: 0.83 },
  { evidenceId: 'e7', statement: 'Candidates are evaluated one-by-one with no scoring system', category: 'process', confidence: 0.86 },
  { evidenceId: 'e8', statement: '30% increase in onboarding time due to manual document checks', category: 'metric', confidence: 0.9 },
  { evidenceId: 'e9', statement: 'Hard to know which products will run out before month end', category: 'problem', confidence: 0.84 },
];

const qp = new QuestionPlanner();
const ce = new ConsistencyEngine();

// ════════════════════════════════════════════════════════════════════════════
// ISSUE 1 — "I Don't Know" Repetition Loop
// ════════════════════════════════════════════════════════════════════════════
header('ISSUE 1 — "I Don\'t Know" Repetition Loop Fix');

// Scenario: User said IDK to impactQuantification twice → it must be in evadedDimensions.
// The planner must NOT re-select impactQuantification next turn.
{
  const result = qp.planNextQuestion(
    BASE_UNCERTAINTY_MATRIX,
    BASE_SATURATION,
    BASE_FEATURE_VECTOR,
    IDK_MSGS,
    [],                          // evidence
    'impactQuantification',      // previousTargetDimension
    true,                        // zeroFactsExtracted (last turn yielded nothing)
    [],                          // opportunities
    [],                          // unanswerableDimensions
    false,                       // topicShiftDetected
    [],                          // lockedServiceTypes
    [],                          // pendingServiceTypes
    [],                          // contradictions
    ['impactQuantification']     // evadedDimensions ← THE FIX
  );

  test(
    'Issue 1',
    'After 2x IDK on impactQuantification, planner selects a DIFFERENT dimension',
    result.targetDimension !== 'impactQuantification',
    result.targetDimension,
    '!== impactQuantification'
  );

  test(
    'Issue 1',
    'Selected dimension is still a valid planning dimension (not complete)',
    result.targetDimension !== 'complete' && result.targetDimension !== null,
    result.targetDimension,
    'a valid non-complete dimension'
  );

  // Regression check:
  // Old code had no persistent memory — after the ONE-TURN -500 penalty expires,
  // impactQuantification (score 0.9×0.95=0.855) wins again immediately.
  // We simulate "next turn": zeroFactsExtracted=false (penalty gone), no evadedDimensions.
  const resultOLD = qp.planNextQuestion(
    BASE_UNCERTAINTY_MATRIX, BASE_SATURATION, BASE_FEATURE_VECTOR,
    IDK_MSGS,
    [],
    'rootCauseDepth',   // previousTarget is now a DIFFERENT dimension (simulating next turn)
    false,              // zeroFactsExtracted=false → the -500 penalty is NOT active
    [], [], false, [], [], [],
    []                  // no evadedDimensions = old broken behaviour
  );
  test(
    'Issue 1',
    'REGRESSION CHECK: Without evadedDimensions, impactQuantification wins again next turn',
    resultOLD.targetDimension === 'impactQuantification',
    resultOLD.targetDimension,
    'impactQuantification (old broken re-selection)'
  );

  // New code WITH evadedDimensions: impactQuantification is blocked permanently
  const resultNEW = qp.planNextQuestion(
    BASE_UNCERTAINTY_MATRIX, BASE_SATURATION, BASE_FEATURE_VECTOR,
    IDK_MSGS,
    [],
    'rootCauseDepth',
    false,
    [], [], false, [], [], [],
    ['impactQuantification']   // new persistent eviction memory
  );
  test(
    'Issue 1',
    'WITH evadedDimensions fix: impactQuantification is permanently blocked even next turn',
    resultNEW.targetDimension !== 'impactQuantification',
    resultNEW.targetDimension,
    '!== impactQuantification'
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ISSUE 2 — Semantic Service Tagging
// ════════════════════════════════════════════════════════════════════════════
header('ISSUE 2 — Semantic Service Tagging Fix');

{
  // Indirect automation language — no classic keywords like "manual" or "excel"
  const indirectEvidence = [
    { statement: 'Our staff hand-types data into legacy software every morning', category: 'process', confidence: 0.8 },
    { statement: 'The team re-keys information one by one into the old system', category: 'process', confidence: 0.8 },
  ];

  const signals = qp.calculateServiceSignals(indirectEvidence);

  test(
    'Issue 2',
    '"hand-types data into legacy software" correctly scores automation signal > 0',
    signals.automation > 0,
    signals.automation,
    '> 0'
  );

  test(
    'Issue 2',
    '"re-keys information one by one" also boosts automation score',
    signals.automation >= 2.4,
    signals.automation,
    '>= 2.4 (at least 2 semantic hits at 1.2 each)'
  );

  // Indirect analytics language
  const analyticsEvidence = [
    { statement: 'We are flying blind — no real-time view of what is happening', category: 'problem', confidence: 0.8 },
    { statement: 'Managers rely on gut feel to make ordering decisions', category: 'problem', confidence: 0.8 },
  ];
  const aSignals = qp.calculateServiceSignals(analyticsEvidence);
  test(
    'Issue 2',
    '"flying blind" and "gut feel" correctly score analytics signal > 0',
    aSignals.analytics > 0,
    aSignals.analytics,
    '> 0'
  );

  // Indirect AI language
  const aiEvidence = [
    { statement: 'We have too many applicants and it is hard to pick the right one', category: 'problem', confidence: 0.8 },
    { statement: 'The team manually screens every resume one by one', category: 'process', confidence: 0.8 },
  ];
  const aiSignals = qp.calculateServiceSignals(aiEvidence);
  test(
    'Issue 2',
    '"too many applicants hard to pick" correctly scores ai_solutions signal > 0',
    aiSignals.ai_solutions > 0,
    aiSignals.ai_solutions,
    '> 0'
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ISSUE 3 — Numeric Contradiction Detection
// ════════════════════════════════════════════════════════════════════════════
header('ISSUE 3 — Numeric Contradiction Detection Fix');

{
  // Classic numeric contradiction: same subject (claims), 1000x ratio
  const claimsEvidence = [
    { evidenceId: 'c1', statement: 'We process 5 claims a day', category: 'metric', confidence: 0.85 },
    { evidenceId: 'c2', statement: 'Our daily claims volume is 5,000', category: 'metric', confidence: 0.85 },
  ];
  const out1 = await ce.execute({ evidence: claimsEvidence }, { logger: console });
  test(
    'Issue 3',
    '"5 claims/day" vs "5,000 claims/day" is flagged as a contradiction',
    out1.contradictions.length > 0,
    out1.contradictions.length,
    '> 0'
  );

  // Edge: same subject, 10x ratio exactly (boundary)
  const boundaryEvidence = [
    { evidenceId: 'b1', statement: 'team size is 3 people on this project', category: 'process', confidence: 0.8 },
    { evidenceId: 'b2', statement: 'we have 30 staff working on this project', category: 'process', confidence: 0.8 },
  ];
  const out2 = await ce.execute({ evidence: boundaryEvidence }, { logger: console });
  test(
    'Issue 3',
    '3 vs 30 (10x) on same subject flagged as contradiction',
    out2.contradictions.length > 0,
    out2.contradictions.length,
    '> 0'
  );

  // Non-contradiction: 9x ratio should NOT trigger (below threshold)
  const noContra = [
    { evidenceId: 'n1', statement: 'we handle about 10 orders per shift', category: 'metric', confidence: 0.8 },
    { evidenceId: 'n2', statement: 'daily order volume across all shifts is around 90', category: 'metric', confidence: 0.8 },
  ];
  const out3 = await ce.execute({ evidence: noContra }, { logger: console });
  test(
    'Issue 3',
    '10 vs 90 (9x ratio) does NOT trigger contradiction (below 10x threshold)',
    out3.contradictions.length === 0,
    out3.contradictions.length,
    '0'
  );

  // Non-contradiction: different subjects — should not trigger
  const diffSubject = [
    { evidenceId: 'd1', statement: 'team size is 3 people', category: 'process', confidence: 0.8 },
    { evidenceId: 'd2', statement: 'we processed 5,000 invoices this month', category: 'metric', confidence: 0.8 },
  ];
  const out4 = await ce.execute({ evidence: diffSubject }, { logger: console });
  test(
    'Issue 3',
    'Different subjects (team size vs invoice volume) do NOT produce false contradiction',
    out4.contradictions.length === 0,
    out4.contradictions.length,
    '0'
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ISSUE 4 — Smart Turn Caps (min=6, max=10)
// ════════════════════════════════════════════════════════════════════════════
header('ISSUE 4 — Smart Turn Caps Flowchart Fix');

// Build conversation histories of varying lengths
function makeHistory(userTexts) {
  const h = [];
  userTexts.forEach((t, i) => {
    h.push({ role: 'silk', text: `Question ${i + 1}?` });
    h.push({ role: 'user', text: t });
  });
  return h;
}

{
  // 4a — Hard minimum: should NOT close at turn 4 even with overwhelming signal
  const hist4 = makeHistory([
    'We have a big manual data entry problem',
    'It takes 4 hours every day',
    'We also have no visibility into stock',
    'I estimate we lose 20% revenue',
  ]);
  const r4a = qp.planNextQuestion(
    BASE_UNCERTAINTY_MATRIX, BASE_SATURATION, BASE_FEATURE_VECTOR,
    hist4, RICH_EVIDENCE, null, false,
    [], [], false,
    ['automation', 'analytics'],  // 2 services locked
    [], [], []
  );
  test(
    'Issue 4',
    'Turn 4 with 2 locked services: must NOT close (min=6 enforced)',
    r4a.targetDimension !== 'complete',
    r4a.targetDimension,
    '!== complete'
  );

  // 4b — Rich early close at turn 6 (all 3 services explored, >=6 evidence)
  const hist6 = makeHistory([
    'Manual invoicing takes hours', 'Revenue lost due to stockouts',
    'We screen resumes manually', 'No dashboard for managers',
    'Stock alerts are missing', 'Team types data by hand',
  ]);
  const r4b = qp.planNextQuestion(
    BASE_UNCERTAINTY_MATRIX, BASE_SATURATION, BASE_FEATURE_VECTOR,
    hist6, RICH_EVIDENCE, null, false,
    [], [], false,
    ['automation', 'analytics', 'ai_solutions'],  // all 3 locked
    [], [], []
  );
  test(
    'Issue 4',
    'Turn 6 + all 3 services locked + rich evidence: closes early (isReadyToPitch)',
    r4b.targetDimension === 'complete',
    r4b.targetDimension,
    'complete'
  );

  // 4c — Consecutive IDK after turn 5, >=2 leads locked → one final context question
  const histIDK6 = makeHistory([
    'We have major manual invoicing problems',     // turn 1 (substantive)
    'Revenue impact is around 15%',               // turn 2 (substantive)
    'We also have poor stock visibility',         // turn 3 (substantive)
    'Maybe our AI matching could help too',       // turn 4 (substantive)
    "I don't know the details",                   // turn 5 (evasive)
    "Not sure, no idea",                          // turn 6 (evasive)
  ]);
  const r4c = qp.planNextQuestion(
    BASE_UNCERTAINTY_MATRIX, BASE_SATURATION, BASE_FEATURE_VECTOR,
    histIDK6, [], null, true,
    [], [], false,
    ['automation', 'analytics'],  // 2 leads locked
    [], [], []
  );
  test(
    'Issue 4',
    'Turn 6, consecutive IDK, 2 leads locked → fires final_context_close (one last question)',
    r4c.targetDimension === 'final_context_close',
    r4c.targetDimension,
    'final_context_close'
  );

  // 4d — Final context question asked, user still IDK → CLOSE NOW
  const r4d = qp.planNextQuestion(
    BASE_UNCERTAINTY_MATRIX, BASE_SATURATION, BASE_FEATURE_VECTOR,
    histIDK6, [], 'final_context_close', true,  // previousTargetDimension = final_context_close, zero facts
    [], [], false,
    ['automation', 'analytics'],
    [], [], []
  );
  test(
    'Issue 4',
    'After final_context_close asked + no answer → closes interview (targetDimension=complete)',
    r4d.targetDimension === 'complete',
    r4d.targetDimension,
    'complete'
  );

  // 4e — Consecutive IDK but only 1 lead locked → must NOT close, continue to turn 10
  const r4e = qp.planNextQuestion(
    BASE_UNCERTAINTY_MATRIX, BASE_SATURATION, BASE_FEATURE_VECTOR,
    histIDK6, [], null, true,
    [], [], false,
    ['automation'],  // only 1 lead locked — not enough to trigger final question
    [], [], []
  );
  test(
    'Issue 4',
    'Turn 6, consecutive IDK, only 1 lead locked → must NOT close early (continue to turn 10)',
    r4e.targetDimension !== 'complete' && r4e.targetDimension !== 'final_context_close',
    r4e.targetDimension,
    '!== complete and !== final_context_close'
  );

  // 4f — Hard cap: turn 10 always closes regardless
  const hist10 = makeHistory([
    'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10'
  ]);
  const r4f = qp.planNextQuestion(
    BASE_UNCERTAINTY_MATRIX, BASE_SATURATION, BASE_FEATURE_VECTOR,
    hist10, [], null, false,
    [], [], false,
    ['automation'],  // only 1 lead — would not close early, but turn 10 forces it
    [], [], []
  );
  test(
    'Issue 4',
    'Turn 10 (hard cap): always closes regardless of lead count',
    r4f.targetDimension === 'complete',
    r4f.targetDimension,
    'complete'
  );

  // 4g — Turn 5: even if 2 leads are locked, must NOT close (min=6)
  const hist5 = makeHistory(['Q1', 'Q2', 'Q3', "I don't know", "Not sure"]);
  const r4g = qp.planNextQuestion(
    BASE_UNCERTAINTY_MATRIX, BASE_SATURATION, BASE_FEATURE_VECTOR,
    hist5, [], null, true,
    [], [], false,
    ['automation', 'analytics'],   // 2 leads
    [], [], []
  );
  test(
    'Issue 4',
    'Turn 5 consecutive IDK with 2 leads: still asks final_context_close (turns >= 5, enforced)',
    // turns=5 (10/2=5), so consecutive IDK with 2 leads → final_context_close
    r4g.targetDimension === 'final_context_close',
    r4g.targetDimension,
    'final_context_close'
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ISSUE 5 — No Memory of Rejected Questions
// ════════════════════════════════════════════════════════════════════════════
header('ISSUE 5 — Persistent Rejected Question Memory Fix');

{
  // Simulate: user said skip to processDocumentation AND toolStackClarity
  // Those dimensions must never be selected again
  const evaded = ['processDocumentation', 'toolStackClarity'];
  const normalHistory = [
    { role: 'silk', text: 'Tell me about your processes?' },
    { role: 'user', text: 'skip' },
    { role: 'silk', text: 'What tools do you use?' },
    { role: 'user', text: 'pass' },
  ];

  const r5a = qp.planNextQuestion(
    BASE_UNCERTAINTY_MATRIX, BASE_SATURATION, BASE_FEATURE_VECTOR,
    normalHistory, [], 'toolStackClarity', true,
    [], [], false,
    [], [], [], evaded
  );
  test(
    'Issue 5',
    'After "skip" on processDocumentation: planner never re-selects it',
    !evaded.includes(r5a.targetDimension),
    r5a.targetDimension,
    `not in [${evaded.join(', ')}]`
  );

  // Ensure all 8 dimensions can still be probed — only evaded ones are blocked
  test(
    'Issue 5',
    'Planner still selects a productive dimension despite evasion list',
    ['problemUnderstanding','impactQuantification','rootCauseDepth',
     'opportunityDepth','userPainQuantification','evidenceCompleteness'].includes(r5a.targetDimension),
    r5a.targetDimension,
    'one of the remaining valid dimensions'
  );

  // Topic shift: if topicShiftDetected, Server.js pushes previousTargetDimension to evadedDimensions.
  // Here we verify that if a dimension is in evadedDimensions, it gets -1000 score (same as Issue 1/5 combined).
  const matrixHighProcess = {
    ...BASE_UNCERTAINTY_MATRIX,
    processDocumentation: { currentUncertainty: 0.99, impact_if_resolved: 0.99, evidence_needed: ['x'] }, // very high without fix
  };
  const r5b = qp.planNextQuestion(
    matrixHighProcess, BASE_SATURATION, BASE_FEATURE_VECTOR,
    [], [], null, false,
    [], [], false,
    [], [], [], ['processDocumentation']  // evaded even though it would normally win
  );
  test(
    'Issue 5',
    'Even with highest uncertainty score, evaded dimension is NOT selected (penalty overrides)',
    r5b.targetDimension !== 'processDocumentation',
    r5b.targetDimension,
    '!== processDocumentation'
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FINAL REPORT
// ════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(65));
console.log(`TOTAL: ${passed}/${totalTests} tests passed`);
console.log('═'.repeat(65));

// Machine-readable JSON output for the artifact
const report = {
  runAt: new Date().toISOString(),
  summary: { total: totalTests, passed, failed: totalTests - passed },
  byIssue: {
    'Issue 1 — IDK Repetition Loop':        results.filter(r => r.suite === 'Issue 1'),
    'Issue 2 — Semantic Service Tagging':   results.filter(r => r.suite === 'Issue 2'),
    'Issue 3 — Numeric Contradiction':      results.filter(r => r.suite === 'Issue 3'),
    'Issue 4 — Smart Turn Caps':            results.filter(r => r.suite === 'Issue 4'),
    'Issue 5 — Rejected Question Memory':   results.filter(r => r.suite === 'Issue 5'),
  }
};

import { writeFileSync } from 'fs';
writeFileSync('./fix_validation_results.json', JSON.stringify(report, null, 2));
console.log('\nDetailed results saved → fix_validation_results.json');

process.exit(passed === totalTests ? 0 : 1);
