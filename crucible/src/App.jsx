import { useState, useEffect, useRef, useCallback } from "react";

// ── Palette ────────────────────────────────────────────────────────────────────
const A    = "#5da8a0";
const A_LT = "#8ececa";
const A_BG = "#071d1c";
const A_BD = "#0e3632";

// Text hierarchy — all brightened for legibility
const T1 = "#ccd8e4";   // primary — titles, headings
const T2 = "#8ab8c8";   // secondary — field labels, section names
const T3 = "#6a9aaa";   // body — feedback text, descriptions
const T4 = "#4a7888";   // tertiary — meta, case tags, dim notes
const T5 = "#304858";   // muted — timestamps, word count

const FF   = '"Plus Jakarta Sans", -apple-system, sans-serif';
const MONO = '"DM Mono", "Courier New", monospace';

// ── Mouse config ───────────────────────────────────────────────────────────────
const BTN_ACTIONS    = [{value:"window",label:"Window / Level"},{value:"zoom",label:"Zoom"},{value:"pan",label:"Pan"},{value:"none",label:"None"}];
const SCROLL_ACTIONS = [{value:"series",label:"Series / Slice"},{value:"zoom",label:"Zoom"}];
const DEFAULT_MOUSE  = {left:"window",middle:"pan",right:"zoom",scroll:"series"};

// ── Structured field definitions ───────────────────────────────────────────────
const SF = [
  {key:"lungs",       label:"Lungs",                ph:"Describe lung fields bilaterally. Note any opacities, consolidation, nodules, or asymmetric markings."},
  {key:"pleural",     label:"Pleural Spaces",       ph:"Costophrenic angles, pleural effusion, pneumothorax, pleural thickening."},
  {key:"cardiac",     label:"Cardiomediastinal",    ph:"Heart size and contour, mediastinal width, aortic knob, tracheal position."},
  {key:"hila",        label:"Hila",                 ph:"Hilar size, position, and density bilaterally."},
  {key:"bones",       label:"Bones & Soft Tissues", ph:"Ribs, clavicles, scapulae, spine. Soft tissue contours."},
  {key:"subdiaphragm",label:"Subdiaphragmatic",     ph:"Hemidiaphragm contours, free subdiaphragmatic gas, visible bowel gas pattern."},
  {key:"devices",     label:"Devices & Lines",      ph:"Any medical devices, monitoring lines, or tubes visible."},
];
const BLANK_SF  = Object.fromEntries(SF.map(f=>[f.key,""]));
const UNREM = {
  lungs:       "Lungs clear bilaterally. No focal opacities, consolidation, or pleural effusion.",
  pleural:     "No pleural effusion. Costophrenic angles sharp bilaterally. No pneumothorax.",
  cardiac:     "Cardiomediastinal silhouette within normal limits. Trachea central.",
  hila:        "Hila normal in size, position, and density bilaterally.",
  bones:       "No significant osseous abnormality. Soft tissues unremarkable.",
  subdiaphragm:"No free subdiaphragmatic gas. Visualised bowel gas pattern unremarkable.",
  devices:     "No medical devices or lines identified.",
};

// ── Case data ──────────────────────────────────────────────────────────────────
const CASE = {
  id:"RC-2024-0471", description:"Chest PA + Lateral", date:"2024-11-14",
  useClass:"prototype",
  difficulty:"Senior Resident",
  clinicalHistory:"65M with progressive dyspnoea ×3 weeks. PMHx: hypertension, T2DM. No prior imaging available for comparison.",
  technique:"PA and lateral chest radiographs obtained with standard technique. Adequate positioning and inspiratory effort.",
  referenceFindings:`Increased airspace opacities in the right lower lobe compatible with focal consolidation.
Small right-sided pleural effusion.
Cardiomediastinal silhouette is within normal limits.
No significant osseous abnormality.`,
  referenceImpression: "Right lower lobe consolidation with small right-sided pleural effusion. Clinical correlation recommended.",
};


// ── Rubric version metadata ────────────────────────────────────────────────────
// Version bumps when a reviewer marks a flagged finding as legitimate.
// Historical trainee scores remain tagged to the version they were assessed under.
const INITIAL_RUBRIC_META = {
  version: "1.1",
  history: [
    { version: "1.0", date: "2024-11-14", author: "System",
      note: "Initial rubric — reference findings defined." },
    { version: "1.1", date: "2024-12-01", author: "Dr. Board-Certified",
      note: "Three-tier overcall classification added. Reference impression confirmed." },
  ]
};

const defaultMode = d => ["PGY1-2","Junior Resident"].includes(d) ? "structured" : "free";

// ── Mode conversion helpers ───────────────────────────────────────────────────

// Guided → Free: compile structured fields into flowing prose (no API call)
function structuredToFree(fields) {
  const LABELS = {
    lungs:"Lungs", pleural:"Pleural Spaces", cardiac:"Cardiomediastinal",
    hila:"Hila", bones:"Bones & Soft Tissues",
    subdiaphragm:"Subdiaphragmatic", devices:"Devices & Lines",
  };
  const order = ["lungs","pleural","cardiac","hila","bones","subdiaphragm","devices"];
  return order
    .map(k => {
      const val = (fields[k]||"").trim();
      if(!val) return null;
      const text = val.endsWith(".")||val.endsWith("?")||val.endsWith("!") ? val : val+".";
      return `${LABELS[k]}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

// Free → Guided: Claude Haiku parses free text into anatomical fields
async function parseToStructured(findings, impression, onComplete, onError) {
  try {
    const resp = await fetch("/api/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"claude-haiku-4-5-20251001",
        max_tokens:700,
        messages:[{role:"user",content:
`Parse this chest radiograph report into structured anatomical sections.
Extract only what is explicitly stated for each region. If a region is not mentioned, return empty string.
Do NOT infer or add findings not present in the source text.

FINDINGS:
${findings||"[empty]"}

IMPRESSION:
${impression||"[empty]"}

Return ONLY valid JSON, no markdown:
{
  "lungs":        "<lung fields text or empty string>",
  "pleural":      "<pleural spaces text or empty string>",
  "cardiac":      "<cardiomediastinal text or empty string>",
  "hila":         "<hilar text or empty string>",
  "bones":        "<bones and soft tissues text or empty string>",
  "subdiaphragm": "<subdiaphragmatic text or empty string>",
  "devices":      "<devices and lines text or empty string>",
  "impression":   "<impression text or empty string>"
}`
        }],
      }),
    });
    if(!resp.ok) throw new Error(`API error ${resp.status}`);
    const data  = await resp.json();
    const raw   = data.content.map(b=>b.text||"").join("");
    const match = raw.replace(/\`\`\`json|\`\`\`/gi,"").trim().match(/\{[\s\S]*\}/);
    if(!match) throw new Error("Could not parse response");
    const parsed = JSON.parse(match[0]);
    onComplete({
      fields: {
        lungs:        parsed.lungs        || "",
        pleural:      parsed.pleural      || "",
        cardiac:      parsed.cardiac      || "",
        hila:         parsed.hila         || "",
        bones:        parsed.bones        || "",
        subdiaphragm: parsed.subdiaphragm || "",
        devices:      parsed.devices      || "",
      },
      impression: parsed.impression || "",
    });
  } catch(err){ onError(err.message??"Conversion failed — please try again."); }
}

// ── Prompt ─────────────────────────────────────────────────────────────────────
function buildPrompt(mode, fields, findings, impression) {
  const reportBlock = mode === "structured"
    ? `TRAINEE'S REPORT (Guided Mode):
LUNGS: ${fields.lungs||"[Not described]"}
PLEURAL SPACES: ${fields.pleural||"[Not described]"}
CARDIOMEDIASTINAL: ${fields.cardiac||"[Not described]"}
HILA: ${fields.hila||"[Not described]"}
BONES & SOFT TISSUES: ${fields.bones||"[Not described]"}
SUBDIAPHRAGMATIC: ${fields.subdiaphragm||"[Not described]"}
DEVICES & LINES: ${fields.devices||"[Not described]"}
IMPRESSION: ${impression||"[Not provided]"}`
    : `TRAINEE'S REPORT (Free Dictation):
FINDINGS:\n${findings||"[None]"}
IMPRESSION:\n${impression||"[None]"}`;

  return `You are an expert radiology educator evaluating a trainee's chest radiograph report.

CASE: ${CASE.clinicalHistory}

REFERENCE (board-certified radiologist):
FINDINGS:
${CASE.referenceFindings}
IMPRESSION:
${CASE.referenceImpression}

${reportBlock}

CORE PRINCIPLE — ABSENCE EQUALS NORMAL:
Any structure or finding NOT mentioned in the reference report must be treated as normal/unremarkable by default.
Apply the following THREE-TIER classification when the trainee reports something not in the reference:

TIER 1 — CONFIRMED OVERCALL:
The finding is clearly contradicted by or incompatible with the reference (e.g., trainee reports left-sided consolidation when the reference left lung is unremarkable; trainee reports cardiomegaly when the reference states cardiomediastinal silhouette is normal).
→ Flag explicitly as an overcall. Penalise in the relevant rubric category. Explain why it is unsupported.

TIER 2 — POSSIBLE BUT UNVERIFIABLE:
The finding is not in the reference but is not clearly contradicted either. It may represent a subtle finding below the expert's reporting threshold, a genuine perception difference, or a legitimate variant.
Examples: subtle increased markings, minor vascular prominence, trace blunting not mentioned in reference.
→ Do NOT penalise. Do NOT credit. State clearly: "This finding is not described in the reference report and cannot be confirmed or excluded from the current reference. Flagged for radiologist review."
→ Set a flag in your response for this item: "review_flag": true

TIER 3 — POSSIBLE CORRECT ADDITION (rare):
The trainee identifies something that appears genuinely present and clinically significant, that the reference did not mention. This reflects perceptiveness that may exceed the reference.
→ Acknowledge positively. Do not penalise. Note that the reference may warrant updating.
→ Set "review_flag": true for this item as well.

- If the trainee reports a region as normal/unremarkable and the reference does not mention that region, this is CORRECT — acknowledge positively.
- Apply this three-tier principle to both findings and impression sections.

RUBRIC:
1. SYSTEMATIC COMPLETENESS (0–100): % of expected CXR regions addressed (cardiomediastinal, lungs bilateral, pleural spaces, hila, bones/soft tissues, subdiaphragmatic). Penalise both missed regions AND regions described with findings not supported by the reference.
2. PRIMARY FINDING ACCURACY (Likert→0–100): Evaluate accuracy in BOTH directions. 1=primary finding missed entirely(0-20), 2=primary finding wrong or a major overcall present(21-40), 3=correct but incomplete(41-60), 4=correct with minor gaps or minor overcalls(61-80), 5=complete, accurate, no unsupported findings(81-100).
3. CRITICAL FINDING IDENTIFICATION (0–100): Both consolidation AND effusion correctly identified=100; one identified=60; neither=0. Deduct 20 points for any additional critical-level finding reported that is not in the reference (overcalled critical finding).
4. IMPRESSION QUALITY (Likert→0–100): Compare directly against reference impression. 1=absent/entirely wrong(0-20), 2=partial or contains unsupported diagnosis(21-40), 3=correct primary finding, minor issues(41-60), 4=correct and concise(61-80), 5=matches reference in content and style(81-100). Flag any diagnostic conclusions in the impression not supported by the reference findings.
5. TERMINOLOGY (1–3→0–100): 1=imprecise or incorrect(0-33), 2=mostly appropriate(34-66), 3=precise and consistent with reference style(67-100).

WEIGHTS: completeness 20%, primary 25%, critical 25%, impression 20%, terminology 10%.
GRADE: A(90+) A-(85-89) B+(80-84) B(75-79) B-(70-74) C+(65-69) C(60-64) <60=needs work.

IMPORTANT — feedback format:
- For each section provide TWO levels of feedback:
  detail_short: exactly ONE sentence (max 20 words). The single most important point, including any overcall if present.
  detail_long: TWO to THREE sentences (max 60 words). Specific, actionable, educational. Name any overcalled or missed findings explicitly.
- Also provide summary_short (one sentence, max 25 words) and summary_long (two sentences, max 50 words).
- If the trainee's report is accurate and complete with no overcalls, say so clearly — positive reinforcement matters.
- For each section assign a sentiment:
  "correct"   → trainee performed well; finding correctly identified, well described, impression accurate.
  "incorrect" → clear error; missed finding, confirmed overcall, wrong characterisation, absent impression.
  "uncertain" → mixed, partial, Tier 2/3 flag, borderline, or cannot fully assess.
- For each section include "annotations": an array identifying SPECIFIC PHRASES from the trainee's
  text with individual sentiments. This enables phrase-level highlighting in the UI.
  Rules:
  • Copy each phrase EXACTLY as the trainee wrote it (verbatim substring match required).
  • A single field can contain multiple phrases with DIFFERENT sentiments — annotate each separately.
  • Example: trainee writes "RLL consolidation and possible LUL opacity" →
    [{"text":"RLL consolidation","sentiment":"correct"},{"text":"possible LUL opacity","sentiment":"uncertain"}]
  • Only annotate findings/descriptions — not connecting words like "and", "with", "no".
  • If the entire field content has one sentiment, a single annotation covering the key phrase is enough.
  • Use empty array [] if nothing specific to annotate in a section.

Return ONLY valid JSON, no markdown:
{
  "overall": <int>,
  "grade": "<string>",
  "summary_short": "<one sentence>",
  "summary_long": "<two sentences>",
  "sections": [
    {
      "label": "<string>",
      "score": <int>,
      "sentiment": "<correct | incorrect | uncertain>",
      "detail_short": "<one sentence>",
      "detail_long": "<two to three sentences>",
      "review_flag": <true if Tier 2 or Tier 3 finding present in this section, otherwise false>,
      "review_tier": <2 for "possible but unverifiable", 3 for "possible correct addition", null if no flag>,
      "review_note": "<one sentence describing the flagged finding, or null if no flag>",
      "annotations": [{"text":"<exact phrase from trainee>","sentiment":"<correct|incorrect|uncertain>"}]
    }
  ]
}`;
}

// ── Streaming API ──────────────────────────────────────────────────────────────
// Haiku is fast enough (~1-2s) that non-streaming is simpler and more reliable
// in sandboxed browser environments where TCP close signals are unpredictable.
async function evaluateReport(prompt, onComplete, onError) {
  try {
    const resp = await fetch("/api/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"claude-haiku-4-5-20251001",
        max_tokens:1400,
        messages:[{role:"user",content:prompt}],
      }),
    });
    if(!resp.ok){
      const errText = await resp.text().catch(()=>"");
      throw new Error(`API error ${resp.status}${errText?`: ${errText.slice(0,120)}`:""}`)
    }
    const data     = await resp.json();
    const raw      = data.content.map(b=>b.text||"").join("");
    const stripped = raw.replace(/```json|```/gi,"").trim();
    const match    = stripped.match(/\{[\s\S]*\}/);
    if(!match) throw new Error(`Unexpected response. Preview: ${stripped.slice(0,120)}`);
    onComplete(JSON.parse(match[0]));
  }catch(err){ onError(err.message??"Feedback service unavailable."); }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const scoreColor = s=>s>=85?"#4cae82":s>=70?"#c49a3a":"#b85050";
const fmt = s=>`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
const mouseHint = m=>{
  const l={window:"W/L",zoom:"Zoom",pan:"Pan",none:"—",series:"Series"};
  return `L:${l[m.left]}  ·  M:${l[m.middle]}  ·  R:${l[m.right]}  ·  ⇅:${l[m.scroll]}`;
};
const TOOLS=[
  {id:"window",icon:"◧",label:"W/L"},{id:"zoom",icon:"⊕",label:"Zoom"},
  {id:"pan",icon:"✥",label:"Pan"},{id:"ruler",icon:"⌖",label:"Measure"},
  {id:"annotate",icon:"✎",label:"Annotate"},
];

// ── Score Ring ─────────────────────────────────────────────────────────────────
function ScoreRing({score,size=80}){
  const r=(size-10)/2,circ=2*Math.PI*r,dash=(score/100)*circ,c=scoreColor(score);
  return(
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{flexShrink:0}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#111d2a" strokeWidth={7}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={c} strokeWidth={7}
        strokeDasharray={`${dash} ${circ-dash}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{transition:"stroke-dasharray 1s ease"}}/>
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
        fill={c} fontSize={size*0.24} fontWeight="700" style={{fontFamily:FF}}>{score}</text>
    </svg>
  );
}

// ── Simulated CXR ──────────────────────────────────────────────────────────────
function ChestXray(){
  return(
    <svg viewBox="0 0 500 600" xmlns="http://www.w3.org/2000/svg"
      style={{width:"100%",height:"100%",display:"block"}}>
      <defs>
        <radialGradient id="body" cx="50%" cy="44%" r="50%"><stop offset="0%" stopColor="#1e1e1e"/><stop offset="70%" stopColor="#161616"/><stop offset="100%" stopColor="#060606"/></radialGradient>
        <radialGradient id="hrt"  cx="45%" cy="50%" r="55%"><stop offset="0%" stopColor="#333"/><stop offset="100%" stopColor="#252525"/></radialGradient>
        <radialGradient id="csl"  cx="50%" cy="50%" r="55%"><stop offset="0%" stopColor="#3a3a3a" stopOpacity="0.9"/><stop offset="100%" stopColor="#2a2a2a" stopOpacity="0"/></radialGradient>
        <radialGradient id="eff"  cx="50%" cy="30%" r="60%"><stop offset="0%" stopColor="#2e2e2e" stopOpacity="0.85"/><stop offset="100%" stopColor="#1a1a1a" stopOpacity="0"/></radialGradient>
      </defs>
      <rect width="500" height="600" fill="#030303"/>
      <ellipse cx="250" cy="300" rx="225" ry="275" fill="url(#body)"/>
      <ellipse cx="152" cy="270" rx="100" ry="170" fill="#090909"/>
      <ellipse cx="348" cy="260" rx="104" ry="164" fill="#0a0a0a"/>
      <ellipse cx="228" cy="345" rx="88"  ry="92"  fill="url(#hrt)"/>
      <ellipse cx="218" cy="210" rx="22"  ry="18"  fill="#282828"/>
      <rect x="239" y="55" width="22" height="148" rx="11" fill="#080808"/>
      <path d="M 250 203 Q 195 230 170 255" fill="none" stroke="#101010" strokeWidth="10" strokeLinecap="round"/>
      <path d="M 250 203 Q 305 230 330 255" fill="none" stroke="#101010" strokeWidth="10" strokeLinecap="round"/>
      <ellipse cx="188" cy="285" rx="22" ry="32" fill="#212121" opacity="0.6"/>
      <ellipse cx="312" cy="275" rx="20" ry="30" fill="#212121" opacity="0.5"/>
      <ellipse cx="370" cy="385" rx="75" ry="62" fill="url(#csl)"/>
      <ellipse cx="390" cy="435" rx="58" ry="38" fill="url(#eff)"/>
      <path d="M 38 428 Q 152 480 250 468 Q 348 456 462 422" fill="none" stroke="#303030" strokeWidth="2.5"/>
      <path d="M 38 452 Q 135 500 225 490 Q 310 480 375 468" fill="none" stroke="#242424" strokeWidth="1.5"/>
      {[135,165,195,225,255,285,315,345].map((y,i)=>(
        <path key={i} d={`M ${55+i*4} ${y} Q 250 ${y-18+i*2} ${445-i*4} ${y}`}
          fill="none" stroke="#1f1f1f" strokeWidth="1.2" opacity="0.8"/>
      ))}
      <path d="M 75 112 Q 158 96 235 108"  fill="none" stroke="#383838" strokeWidth="3"/>
      <path d="M 265 108 Q 342 96 425 112" fill="none" stroke="#383838" strokeWidth="3"/>
      <path d="M 68 130 Q 58 230 75 310"   fill="none" stroke="#1c1c1c" strokeWidth="5" opacity="0.5"/>
      <path d="M 432 130 Q 442 230 425 310" fill="none" stroke="#1c1c1c" strokeWidth="5" opacity="0.5"/>
      <ellipse cx="100" cy="445" rx="38" ry="22" fill="#1e1e1e" opacity="0.6"/>
    </svg>
  );
}

// ── Mouse Settings Modal ───────────────────────────────────────────────────────
function MouseModal({draft,setDraft,onConfirm,onCancel,isFirstRun}){
  const ROWS=[
    {key:"left",  icon:"◱",label:"Left Button", sub:"Click + drag",  opts:BTN_ACTIONS},
    {key:"middle",icon:"◈",label:"Middle Button",sub:"Click + drag",  opts:BTN_ACTIONS},
    {key:"right", icon:"◲",label:"Right Button", sub:"Click + drag",  opts:BTN_ACTIONS},
    {key:"scroll",icon:"⇅",label:"Scroll Wheel", sub:"Scroll up/down",opts:SCROLL_ACTIONS},
  ];
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(3,5,10,0.92)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:100,backdropFilter:"blur(6px)"}}>
      <div style={{width:510,background:"#090c14",border:`1px solid ${A_BD}`,
        borderRadius:12,overflow:"hidden",boxShadow:"0 40px 100px rgba(0,0,0,0.85)",fontFamily:FF}}>
        <div style={{padding:"26px 30px 22px",borderBottom:"1px solid #0c1920",
          display:"flex",alignItems:"flex-start",gap:16}}>
          <div style={{width:44,height:44,borderRadius:10,background:A_BG,
            border:`1px solid ${A_BD}`,display:"flex",alignItems:"center",
            justifyContent:"center",flexShrink:0,fontSize:22,color:A}}>⌘</div>
          <div>
            <div style={{fontSize:18,fontWeight:700,color:T1,marginBottom:6}}>
              {isFirstRun?"Configure Your Workspace":"Mouse & Interaction Settings"}
            </div>
            <div style={{fontSize:14,color:T3,lineHeight:1.6}}>
              {isFirstRun
                ?"Assign an action to each mouse button. Changeable anytime via the toolbar ⚙."
                :"Reassign actions to each mouse button. Changes apply immediately."}
            </div>
          </div>
        </div>
        <div>
          {ROWS.map(row=>(
            <div key={row.key} style={{padding:"15px 30px",borderBottom:"1px solid #080e1a",
              display:"flex",alignItems:"center",gap:16}}>
              <div style={{width:168,flexShrink:0,display:"flex",alignItems:"center",gap:11}}>
                <span style={{fontSize:18,color:T4,width:22,textAlign:"center"}}>{row.icon}</span>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:T2}}>{row.label}</div>
                  <div style={{fontSize:12,color:T5,marginTop:2,fontFamily:MONO}}>{row.sub}</div>
                </div>
              </div>
              <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                {row.opts.map(opt=>{
                  const on=draft[row.key]===opt.value;
                  return(
                    <button key={opt.value} onClick={()=>setDraft(d=>({...d,[row.key]:opt.value}))}
                      style={{padding:"7px 14px",borderRadius:6,border:"none",cursor:"pointer",
                        fontFamily:FF,fontSize:13,fontWeight:500,transition:"all .15s",
                        background:on?A_BG:"#07090f",color:on?A_LT:T4,
                        outline:on?`1px solid ${A_BD}`:"1px solid #0c1820"}}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div style={{padding:"20px 30px",borderTop:"1px solid #0a1520",
          display:"flex",justifyContent:isFirstRun?"flex-end":"space-between",gap:10}}>
          {!isFirstRun&&(
            <button onClick={onCancel}
              style={{padding:"11px 24px",borderRadius:7,border:"1px solid #0d1e2c",
                background:"transparent",color:T4,fontFamily:FF,fontSize:14,cursor:"pointer"}}>Cancel</button>
          )}
          <button onClick={onConfirm}
            style={{padding:"11px 32px",borderRadius:7,border:"none",background:A,
              color:"#041210",fontFamily:FF,fontSize:14,fontWeight:700,cursor:"pointer"}}>
            {isFirstRun?"Start Training →":"Apply Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── MicButton ─────────────────────────────────────────────────────────────────
function MicButton({ active, onClick, fixable, onFix, fixing }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
      <button
        onClick={onClick}
        title={active?"Stop dictating (Alt+D)":"Start dictating into this field (Alt+D)"}
        style={{
          width:26,height:26,borderRadius:"50%",border:"none",cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"center",
          transition:"all .2s",flexShrink:0,
          background: active?"rgba(248,113,113,0.18)":"rgba(255,255,255,0.04)",
          outline: active?"1.5px solid #f87171":"1px solid #1a2e3a",
          animation: active?"micPulse 1.4s ease-in-out infinite":"none",
        }}>
        <svg width="13" height="13" viewBox="0 0 13 14" fill="none">
          <rect x="4" y="0.5" width="5" height="7" rx="2.5"
            fill={active?"#f87171":T4}/>
          <path d="M1.5 6.5c0 2.76 2.24 5 5 5s5-2.24 5-5"
            stroke={active?"#f87171":T4} strokeWidth="1.4"
            strokeLinecap="round" fill="none"/>
          <line x1="6.5" y1="11.5" x2="6.5" y2="12.8"
            stroke={active?"#f87171":T4} strokeWidth="1.4" strokeLinecap="round"/>
          <line x1="4.5" y1="12.8" x2="8.5" y2="12.8"
            stroke={active?"#f87171":T4} strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
      {fixable&&!active&&(
        <button onClick={onFix} disabled={fixing}
          title="Fix medical terminology with AI"
          style={{
            padding:"2px 8px",borderRadius:3,border:"1px solid #0e3632",
            background:fixing?"#07100e":"rgba(93,168,160,0.08)",
            color:fixing?T5:A,cursor:fixing?"wait":"pointer",
            fontFamily:FF,fontSize:10,fontWeight:600,
            letterSpacing:"0.04em",transition:"all .15s",whiteSpace:"nowrap",
          }}>
          {fixing?"Fixing…":"Fix Terms"}
        </button>
      )}
    </div>
  );
}

// ── Mode Toggle ────────────────────────────────────────────────────────────────
function ModeToggle({mode, onChange, difficulty, converting, convertedFrom}){
  const OPTS = [
    {val:"structured", label:"Guided",         desc:"Region by region"},
    {val:"free",       label:"Free Dictation",  desc:"Open report"    },
  ];
  return(
    <div style={{marginBottom:16}}>
      <div style={{display:"flex",background:"#050810",borderRadius:7,
        border:"1px solid #0e1c2c",padding:3,gap:3}}>
        {OPTS.map(opt=>{
          const on      = mode===opt.val;
          const loading = converting && opt.val==="structured"; // spinner on Guided when parsing
          return(
            <button key={opt.val} onClick={()=>onChange(opt.val)}
              disabled={converting}
              style={{flex:1,padding:"8px 6px",borderRadius:5,border:"none",
                cursor:converting?"wait":"pointer",fontFamily:FF,transition:"all .18s",
                background:on?"#0c1e2e":"transparent",
                boxShadow:on?`0 0 0 1px ${A_BD}`:"none",
                opacity:converting&&!on?0.5:1}}>
              {loading
                ? <div style={{display:"flex",alignItems:"center",justifyContent:"center",
                    gap:6,height:34}}>
                    <div style={{width:12,height:12,borderRadius:"50%",
                      border:"1.5px solid #0d1c28",borderTop:`1.5px solid ${A}`,
                      animation:"spin 0.65s linear infinite"}}/>
                    <span style={{fontSize:12,fontWeight:600,color:A}}>Parsing…</span>
                  </div>
                : <>
                    <div style={{fontSize:13,fontWeight:700,color:on?A:T4,marginBottom:1}}>
                      {opt.label}
                    </div>
                    <div style={{fontSize:10,color:on?T4:T5}}>{opt.desc}</div>
                  </>
              }
            </button>
          );
        })}
      </div>

      {/* Conversion success hint */}
      {convertedFrom && (
        <div style={{fontSize:11,color:A,marginTop:7,paddingLeft:2,
          display:"flex",alignItems:"center",gap:5,
          animation:"fadeSlide 0.3s ease both"}}>
          <span style={{fontSize:12}}>✓</span>
          {convertedFrom==="guided"
            ? "Converted from Guided fields — edit freely"
            : "Fields populated from your dictation — review each section"}
        </div>
      )}

      {/* Default mode hint (shown when no conversion message) */}
      {!convertedFrom && (
        <div style={{fontSize:11,color:T5,marginTop:7,paddingLeft:2}}>
          Default for <span style={{color:T3,fontWeight:600}}>{difficulty}</span>
          {" · "}
          <span style={{color:T5}}>
            {mode==="structured"
              ? "Switch to Free Dictation to see compiled report"
              : "Switch to Guided to parse into sections"}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Verbosity Toggle ───────────────────────────────────────────────────────────
function VerbosityToggle({verbosity,onChange}){
  return(
    <div style={{display:"flex",background:"#050810",borderRadius:5,
      border:"1px solid #0d1a24",padding:2,gap:2,flexShrink:0}}>
      {[{val:"succinct",label:"Succinct"},{val:"detailed",label:"Detailed"}].map(opt=>{
        const on=verbosity===opt.val;
        return(
          <button key={opt.val} onClick={()=>onChange(opt.val)}
            style={{padding:"4px 12px",borderRadius:4,border:"none",cursor:"pointer",
              fontFamily:FF,fontSize:11,fontWeight:700,transition:"all .15s",
              background:on?"#0c1e2e":"transparent",color:on?A_LT:T5,
              boxShadow:on?`0 0 0 1px ${A_BD}`:"none"}}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Structured Input ───────────────────────────────────────────────────────────
function StructuredInput({fields,onChange,impression,setImpression,
  dictatingField,onMicToggle,fixableFields,onFix,fixingField}){
  return(
    <div>
      {SF.map(f=>{
        const isActive = dictatingField===f.key;
        return(
        <div key={f.key} style={{marginBottom:13}}>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:7}}>
            <div style={{width:5,height:5,borderRadius:"50%",
              background:isActive?"#f87171":T4,flexShrink:0,
              animation:isActive?"micPulse 1.4s ease-in-out infinite":"none"}}/>
            <span style={{fontSize:12,fontWeight:700,letterSpacing:"0.07em",
              textTransform:"uppercase",color:isActive?"#f87171":T2,flex:1}}>
              {f.label}{isActive&&<span style={{fontSize:10,marginLeft:6,
                fontWeight:500,letterSpacing:0,textTransform:"none",
                color:"#f87171",opacity:0.85}}>● Listening…</span>}
            </span>
            <MicButton active={isActive}
              onClick={()=>onMicToggle(f.key)}
              fixable={fixableFields?.has(f.key)}
              onFix={()=>onFix(f.key)}
              fixing={fixingField===f.key}/>
            <button onClick={()=>onChange(f.key,UNREM[f.key])}
              style={{fontSize:11,padding:"2px 10px",borderRadius:3,border:"1px solid #0e1c2c",
                background:"transparent",color:T4,cursor:"pointer",fontFamily:FF,
                fontWeight:500,flexShrink:0,transition:"all .15s"}}
              onMouseOver={e=>{e.currentTarget.style.color=A;e.currentTarget.style.borderColor=A_BD;}}
              onMouseOut={e=>{e.currentTarget.style.color=T4;e.currentTarget.style.borderColor="#0e1c2c";}}>
              Unremarkable
            </button>
          </div>
          <textarea value={fields[f.key]} onChange={e=>onChange(f.key,e.target.value)}
            placeholder={f.ph} rows={2}
            style={{width:"100%",background:"#050810",
              border:`1px solid ${isActive?"rgba(248,113,113,0.4)":"#0e1c2c"}`,
              borderRadius:5,color:"#8ab8c8",fontSize:13,lineHeight:1.65,
              padding:"9px 12px",transition:"border-color .2s",
              boxSizing:"border-box",minHeight:58,fontFamily:FF}}/>
        </div>
      );})}
      <div style={{height:1,background:"#0b1820",margin:"14px 0"}}/>
      <div style={{marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:7}}>
          <div style={{width:5,height:5,borderRadius:"50%",
            background:dictatingField==="impression"?"#f87171":A,flexShrink:0,
            animation:dictatingField==="impression"?"micPulse 1.4s ease-in-out infinite":"none"}}/>
          <span style={{fontSize:12,fontWeight:700,letterSpacing:"0.07em",
            textTransform:"uppercase",color:dictatingField==="impression"?"#f87171":A}}>
            Impression
            {dictatingField==="impression"&&<span style={{fontSize:10,marginLeft:6,
              fontWeight:500,letterSpacing:0,textTransform:"none",opacity:0.85}}>
              ● Listening…</span>}
          </span>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:7}}>
            <MicButton active={dictatingField==="impression"}
              onClick={()=>onMicToggle("impression")}
              fixable={fixableFields?.has("impression")}
              onFix={()=>onFix("impression")}
              fixing={fixingField==="impression"}/>
            <span style={{fontSize:13,fontWeight:500,color:T4}}>Required</span>
          </div>
        </div>
        <textarea value={impression} onChange={e=>setImpression(e.target.value)}
          placeholder="Summarise your clinical impression, leading with the most significant finding…"
          rows={3}
          style={{width:"100%",background:"#050810",
            border:`1px solid ${dictatingField==="impression"?"rgba(248,113,113,0.4)":"#0e1c2c"}`,
            borderRadius:5,color:"#8ab8c8",fontSize:13,lineHeight:1.65,
            padding:"9px 12px",transition:"border-color .2s",
            boxSizing:"border-box",minHeight:72,fontFamily:FF}}/>
      </div>
    </div>
  );
}

// ── Free Text Input ────────────────────────────────────────────────────────────
function FreeInput({findings,setFindings,impression,setImpression,
  dictatingField,onMicToggle,fixableFields,onFix,fixingField}){
  const FIELDS = [
    {id:"findings",  label:"Findings",  val:findings,  set:setFindings,  rows:7,
      ph:"Lungs: ...\nPleural Spaces: ...\nCardiomediastinal: ...\nHila: ...\nBones & Soft Tissues: ...\nSubdiaphragmatic: ...\nDevices & Lines: ..."},
    {id:"impression",label:"Impression",val:impression,set:setImpression,rows:4,
      ph:"Summarise your clinical impression, leading with the most significant finding…"},
  ];
  return(
    <div>
      {FIELDS.map((s,i)=>{
        const isActive = dictatingField===s.id;
        return(
        <div key={i}>
          {i>0&&<div style={{height:1,background:"#0b1820",margin:"14px 0"}}/>}
          <div style={{paddingBottom:i===1?20:0}}>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8}}>
              <div style={{width:5,height:5,borderRadius:"50%",
                background:isActive?"#f87171":A,flexShrink:0,
                animation:isActive?"micPulse 1.4s ease-in-out infinite":"none"}}/>
              <span style={{fontSize:12,fontWeight:700,letterSpacing:"0.07em",
                textTransform:"uppercase",color:isActive?"#f87171":A}}>
                {s.label}
                {isActive&&<span style={{fontSize:10,marginLeft:6,fontWeight:500,
                  letterSpacing:0,textTransform:"none",opacity:0.85}}>
                  ● Listening…</span>}
              </span>
              <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:7}}>
                <MicButton active={isActive}
                  onClick={()=>onMicToggle(s.id)}
                  fixable={fixableFields?.has(s.id)}
                  onFix={()=>onFix(s.id)}
                  fixing={fixingField===s.id}/>
                <span style={{fontSize:13,fontWeight:500,color:T4}}>Required</span>
              </div>
            </div>
            <textarea value={s.val} onChange={e=>s.set(e.target.value)}
              placeholder={s.ph} rows={s.rows}
              style={{width:"100%",background:"#050810",
                border:`1px solid ${isActive?"rgba(248,113,113,0.4)":"#0e1c2c"}`,
                borderRadius:5,color:"#8ab8c8",fontSize:13,lineHeight:1.75,
                padding:"10px 13px",transition:"border-color .2s",
                boxSizing:"border-box",fontFamily:FF}}/>
          </div>
        </div>
      );})}
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────────

// ── Section content extractor for queue items ─────────────────────────────────
// ── Sentiment lookup for report viewer colouring ─────────────────────────────
// Maps each SF field label to the most relevant rubric section, then returns
// that section's sentiment from the live feedback object.
const FIELD_TO_RUBRIC = {
  "Lungs":               "Primary Finding Accuracy",
  "Pleural Spaces":      "Critical Finding Identification",
  "Cardiomediastinal":   "Systematic Completeness",
  "Hila":                "Systematic Completeness",
  "Bones & Soft Tissues":"Systematic Completeness",
  "Subdiaphragmatic":    "Systematic Completeness",
  "Devices & Lines":     "Systematic Completeness",
  "Impression":          "Impression Quality",
};
const SENTIMENT_COLORS = { correct:"#4ade80", incorrect:"#f87171", uncertain:"#fbbf24" };

function sentimentFor(fieldLabel, feedback) {
  if(!feedback) return null;
  const rubric = FIELD_TO_RUBRIC[fieldLabel];
  if(!rubric) return null;
  const section = feedback.sections.find(s=>s.label===rubric);
  return section?.sentiment || null;
}

// ── Phrase-level annotation renderer ──────────────────────────────────────────
// Builds a flat phrase→sentiment lookup from all sections' annotation arrays.
function buildAnnotationMap(feedback) {
  if(!feedback?.sections) return {};
  const map = {};
  feedback.sections.forEach(s=>{
    (s.annotations||[]).forEach(a=>{
      if(a.text?.trim()) map[a.text.trim()] = a.sentiment;
    });
  });
  return map;
}

// Splits text into annotated segments and returns an array of {text, sentiment} objects.
// Phrases are matched case-insensitively; longest phrases matched first to avoid
// partial-match conflicts.
function segmentText(text, annotationMap) {
  if(!text || Object.keys(annotationMap).length===0) return [{text, sentiment:null}];
  const phrases = Object.keys(annotationMap).sort((a,b)=>b.length-a.length);
  let parts = [{text, sentiment:null}];
  for(const phrase of phrases){
    const next = [];
    for(const part of parts){
      if(part.sentiment!==null){ next.push(part); continue; }
      const lower   = part.text.toLowerCase();
      const phraseL = phrase.toLowerCase();
      let idx = lower.indexOf(phraseL);
      if(idx===-1){ next.push(part); continue; }
      // Split around all occurrences
      let remaining = part.text;
      let offset    = 0;
      while(true){
        const i = remaining.toLowerCase().indexOf(phraseL);
        if(i===-1){ if(remaining) next.push({text:remaining,sentiment:null}); break; }
        if(i>0) next.push({text:remaining.slice(0,i),sentiment:null});
        next.push({text:remaining.slice(i,i+phrase.length),sentiment:annotationMap[phrase]});
        remaining = remaining.slice(i+phrase.length);
      }
    }
    parts = next;
  }
  return parts;
}

// Renders a text string with inline phrase highlights.
// Falls back to a plain coloured span if no annotations match.
function AnnotatedText({text, annotationMap, fallbackColor}){
  const SC={correct:"#4ade80",incorrect:"#f87171",uncertain:"#fbbf24"};
  const segs = segmentText(text, annotationMap);
  const hasAnnotation = segs.some(s=>s.sentiment!==null);
  if(!hasAnnotation){
    return <span style={{color:fallbackColor||"inherit"}}>{text}</span>;
  }
  return(
    <>
      {segs.map((seg,i)=>{
        if(!seg.sentiment) return <span key={i} style={{color:fallbackColor||"inherit"}}>{seg.text}</span>;
        const c=SC[seg.sentiment]||fallbackColor||"inherit";
        return(
          <span key={i} style={{
            color:c,
            background:`rgba(${seg.sentiment==="correct"?"74,222,128":seg.sentiment==="incorrect"?"248,113,113":"251,191,36"},0.15)`,
            borderRadius:3,
            padding:"0 2px",
            fontWeight:600,
          }}>{seg.text}</span>
        );
      })}
    </>
  );
}

function getTraineeSectionContent(label, mode, sfFields, findings, impression) {
  if (mode === "free") {
    return label === "Impression Quality"
      ? (impression || "[No impression]")
      : (findings   || "[No findings]");
  }
  const map = {
    "Systematic Completeness":         Object.entries(sfFields).map(([k,v])=>`${k}: ${v||"[empty]"}`).join("\n"),
    "Primary Finding Accuracy":        `Lungs: ${sfFields.lungs||"[empty]"}\nPleural: ${sfFields.pleural||"[empty]"}`,
    "Critical Finding Identification": `Lungs: ${sfFields.lungs||"[empty]"}\nPleural: ${sfFields.pleural||"[empty]"}`,
    "Impression Quality":              impression || "[No impression]",
    "Radiological Terminology":        Object.values(sfFields).filter(Boolean).join(" · ") + (impression ? " · " + impression : ""),
  };
  return map[label] || Object.values(sfFields).filter(Boolean).join(" · ") || "[No content]";
}

// ── Reviewer Queue ─────────────────────────────────────────────────────────────
function ReviewQueue({ queue, rubricMeta, onClose, onResolve, onVersionBump }) {
  const [tab,      setTab]      = useState("pending");
  const [bumpItem, setBumpItem] = useState(null);
  const [bumpNote, setBumpNote] = useState("");

  const pending  = queue.filter(i => i.status === "pending");
  const resolved = queue.filter(i => i.status !== "pending");
  const items    = tab === "pending" ? pending : resolved;

  const TIER_LABEL = { 2:"Possible · Unverifiable", 3:"Possible · Correct Addition" };
  const TIER_COLOR = { 2:"#c49a3a", 3:A };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ rubricMeta, queue }, null, 2)],
      { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `crucible-review-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const confirmBump = () => {
    if (!bumpItem || !bumpNote.trim()) return;
    onVersionBump(bumpItem.id, bumpNote.trim());
    onResolve(bumpItem.id, "legitimate_finding");
    setBumpItem(null); setBumpNote("");
  };

  const ResolutionBadge = ({ status }) => {
    const cfg = {
      confirmed_overcall:  { label:"Overcall confirmed",    bg:"rgba(180,60,60,0.15)",   color:"#c07070", border:"rgba(180,60,60,0.3)"  },
      legitimate_finding:  { label:"Legitimate finding",    bg:"rgba(93,168,160,0.12)",  color:A_LT,      border:A_BD                   },
      borderline:          { label:"Borderline — no change",bg:"rgba(80,80,80,0.15)",    color:"#7a8898", border:"#2a3848"               },
    }[status];
    if (!cfg) return null;
    return (
      <span style={{ fontSize:11, padding:"2px 9px", borderRadius:3,
        background:cfg.bg, color:cfg.color, border:`1px solid ${cfg.border}`,
        fontWeight:600, letterSpacing:"0.04em" }}>
        {cfg.label}
      </span>
    );
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(3,5,10,0.95)",
      zIndex:200, display:"flex", flexDirection:"column", fontFamily:FF,
      backdropFilter:"blur(6px)" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:16, padding:"0 28px",
        height:58, background:"#070a11", borderBottom:"1px solid #0e1828",
        flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:9, fontWeight:800,
          fontSize:17, color:T1 }}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <polygon points="9,1 17,5 17,13 9,17 1,13 1,5" fill="none" stroke={A} strokeWidth="1.5"/>
            <polygon points="9,5 13,7 13,11 9,13 5,11 5,7" fill={A} opacity="0.2"/>
          </svg>
          Crucible
          <span style={{ color:T4, fontWeight:500, fontSize:14, marginLeft:4 }}>· Review Queue</span>
        </div>

        {/* Stats */}
        <div style={{ display:"flex", gap:20, marginLeft:20 }}>
          {[
            { label:"Pending",  val:pending.length,  color:"#c49a3a" },
            { label:"Resolved", val:resolved.length, color:A          },
            { label:"Total",    val:queue.length,     color:T4         },
          ].map(s=>(
            <div key={s.label} style={{ textAlign:"center" }}>
              <div style={{ fontSize:18, fontWeight:700, color:s.color,
                fontFamily:MONO }}>{s.val}</div>
              <div style={{ fontSize:11, color:T5 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:10 }}>
          {/* Rubric version badge */}
          <div style={{ padding:"4px 12px", borderRadius:4, background:A_BG,
            border:`1px solid ${A_BD}`, fontSize:12, fontWeight:600 }}>
            <span style={{ color:T4 }}>Rubric </span>
            <span style={{ color:A }}>v{rubricMeta.version}</span>
          </div>
          <button onClick={handleExport}
            style={{ padding:"7px 16px", borderRadius:5, border:"1px solid #0d1e2c",
              background:"transparent", color:T3, fontFamily:FF, fontSize:13,
              cursor:"pointer", fontWeight:500 }}>
            ↓ Export JSON
          </button>
          <button onClick={onClose}
            style={{ padding:"7px 16px", borderRadius:5, border:"none",
              background:"#0c1e2e", color:T2, fontFamily:FF, fontSize:13,
              cursor:"pointer", fontWeight:600 }}>
            ✕ Close
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:0, padding:"0 28px",
        background:"#06080d", borderBottom:"1px solid #0b1620", flexShrink:0 }}>
        {[
          { val:"pending",  label:"Pending Review", count:pending.length  },
          { val:"resolved", label:"Resolved",       count:resolved.length },
          { val:"history",  label:"Rubric History", count:rubricMeta.history.length },
        ].map(t=>{
          const on=tab===t.val;
          return(
            <button key={t.val} onClick={()=>setTab(t.val)}
              style={{ padding:"13px 20px", borderRadius:0, border:"none",
                borderBottom:on?`2px solid ${A}`:"2px solid transparent",
                background:"transparent", color:on?A:T5,
                fontFamily:FF, fontSize:13, fontWeight:on?700:500,
                cursor:"pointer", display:"flex", alignItems:"center", gap:7,
                marginBottom:-1 }}>
              {t.label}
              <span style={{ fontSize:11, padding:"1px 6px", borderRadius:10,
                background:on?A_BG:"#0a1018", color:on?A:T5,
                border:on?`1px solid ${A_BD}`:"1px solid #0e1820" }}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:"auto", padding:"24px 28px" }}>

        {/* ── Rubric History tab ── */}
        {tab === "history" && (
          <div style={{ maxWidth:680 }}>
            <div style={{ fontSize:15, fontWeight:700, color:T1, marginBottom:18 }}>
              Rubric Version History — {CASE.description}
            </div>
            {[...rubricMeta.history].reverse().map((h, i) => (
              <div key={i} style={{ display:"flex", gap:16, marginBottom:20 }}>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                  flexShrink:0 }}>
                  <div style={{ width:36, height:36, borderRadius:8, background:A_BG,
                    border:`1px solid ${A_BD}`, display:"flex", alignItems:"center",
                    justifyContent:"center", fontSize:11, fontWeight:700,
                    color:A, fontFamily:MONO }}>
                    {h.version}
                  </div>
                  {i < rubricMeta.history.length - 1 && (
                    <div style={{ width:1, flex:1, minHeight:20,
                      background:"#0e1c2c", marginTop:4 }}/>
                  )}
                </div>
                <div style={{ flex:1, paddingBottom:i < rubricMeta.history.length-1 ? 20 : 0 }}>
                  <div style={{ display:"flex", gap:10, alignItems:"baseline", marginBottom:6 }}>
                    <span style={{ fontSize:14, fontWeight:700, color:T1 }}>v{h.version}</span>
                    <span style={{ fontSize:12, color:T5, fontFamily:MONO }}>{h.date}</span>
                    <span style={{ fontSize:12, color:T4 }}>{h.author}</span>
                  </div>
                  <div style={{ fontSize:13, color:T3, lineHeight:1.65,
                    padding:"9px 13px", background:"#070a10", borderRadius:5,
                    border:"1px solid #0b1820" }}>
                    {h.note}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Queue items ── */}
        {tab !== "history" && items.length === 0 && (
          <div style={{ textAlign:"center", marginTop:60, color:T5 }}>
            <div style={{ fontSize:32, marginBottom:12 }}>✓</div>
            <div style={{ fontSize:15, fontWeight:600, color:T4 }}>
              {tab === "pending" ? "No pending items" : "No resolved items yet"}
            </div>
            <div style={{ fontSize:13, color:T5, marginTop:6 }}>
              {tab === "pending"
                ? "Flagged findings from trainee submissions will appear here."
                : "Resolved items will appear here after review."}
            </div>
          </div>
        )}

        {tab !== "history" && items.map((item, i) => {
          const isBumping = bumpItem?.id === item.id;
          const tierColor = TIER_COLOR[item.tier] || "#c49a3a";
          return (
            <div key={item.id} style={{ marginBottom:16, borderRadius:8,
              background:"#08090e", border:`1px solid ${item.status==="pending"?"#0d1825":"#090e18"}`,
              overflow:"hidden", borderLeft:`3px solid ${tierColor}` }}>

              {/* Item header */}
              <div style={{ padding:"13px 18px", display:"flex",
                alignItems:"center", gap:12, borderBottom:"1px solid #0a0f18" }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:T1 }}>
                      {item.sectionLabel}
                    </span>
                    <span style={{ fontSize:10, padding:"2px 8px", borderRadius:3,
                      background:"rgba(180,120,20,0.12)", color:tierColor,
                      border:`1px solid rgba(180,120,20,0.25)`,
                      fontWeight:600, letterSpacing:"0.04em" }}>
                      Tier {item.tier} · {TIER_LABEL[item.tier]}
                    </span>
                    {item.status !== "pending" && <ResolutionBadge status={item.status}/>}
                  </div>
                  <div style={{ fontSize:11, color:T5, fontFamily:MONO }}>
                    {item.caseId} · {item.caseDescription} · Rubric v{item.rubricVersion} · {new Date(item.timestamp).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Review note */}
              <div style={{ padding:"12px 18px 0" }}>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.07em",
                  textTransform:"uppercase", color:T5, marginBottom:6 }}>
                  Claude's Flag Note
                </div>
                <div style={{ fontSize:13, color:"#c49a3a", lineHeight:1.65,
                  padding:"8px 12px", borderRadius:4, marginBottom:12,
                  background:"rgba(180,120,20,0.08)", border:"1px solid rgba(180,120,20,0.2)" }}>
                  {item.reviewNote}
                </div>

                <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.07em",
                  textTransform:"uppercase", color:T5, marginBottom:6 }}>
                  Trainee's Text
                </div>
                <div style={{ fontSize:13, color:T3, lineHeight:1.65,
                  padding:"8px 12px", borderRadius:4, marginBottom:12,
                  background:"#050810", border:"1px solid #0b1820",
                  fontStyle:"italic", whiteSpace:"pre-wrap" }}>
                  {item.traineeContent || "[No text captured]"}
                </div>

                {item.reviewerNote && (
                  <div style={{ fontSize:13, color:T3, lineHeight:1.65,
                    padding:"8px 12px", borderRadius:4, marginBottom:12,
                    background:"#070a10", border:"1px solid #0b1820" }}>
                    <span style={{ fontWeight:700, color:T4 }}>Reviewer note: </span>
                    {item.reviewerNote}
                  </div>
                )}
                {item.rubricUpdateNote && (
                  <div style={{ fontSize:12, color:A, lineHeight:1.6,
                    padding:"6px 12px", borderRadius:4, marginBottom:12,
                    background:A_BG, border:`1px solid ${A_BD}` }}>
                    ✓ Rubric updated — {item.rubricUpdateNote}
                  </div>
                )}
              </div>

              {/* Actions */}
              {item.status === "pending" && (
                <div style={{ padding:"0 18px 14px" }}>
                  {!isBumping ? (
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      {[
                        { val:"confirmed_overcall", label:"Confirmed Overcall",
                          bg:"rgba(180,60,60,0.12)", color:"#c07070", border:"rgba(180,60,60,0.3)" },
                        { val:"legitimate_finding", label:"Legitimate Finding",
                          bg:A_BG, color:A_LT, border:A_BD },
                        { val:"borderline",         label:"Borderline — No Change",
                          bg:"rgba(60,70,80,0.2)",  color:"#7a8898", border:"#2a3848" },
                      ].map(action=>(
                        <button key={action.val}
                          onClick={()=>{
                            if(action.val === "legitimate_finding"){
                              setBumpItem(item); setBumpNote("");
                            } else {
                              onResolve(item.id, action.val);
                            }
                          }}
                          style={{ padding:"7px 15px", borderRadius:5,
                            border:`1px solid ${action.border}`, background:action.bg,
                            color:action.color, fontFamily:FF, fontSize:12,
                            fontWeight:600, cursor:"pointer" }}>
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ background:"#07101c", borderRadius:6,
                      border:`1px solid ${A_BD}`, padding:"14px 16px" }}>
                      <div style={{ fontSize:13, fontWeight:600, color:T2, marginBottom:10 }}>
                        Add a changelog note — rubric v{rubricMeta.version} → v{
                          (parseFloat(rubricMeta.version) + 0.1).toFixed(1)}
                      </div>
                      <textarea value={bumpNote} onChange={e=>setBumpNote(e.target.value)}
                        placeholder="e.g. Subtle left costophrenic blunting now noted as a reportable secondary finding in this case."
                        rows={2}
                        style={{ width:"100%", background:"#050810",
                          border:"1px solid #0e1c2c", borderRadius:4, color:"#8ab8c8",
                          fontSize:13, lineHeight:1.65, padding:"8px 12px",
                          fontFamily:FF, boxSizing:"border-box", outline:"none" }}/>
                      <div style={{ display:"flex", gap:8, marginTop:10 }}>
                        <button onClick={confirmBump} disabled={!bumpNote.trim()}
                          style={{ padding:"8px 18px", borderRadius:5, border:"none",
                            background:bumpNote.trim()?"#0d7068":"#090f1c",
                            color:bumpNote.trim()?"#c8ecea":"#1e3040",
                            fontFamily:FF, fontSize:13, fontWeight:700,
                            cursor:bumpNote.trim()?"pointer":"not-allowed" }}>
                          Confirm &amp; Update Rubric
                        </button>
                        <button onClick={()=>{ setBumpItem(null); setBumpNote(""); }}
                          style={{ padding:"8px 14px", borderRadius:5,
                            border:"1px solid #0d1e2c", background:"transparent",
                            color:T4, fontFamily:FF, fontSize:13, cursor:"pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Crucible(){
  const [tool,         setTool]        = useState("window");
  const [series,       setSeries]      = useState(0);
  const [findings,     setFindings]    = useState("");
  const [impression,   setImpression]  = useState("");
  const [sfFields,     setSfFields]    = useState(BLANK_SF);
  const [inputMode,    setInputMode]   = useState(defaultMode(CASE.difficulty));
  const [converting,   setConverting]   = useState(false);   // free→guided parsing in progress
  const [convertedFrom,setConvertedFrom]= useState(null);    // "guided"|"free"|null — brief success hint
  const [phase,        setPhase]       = useState("dictate");
  const [elapsed,      setElapsed]     = useState(0);
  const [showSetup,    setShowSetup]   = useState(true);
  const [showSettings, setShowSettings]= useState(false);
  const [mouse,        setMouse]       = useState(DEFAULT_MOUSE);
  const [draft,        setDraft]       = useState(DEFAULT_MOUSE);
  const [feedback,     setFeedback]    = useState(null);
  const [verbosity,    setVerbosity]   = useState("succinct");
  const [apiError,     setApiError]    = useState(null);

  // ── Dictation state ─────────────────────────────────────────────────────────
  // Deepgram Nova-2 — WebSocket streaming for near-instant transcription.
  // Flow:
  //   1. startDictation() reads VITE_DEEPGRAM_API_KEY (baked in at Vite build time)
  //   2. Opens a WebSocket to wss://api.deepgram.com/v1/listen
  //   3. getUserMedia audio streams into the WebSocket as raw PCM
  //   4. Deepgram sends back interim (live) + final transcripts
  //   5. Interim words appear immediately; final words are locked in
  //   6. stopDictation() closes the socket and releases the mic

  const [dictatingField, setDictatingField] = useState(null);
  const [fixableFields,  setFixableFields]  = useState(new Set());
  const [fixingField,    setFixingField]    = useState(null);
  const [availableMics,  setAvailableMics]  = useState([]);
  const [selectedMicId,  setSelectedMicId]  = useState("");
  const [showMicSelector,setShowMicSelector]= useState(false);
  const [showReview,     setShowReview]     = useState(false);
  const [showReport,     setShowReport]     = useState(false);
  const [reviewQueue,    setReviewQueue]    = useState([]);
  const [rubricMeta,     setRubricMeta]     = useState(INITIAL_RUBRIC_META);
  const [interimText,    setInterimText]    = useState("");  // live words not yet final

  const wsRef          = useRef(null);   // Deepgram WebSocket
  const mediaStreamRef = useRef(null);   // getUserMedia stream
  const processorRef   = useRef(null);   // AudioWorkletNode / ScriptProcessorNode
  const audioCtxRef    = useRef(null);   // AudioContext
  const dictFieldRef   = useRef(null);   // active field id (stable across closures)
  const finalTextRef   = useRef("");     // all finalised text this session
  const baseTextRef    = useRef("");     // text in field before session started
  const lastFocusRef   = useRef(null);

  // ── Stable value/setter helpers ───────────────────────────────────────────
  const getFieldValue = (id) => {
    if(id==="findings")   return findings;
    if(id==="impression") return impression;
    return sfFields[id]||"";
  };

  const setFieldValue = (id, val) => {
    if(id==="findings")   { setFindings(val);   return; }
    if(id==="impression") { setImpression(val); return; }
    setSfFields(prev=>({...prev,[id]:val}));
  };

  // ── Core dictation functions ──────────────────────────────────────────────
  const stopDictation = () => {
    // Close WebSocket cleanly
    if(wsRef.current){
      try{ wsRef.current.close(); }catch(e){}
      wsRef.current = null;
    }
    // Disconnect audio graph
    if(processorRef.current){
      try{ processorRef.current.disconnect(); }catch(e){}
      processorRef.current = null;
    }
    if(audioCtxRef.current){
      try{ audioCtxRef.current.close(); }catch(e){}
      audioCtxRef.current = null;
    }
    // Release microphone
    if(mediaStreamRef.current){
      mediaStreamRef.current.getTracks().forEach(t=>t.stop());
      mediaStreamRef.current = null;
    }
    // Mark field as fixable if something was dictated
    const fld = dictFieldRef.current;
    if(fld && finalTextRef.current.trim()){
      setFixableFields(prev=>new Set([...prev, fld]));
    }
    dictFieldRef.current = null;
    setDictatingField(null);
    setInterimText("");
  };

  const startDictation = async (fieldId) => {
    // Stop any existing session
    if(dictFieldRef.current) stopDictation();

    // ── Step 1: Get Deepgram API key (baked in at build time via Vite) ──────────
    // Key is set as VITE_DEEPGRAM_API_KEY in Netlify environment variables.
    // Vite replaces import.meta.env.VITE_DEEPGRAM_API_KEY at build time.
    const token = import.meta.env.VITE_DEEPGRAM_API_KEY;
    if(!token){
      setApiError("Deepgram API key not found. Add VITE_DEEPGRAM_API_KEY to Netlify environment variables and redeploy.");
      return;
    }

    // ── Step 2: Request microphone ────────────────────────────────────────────
    let stream;
    try {
      const constraints = {
        audio: selectedMicId
          ? { deviceId:{ exact:selectedMicId }, sampleRate:16000, channelCount:1 }
          : { sampleRate:16000, channelCount:1 }
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch(err) {
      if(err.name==="NotAllowedError"){
        setApiError("Microphone permission denied — please allow microphone access for this site in your browser settings.");
      } else if(err.name==="NotFoundError"){
        setApiError("No microphone found — please connect a microphone and try again.");
      } else {
        setApiError("Could not access microphone: " + err.message);
      }
      return;
    }

    mediaStreamRef.current = stream;

    // ── Step 3: Set up state for this session ─────────────────────────────────
    baseTextRef.current  = getFieldValue(fieldId);
    finalTextRef.current = "";
    dictFieldRef.current = fieldId;
    setDictatingField(fieldId);
    setInterimText("");

    // ── Step 4: Open Deepgram WebSocket ───────────────────────────────────────
    // Nova-2 Medical model — best accuracy for radiology terminology
    // Note: keyterms are NOT passed as URL params — 367 terms makes the URL
    // too long for Deepgram's WebSocket handshake (>8KB limit).
    // Instead, Haiku Fix Terms provides post-correction of medical vocabulary.
    const params = new URLSearchParams({
      model:           "nova-2",   // nova-2 available on all Deepgram tiers
      language:        "en-US",
      smart_format:    "true",     // auto punctuation + capitalisation
      interim_results: "true",     // live words as you speak
      utterance_end_ms:"800",      // finalise after 0.8s silence
      encoding:        "linear16",
      sample_rate:     "16000",
      channels:        "1",
    });
    // Auth: token in URL — most reliable method from browser environments.
    // The key is baked into the build via VITE_, not sent from a server.
    params.set("access_token", token);
    const ws = new WebSocket(
      `wss://api.deepgram.com/v1/listen?${params}`
    );
    wsRef.current = ws;

    ws.onopen = () => {
      // ── Step 5: Pipe mic audio into WebSocket as raw PCM (linear16) ─────────
      const audioCtx = new AudioContext({ sampleRate:16000 });
      audioCtxRef.current = audioCtx;
      const source  = audioCtx.createMediaStreamSource(stream);

      // ScriptProcessorNode — widely supported fallback
      // (AudioWorklet is better but requires a separate .js file)
      const bufferSize = 4096;
      const processor  = audioCtx.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if(!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        // Convert Float32 → Int16 PCM
        const int16 = new Int16Array(float32.length);
        for(let i=0; i<float32.length; i++){
          int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
        }
        wsRef.current.send(int16.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    };

    // ── Step 6: Handle incoming transcripts ───────────────────────────────────
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch{ return; }
      if(msg.type !== "Results") return;

      const alt      = msg.channel?.alternatives?.[0];
      const text     = alt?.transcript || "";
      const isFinal  = msg.is_final;

      if(!text) return;

      const isSpeechFinal = msg.speech_final;

      if(isFinal){
        // Lock this transcript in permanently
        const sep = finalTextRef.current &&
          !finalTextRef.current.endsWith(" ") &&
          !finalTextRef.current.endsWith("\n") ? " " : "";
        finalTextRef.current += sep + text;
        setInterimText("");
      } else {
        // Show live interim words (will be overwritten or finalised)
        setInterimText(text);
      }

      // Update the field: base + all finals + current interim
      if(dictFieldRef.current === fieldId){
        const base    = baseTextRef.current;
        const finals  = finalTextRef.current;
        const interim = isFinal ? "" : text;
        const sep     = (base && finals) && !base.endsWith(" ") &&
                        !base.endsWith("\n") ? " " : "";
        const interimSep = (base||finals) && interim &&
                           !(finals||base).endsWith(" ") ? " " : "";
        setFieldValue(
          fieldId,
          base +
          (finals ? sep + finals : "") +
          (interim ? interimSep + interim : "")
        );
      }
    };

    ws.onerror = (e) => {
      console.error("[Crucible] Deepgram WebSocket error:", e);
    };

    ws.onclose = (e) => {
      console.log("[Crucible] WebSocket closed — code:", e.code, "reason:", e.reason);
      if(!dictFieldRef.current) return; // clean stop, ignore
      if(e.code === 1000){
        // Normal close — no error
      } else if(e.code === 1008 || e.code === 4001 || e.code === 4002){
        setApiError("Deepgram authentication failed — check DEEPGRAM_API_KEY is set correctly in Netlify environment variables.");
        stopDictation();
      } else if(e.code === 1006){
        // Abnormal close — usually auth rejection on connect
        setApiError("Deepgram rejected the connection. Check: (1) DEEPGRAM_API_KEY is set in Netlify environment variables, (2) the Netlify function deployed successfully.");
        stopDictation();
      } else {
        setApiError("Dictation disconnected (code " + e.code + (e.reason ? ": " + e.reason : "") + "). Tap mic to retry.");
        stopDictation();
      }
    };
  };

  const toggleDictation = (fieldId) => {
    if(dictatingField === fieldId) stopDictation();
    else startDictation(fieldId);
  };

  // ── Fix Terms (Haiku post-correction pass) ────────────────────────────────
  const fixTerms = async (fieldId) => {
    const text = getFieldValue(fieldId);
    if(!text.trim()) return;
    setFixingField(fieldId);
    try{
      const resp = await fetch("/api/messages",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-haiku-4-5-20251001", max_tokens:700,
          messages:[{role:"user",content:
`You are a medical transcription editor. The following text was dictated by a radiologist via voice recognition.
Correct ONLY misheard medical, anatomical, or radiological terminology.
Do NOT change meaning, add findings, or alter correctly transcribed words.
Preserve all punctuation and line breaks.
Return ONLY the corrected text — no explanation, no preamble.

Text: ${text}`}],
        }),
      });
      if(resp.ok){
        const d = await resp.json();
        const fixed = d.content.map(b=>b.text||"").join("").trim();
        if(fixed) setFieldValue(fieldId, fixed);
      }
    }catch(e){ console.log("[Crucible] fixTerms error:", e); }
    setFixingField(null);
    setFixableFields(prev=>{ const n=new Set(prev); n.delete(fieldId); return n; });
  };

  // ── Load available microphones ────────────────────────────────────────────
  const loadMics = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics    = devices.filter(d=>d.kind==="audioinput");
      if(mics.every(m=>!m.label)){
        try {
          const s = await navigator.mediaDevices.getUserMedia({audio:true});
          s.getTracks().forEach(t=>t.stop());
          const refreshed = await navigator.mediaDevices.enumerateDevices();
          setAvailableMics(refreshed.filter(d=>d.kind==="audioinput"));
        } catch(e){ setAvailableMics(mics); }
      } else {
        setAvailableMics(mics);
      }
    } catch(e){ setAvailableMics([]); }
  };

  // ── Alt+D keyboard shortcut ───────────────────────────────────────────────
  useEffect(()=>{
    const handler = (e) => {
      if(e.altKey && e.key.toLowerCase()==="d"){
        e.preventDefault();
        const target = lastFocusRef.current ||
          (inputMode==="structured" ? SF[0].key : "findings");
        toggleDictation(target);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dictatingField, inputMode]);

  // Stop dictation when leaving dictate phase
  useEffect(()=>{
    if(phase !== "dictate") stopDictation();
  }, [phase]);

  const handleModeChange = async (newMode) => {
    if(newMode === inputMode || converting) return;

    // Clear any previous conversion hint
    setConvertedFrom(null);

    if(newMode === "free") {
      // Guided → Free: instant client-side compilation
      const compiled = structuredToFree(sfFields);
      if(compiled.trim() || impression.trim()) {
        setFindings(compiled);
        // impression carries over as-is
      }
      setInputMode("free");
      if(compiled.trim()) {
        setConvertedFrom("guided");
        setTimeout(()=>setConvertedFrom(null), 3000);
      }

    } else {
      // Free → Guided: AI-powered parse
      if(!findings.trim() && !impression.trim()) {
        // Nothing to convert — just switch
        setInputMode("structured");
        return;
      }
      setConverting(true);
      await parseToStructured(
        findings, impression,
        ({fields, impression: parsedImp})=>{
          setSfFields(fields);
          if(parsedImp) setImpression(parsedImp);
          setInputMode("structured");
          setConverting(false);
          setConvertedFrom("free");
          setTimeout(()=>setConvertedFrom(null), 3000);
        },
        (errMsg)=>{
          setConverting(false);
          setApiError("Conversion failed: "+errMsg);
        }
      );
    }
  };

  // ── Derived state ────────────────────────────────────────────────────────────
  const wordCount = inputMode==="structured"
    ? [...Object.values(sfFields).join(" ").split(/\s+/),
       ...impression.split(/\s+/)].filter(Boolean).length
    : [...findings.split(/\s+/),
       ...impression.split(/\s+/)].filter(Boolean).length;

  const canSubmit = inputMode==="structured"
    ? (Object.values(sfFields).some(v=>v.trim().length>3) || impression.trim().length>3)
    : (findings.trim().length>10 || impression.trim().length>10);

  // ── Submit handler ────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if(!canSubmit) return;
    setPhase("loading"); setApiError(null); setFlaggedItems(new Set()); setShowReport(false);
    setVerbosity("succinct");
    const prompt = buildPrompt(inputMode, sfFields, findings, impression);
    await evaluateReport(
      prompt,
      result => {
        setFeedback(result);
        setPhase("feedback");
        // Auto-populate review queue with flagged sections
        const flagged = (result.sections||[]).filter(s=>s.review_flag);
        if(flagged.length > 0){
          const newItems = flagged.map((s,i)=>({
            id: `${Date.now()}-${i}`,
            timestamp: new Date().toISOString(),
            caseId: CASE.id,
            caseDescription: CASE.description,
            rubricVersion: rubricMeta.version,
            sectionLabel: s.label,
            tier: s.review_tier || 2,
            reviewNote: s.review_note || "",
            traineeContent: getTraineeSectionContent(s.label, inputMode, sfFields, findings, impression),
            status: "pending",
            reviewerNote: "",
            rubricUpdateNote: null,
          }));
          setReviewQueue(prev=>[...newItems, ...prev]);
        }
      },
      msg => { setApiError(msg); setPhase("dictate"); }
    );
  };

  const handleReset=()=>{
    setPhase("dictate"); setFindings(""); setImpression("");
    setSfFields(BLANK_SF); setElapsed(0); setFeedback(null);
    setApiError(null); setFlaggedItems(new Set()); setShowReport(false); // Note: reviewQueue persists
  };

  // Review queue handlers
  const handleResolve=(id, resolution)=>{
    setReviewQueue(prev=>prev.map(item=>
      item.id===id ? {...item, status:resolution} : item
    ));
  };
  const handleVersionBump=(id, note)=>{
    setRubricMeta(prev=>{
      const next = (parseFloat(prev.version)+0.1).toFixed(1);
      return {
        version: next,
        history: [...prev.history, {
          version: next,
          date: new Date().toISOString().split("T")[0],
          author: "Dr. J. Reviewer",
          note,
        }]
      };
    });
    setReviewQueue(prev=>prev.map(item=>
      item.id===id ? {...item, rubricUpdateNote:note} : item
    ));
  };

  const applySetup=()=>{ setMouse(draft); setShowSetup(false); };
  const openSettings=()=>{ setDraft(mouse); setShowSettings(true); };
  const applySettings=()=>{ setMouse(draft); setShowSettings(false); };
  const cursorMap={window:"crosshair",zoom:"zoom-in",pan:"grab",none:"default"};


  return(
    <div style={{display:"flex",flexDirection:"column",height:"100vh",
      background:"#060810",color:T1,fontFamily:FF,fontSize:15,overflow:"hidden"}}>

      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        button{font-family:${FF}}
        textarea{outline:none;resize:vertical}
        textarea:focus{border-color:${A_BD}!important;box-shadow:0 0 0 2px rgba(93,168,160,0.08)}
        textarea::placeholder{color:#1e3040}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:#131e2c;border-radius:2px}
        @keyframes spin     {to{transform:rotate(360deg)}}
        @keyframes fadeSlide{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse    {0%,100%{opacity:0.35}50%{opacity:0.75}}
        @keyframes glowPulse{0%,100%{box-shadow:0 0 0 0 rgba(93,168,160,0)}50%{box-shadow:0 0 24px 5px rgba(93,168,160,0.18)}}
        @keyframes micPulse{0%,100%{box-shadow:0 0 0 0 rgba(248,113,113,0)}50%{box-shadow:0 0 0 4px rgba(248,113,113,0.25)}}
        @keyframes loadBar{0%{width:0%}40%{width:55%}70%{width:78%}90%{width:90%}100%{width:93%}}
        .tbtn:hover  {background:#0c1e2e!important;color:${A}!important}
        .icobtn:hover{color:${A}!important;background:#09121e!important}
        .subbtn:hover:not(:disabled){background:#0e6860!important}
        .nextbtn:hover{background:#0c6860!important;box-shadow:0 0 32px 8px rgba(93,168,160,0.25)!important}
        .revlink:hover{color:${A}!important}
      `}</style>

      {showSetup&&<MouseModal draft={draft} setDraft={setDraft} onConfirm={applySetup} isFirstRun/>}
      {showReview&&(
        <ReviewQueue
          queue={reviewQueue}
          rubricMeta={rubricMeta}
          onClose={()=>setShowReview(false)}
          onResolve={handleResolve}
          onVersionBump={handleVersionBump}/>
      )}
      {showSettings&&!showSetup&&
        <MouseModal draft={draft} setDraft={setDraft}
          onConfirm={applySettings} onCancel={()=>setShowSettings(false)} isFirstRun={false}/>}

      {/* ── Header ── */}
      <header style={{display:"flex",alignItems:"center",gap:20,padding:"0 24px",
        height:56,background:"#070a11",borderBottom:"1px solid #0e1828",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:9,fontWeight:800,
          fontSize:17,letterSpacing:"-0.02em",color:T1}}>
          <svg width="20" height="20" viewBox="0 0 18 18">
            <polygon points="9,1 17,5 17,13 9,17 1,13 1,5" fill="none" stroke={A} strokeWidth="1.5"/>
            <polygon points="9,5 13,7 13,11 9,13 5,11 5,7" fill={A} opacity="0.2"/>
          </svg>
          Crucible
          <span style={{color:A,fontSize:11,fontWeight:500,letterSpacing:"0.02em",
            marginLeft:10,opacity:0.7,alignSelf:"flex-end",marginBottom:2}}>
            Mastery is forged under pressure
          </span>
        </div>
        <div style={{width:1,height:20,background:"#121e2c"}}/>
        <div style={{display:"flex",alignItems:"center",gap:11,color:T4}}>
          <div style={{display:"flex",gap:3}}>
            {Array.from({length:12}).map((_,i)=>(
              <div key={i} style={{height:5,borderRadius:3,transition:"all .2s",
                width:i===0?20:5,background:i===0?A:"#0c1825"}}/>
            ))}
          </div>
          <span style={{fontSize:14,fontWeight:500}}>Case 1 of 12</span>
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:16}}>
          <div style={{padding:"4px 11px",borderRadius:4,background:A_BG,color:A,
            fontSize:11,fontWeight:700,letterSpacing:"0.08em",border:`1px solid ${A_BD}`,
            textTransform:"uppercase"}}>{CASE.difficulty}</div>
          {/* Review queue button */}
          <button onClick={()=>setShowReview(true)}
            style={{display:"flex",alignItems:"center",gap:7,padding:"6px 14px",
              borderRadius:5,border:"1px solid #0d1e2c",background:"transparent",
              color:T4,fontFamily:FF,fontSize:13,fontWeight:500,cursor:"pointer",
              position:"relative",transition:"all .15s"}}
            onMouseOver={e=>{e.currentTarget.style.color=A;e.currentTarget.style.borderColor=A_BD;}}
            onMouseOut={e=>{e.currentTarget.style.color=T4;e.currentTarget.style.borderColor="#0d1e2c";}}>
            ⚑ Review Queue
            {reviewQueue.filter(i=>i.status==="pending").length > 0 && (
              <span style={{position:"absolute",top:-5,right:-5,
                width:18,height:18,borderRadius:"50%",
                background:"#c49a3a",color:"#060810",
                fontSize:10,fontWeight:800,display:"flex",
                alignItems:"center",justifyContent:"center"}}>
                {reviewQueue.filter(i=>i.status==="pending").length}
              </span>
            )}
          </button>
          <div style={{fontSize:14,color:T4,fontWeight:500}}>Dr. J. Resident</div>
          <div style={{width:32,height:32,borderRadius:"50%",background:"#0a1820",
            border:"1px solid #152838",display:"flex",alignItems:"center",
            justifyContent:"center",color:A,fontSize:13,fontWeight:700}}>JR</div>
        </div>
      </header>

      {/* ── Toolbar ── */}
      <div style={{display:"flex",alignItems:"center",gap:1,padding:"6px 18px",
        background:"#060910",borderBottom:"1px solid #0b1620",flexShrink:0}}>
        {TOOLS.map(t=>(
          <button key={t.id} className="tbtn" onClick={()=>setTool(t.id)}
            style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,
              padding:"6px 13px",borderRadius:5,border:"none",cursor:"pointer",
              fontFamily:FF,fontSize:11,fontWeight:600,letterSpacing:"0.03em",
              transition:"all .15s",color:tool===t.id?A:T4,
              background:tool===t.id?A_BG:"transparent"}}>
            <span style={{fontSize:15}}>{t.icon}</span>{t.label}
          </button>
        ))}
        <div style={{width:1,height:22,background:"#0d1a25",margin:"0 10px"}}/>
        <div style={{fontSize:12,color:T5}}>{mouseHint(mouse)}</div>
        <button className="icobtn" onClick={openSettings} title="Mouse Settings"
          style={{marginLeft:6,padding:"5px 9px",borderRadius:5,border:"none",
            background:"transparent",cursor:"pointer",color:T5,fontSize:16,transition:"all .15s"}}>⚙</button>
        <div style={{marginLeft:"auto",display:"flex",gap:22,fontSize:12,color:T5}}>
          <span>WW 400 / WL 40</span><span>Zoom 1.0×</span><span>Im {series+1} / 2</span>
        </div>
      </div>

      {/* ── Main ── */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* DICOM Viewer */}
        <div style={{flex:1,background:"#000",position:"relative",overflow:"hidden",
          display:"flex",alignItems:"center",justifyContent:"center",
          cursor:cursorMap[mouse.left]||"default"}}>
          <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",
            justifyContent:"center",padding:20}}>
            <ChestXray/>
          </div>
          {[
            {s:{top:16,left:16},  lines:["PT-●●●●●7432","65M",CASE.id],a:"left"},
            {s:{top:16,right:16}, lines:[CASE.date,"CR · PA + LAT","120 kVp / 4 mAs"],a:"right"},
            {s:{bottom:72,left:16},lines:["Crucible v0.1"],a:"left"},
            {s:{bottom:72,right:16},lines:[`Im ${series+1} / 2`,"512 × 512"],a:"right"},
          ].map(({s,lines,a},i)=>(
            <div key={i} style={{position:"absolute",...s,fontFamily:MONO,fontSize:11,
              color:"#2a4858",lineHeight:1.9,textAlign:a,pointerEvents:"none"}}>
              {lines.map((l,j)=><div key={j}>{l}</div>)}
            </div>
          ))}
          {CASE.useClass==="prototype"&&(
            <div style={{position:"absolute",top:16,left:"50%",transform:"translateX(-50%)",
              padding:"4px 14px",borderRadius:4,background:"rgba(180,120,20,0.15)",
              border:"1px solid rgba(180,120,20,0.35)",fontFamily:FF,fontSize:11,
              fontWeight:600,color:"#b87820",letterSpacing:"0.04em",
              pointerEvents:"none",whiteSpace:"nowrap"}}>
              ⚠ PROTOTYPE — Not licensed for commercial use
            </div>
          )}
          <div style={{position:"absolute",bottom:74,left:"50%",transform:"translateX(-50%)",
            fontSize:11,color:"#1e3040",textAlign:"center",pointerEvents:"none",
            animation:"pulse 4s ease-in-out infinite",whiteSpace:"nowrap"}}>
            Left: {mouse.left} · Middle: {mouse.middle} · Right: {mouse.right} · Scroll: {mouse.scroll}
          </div>
          <div style={{position:"absolute",bottom:0,left:0,right:0,display:"flex",gap:6,
            padding:"8px 18px",background:"linear-gradient(transparent,rgba(0,0,0,0.9))"}}>
            {["PA","LAT"].map((lbl,i)=>(
              <div key={i} onClick={()=>setSeries(i)}
                style={{width:58,height:58,borderRadius:5,cursor:"pointer",
                  border:`1px solid ${series===i?A:"#0f1e2c"}`,background:"#050505",
                  display:"flex",flexDirection:"column",alignItems:"center",
                  justifyContent:"center",gap:4,opacity:series===i?1:0.38,transition:"all .2s"}}>
                <svg viewBox="0 0 28 28" width="28" height="28">
                  <ellipse cx="14" cy="14" rx="10" ry="12" fill="#111"/>
                  <ellipse cx="10" cy="13" rx="4" ry="7" fill="#080808"/>
                  <ellipse cx="18" cy="13" rx="4.5" ry="7" fill="#080808"/>
                  <ellipse cx="12" cy="16" rx="3.5" ry="3.5" fill="#1a1a1a"/>
                </svg>
                <span style={{fontSize:10,fontWeight:600,color:T4}}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right Panel ── */}
        <div style={{width:400,flexShrink:0,background:"#07090e",
          borderLeft:"1px solid #0d1825",display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* Case header */}
          <div style={{padding:"15px 22px 13px",borderBottom:"1px solid #0b1820",flexShrink:0}}>
            <div style={{fontFamily:MONO,fontSize:11,color:T5,marginBottom:5,letterSpacing:"0.04em"}}>
              {CASE.id} · {CASE.date}
            </div>
            <div style={{fontSize:18,fontWeight:700,color:T1,letterSpacing:"-0.01em",marginBottom:9}}>
              {CASE.description}
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {["CR","2 images","No priors",CASE.difficulty].map(tag=>(
                <span key={tag} style={{fontSize:12,fontWeight:500,padding:"3px 10px",
                  borderRadius:4,background:"#090f1c",color:T4,border:"1px solid #0e1c2c"}}>
                  {tag}
                </span>
              ))}
              <span onClick={()=>setShowReview(true)} title="Rubric version — click to view history"
                style={{fontSize:12,fontWeight:600,padding:"3px 10px",borderRadius:4,
                  background:A_BG,color:A,border:`1px solid ${A_BD}`,cursor:"pointer"}}>
                v{rubricMeta.version}
              </span>
            </div>
          </div>

          {/* ── DICTATE ── */}
          {phase==="dictate"&&(<>
            <div style={{flex:1,overflowY:"auto",padding:"16px 22px 0"}}>

              {[{label:"Clinical History",text:CASE.clinicalHistory},
                {label:"Technique",       text:CASE.technique}].map((s,i)=>(
                <div key={i}>
                  {i>0&&<div style={{height:1,background:"#0b1820",margin:"13px 0"}}/>}
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:7}}>
                      <div style={{width:5,height:5,borderRadius:"50%",background:T5,flexShrink:0}}/>
                      <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.07em",
                        textTransform:"uppercase",color:T4}}>{s.label}</span>
                    </div>
                    <div style={{fontSize:13,color:T3,lineHeight:1.7,
                      padding:"10px 13px",background:"#050810",borderRadius:5,
                      border:"1px solid #0b1a28",fontStyle:"italic"}}>{s.text}</div>
                  </div>
                </div>
              ))}

              {apiError&&(
                <div style={{margin:"14px 0 0",padding:"10px 13px",borderRadius:5,
                  background:"rgba(180,60,60,0.1)",border:"1px solid rgba(180,60,60,0.3)",
                  fontSize:13,color:"#c07070",lineHeight:1.6}}>
                  ⚠ {apiError}
                  <button onClick={()=>setApiError(null)}
                    style={{marginLeft:10,fontSize:11,color:"#c07070",background:"transparent",
                      border:"none",cursor:"pointer",fontFamily:FF,
                      textDecoration:"underline",textUnderlineOffset:2}}>
                    Dismiss
                  </button>
                </div>
              )}

              <ModeToggle
                mode={inputMode}
                onChange={handleModeChange}
                difficulty={CASE.difficulty}
                converting={converting}
                convertedFrom={convertedFrom}/>

              {inputMode==="structured"
                ?<StructuredInput fields={sfFields}
                    onChange={(k,v)=>setSfFields(p=>({...p,[k]:v}))}
                    impression={impression} setImpression={setImpression}
                    dictatingField={dictatingField}
                    onMicToggle={toggleDictation}
                    fixableFields={fixableFields}
                    onFix={fixTerms}
                    fixingField={fixingField}/>
                :<FreeInput findings={findings} setFindings={setFindings}
                    impression={impression} setImpression={setImpression}
                    dictatingField={dictatingField}
                    onMicToggle={toggleDictation}
                    fixableFields={fixableFields}
                    onFix={fixTerms}
                    fixingField={fixingField}/>}
            </div>

            <div style={{padding:"13px 22px 17px",borderTop:"1px solid #0b1820",flexShrink:0}}>

              {/* Timer + word count row */}
              <div style={{display:"flex",justifyContent:"space-between",
                alignItems:"center",marginBottom:9}}>
                <div style={{fontFamily:MONO,fontSize:13,color:T5}}>⏱ {fmt(elapsed)}</div>
                {dictatingField&&(
                  <div style={{display:"flex",alignItems:"center",gap:6,
                    fontSize:12,color:"#f87171",fontWeight:600,
                    animation:"micPulse 1.4s ease-in-out infinite",
                    maxWidth:160,overflow:"hidden"}}>
                    <svg width="8" height="8" viewBox="0 0 10 10" style={{flexShrink:0}}>
                      <circle cx="5" cy="5" r="4" fill="#f87171"/>
                    </svg>
                    <span style={{whiteSpace:"nowrap",overflow:"hidden",
                      textOverflow:"ellipsis",opacity:interimText?1:0.7}}>
                      {interimText || "Listening…"}
                    </span>
                  </div>
                )}
                <div style={{fontSize:13,fontWeight:500,color:T5}}>
                  {wordCount} {wordCount===1?"word":"words"}
                </div>
              </div>

              {/* Microphone selector */}
              <div style={{position:"relative",marginBottom:9}}>
                <button
                  onClick={async()=>{
                    if(availableMics.length===0) await loadMics();
                    setShowMicSelector(v=>!v);
                  }}
                  style={{width:"100%",padding:"7px 12px",borderRadius:5,
                    border:"1px solid #0e1c2c",background:"transparent",
                    color:T4,fontFamily:FF,fontSize:12,fontWeight:500,
                    cursor:"pointer",display:"flex",alignItems:"center",
                    justifyContent:"space-between",gap:8,transition:"all .15s"}}
                  onMouseOver={e=>e.currentTarget.style.borderColor=A_BD}
                  onMouseOut={e=>e.currentTarget.style.borderColor="#0e1c2c"}>
                  <div style={{display:"flex",alignItems:"center",gap:7}}>
                    <svg width="12" height="12" viewBox="0 0 13 14" fill="none">
                      <rect x="4" y="0.5" width="5" height="7" rx="2.5" fill={T4}/>
                      <path d="M1.5 6.5c0 2.76 2.24 5 5 5s5-2.24 5-5"
                        stroke={T4} strokeWidth="1.4" strokeLinecap="round" fill="none"/>
                      <line x1="6.5" y1="11.5" x2="6.5" y2="12.8"
                        stroke={T4} strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                    <span>
                      {selectedMicId
                        ? (availableMics.find(m=>m.deviceId===selectedMicId)?.label||"Selected Mic")
                        : "System Default Microphone"}
                    </span>
                  </div>
                  <span style={{fontSize:10,opacity:0.6}}>{showMicSelector?"▲":"▼"}</span>
                </button>

                {/* Dropdown */}
                {showMicSelector&&(
                  <div style={{position:"absolute",bottom:"calc(100% + 4px)",left:0,right:0,
                    background:"#090c14",border:`1px solid ${A_BD}`,borderRadius:6,
                    boxShadow:"0 -8px 24px rgba(0,0,0,0.6)",zIndex:50,overflow:"hidden",
                    animation:"fadeSlide .2s ease both"}}>
                    {availableMics.length===0?(
                      <div style={{padding:"12px 14px",fontSize:12,color:T5,fontStyle:"italic"}}>
                        No microphones found. Check browser permissions.
                      </div>
                    ):(
                      [{deviceId:"",label:"System Default Microphone"},...availableMics].map((mic,i)=>(
                        <div key={mic.deviceId||"default"} onClick={()=>{
                          setSelectedMicId(mic.deviceId);
                          setShowMicSelector(false);
                        }}
                          style={{padding:"10px 14px",fontSize:13,cursor:"pointer",
                            background:selectedMicId===mic.deviceId?A_BG:"transparent",
                            color:selectedMicId===mic.deviceId?A_LT:T3,
                            borderTop:i>0?"1px solid #0c1820":"none",
                            transition:"all .12s",display:"flex",alignItems:"center",gap:8}}
                          onMouseOver={e=>e.currentTarget.style.background="#0c1a28"}
                          onMouseOut={e=>e.currentTarget.style.background=
                            selectedMicId===mic.deviceId?A_BG:"transparent"}>
                          <span style={{fontSize:11,opacity:0.6}}>
                            {selectedMicId===mic.deviceId?"●":"○"}
                          </span>
                          {mic.label||`Microphone ${i}`}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <button className="subbtn" onClick={handleSubmit} disabled={!canSubmit}
                style={{width:"100%",padding:"13px",borderRadius:7,border:"none",
                  fontFamily:FF,fontSize:15,fontWeight:700,letterSpacing:"0.01em",
                  cursor:canSubmit?"pointer":"not-allowed",transition:"all .2s",
                  background:canSubmit?"#0d7068":"#090f1c",
                  color:canSubmit?"#c8ecea":"#1e3040"}}>
                Submit for Feedback →
              </button>
            </div>
          </>)}

          {/* ── LOADING ── */}
          {phase==="loading"&&(
            <div style={{flex:1,display:"flex",flexDirection:"column",
              alignItems:"center",justifyContent:"center",gap:24,padding:"0 28px"}}>
              <div style={{width:44,height:44,borderRadius:"50%",
                border:"2px solid #0d1c28",borderTop:`2px solid ${A}`,
                animation:"spin 0.65s linear infinite"}}/>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:15,fontWeight:600,color:T3,marginBottom:5}}>
                  Analysing report
                </div>
                <div style={{fontSize:12,color:T5}}>Claude Haiku · usually under 2 seconds</div>
              </div>
              <div style={{width:"100%",height:3,borderRadius:2,
                background:"#0c1825",overflow:"hidden"}}>
                <div style={{height:"100%",background:A,borderRadius:2,
                  animation:"loadBar 2.5s cubic-bezier(0.4,0,0.6,1) forwards"}}/>
              </div>
              <div style={{fontSize:12,color:T5,textAlign:"center",lineHeight:2}}>
                <div>Comparing against reference report</div>
                <div>Applying rubric criteria</div>
              </div>
            </div>
          )}

          {/* ── FEEDBACK ── */}
          {phase==="feedback"&&feedback&&(<>

            {/* Score + verbosity toggle */}
            <div style={{padding:"16px 22px 14px",borderBottom:"1px solid #0b1820",
              flexShrink:0,animation:"fadeSlide .4s ease both"}}>

              <div style={{display:"flex",alignItems:"flex-start",gap:15,marginBottom:12}}>
                <ScoreRing score={feedback.overall}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                    <span style={{fontSize:30,fontWeight:800,letterSpacing:"-0.03em",
                      color:scoreColor(feedback.overall)}}>{feedback.grade}</span>
                    <span style={{fontFamily:MONO,fontSize:13,color:T4}}>
                      {feedback.overall} / 100
                    </span>
                    <div style={{marginLeft:"auto"}}>
                      <VerbosityToggle verbosity={verbosity} onChange={setVerbosity}/>
                    </div>
                  </div>
                  <div style={{fontSize:13,color:T3,lineHeight:1.65}}>
                    {verbosity==="succinct"?feedback.summary_short:feedback.summary_long}
                  </div>
                </div>
              </div>

              {/* Your Report toggle button */}
              <button
                onClick={()=>setShowReport(r=>!r)}
                style={{width:"100%",padding:"7px 12px",borderRadius:5,
                  border:"1px solid #0d1e2c",background:showReport?"#0c1e2e":"transparent",
                  color:showReport?A_LT:T5,fontFamily:FF,fontSize:12,fontWeight:600,
                  cursor:"pointer",display:"flex",alignItems:"center",
                  justifyContent:"space-between",transition:"all .18s",
                  boxShadow:showReport?`0 0 0 1px ${A_BD}`:"none"}}>
                <span style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:13}}>📋</span> Your Submitted Report
                </span>
                <span style={{fontSize:11,opacity:0.7}}>{showReport?"▲ Hide":"▼ Show"}</span>
              </button>
            </div>

            {/* Submitted report panel — phrase-level annotation colouring */}
            {showReport&&(()=>{
              // Build global phrase→sentiment map from all section annotations
              const aMap = buildAnnotationMap(feedback);
              return(
              <div style={{borderBottom:"1px solid #0b1820",background:"#050810",
                maxHeight:260,overflowY:"auto",animation:"fadeSlide .25s ease both"}}>
                <div style={{padding:"12px 22px"}}>

                  {/* Legend */}
                  <div style={{display:"flex",gap:12,marginBottom:11,flexWrap:"wrap",
                    alignItems:"center"}}>
                    <span style={{fontSize:10,color:T5,fontWeight:600,
                      letterSpacing:"0.05em",textTransform:"uppercase"}}>Highlights:</span>
                    {[["correct","#4ade80"],["incorrect","#f87171"],["uncertain","#fbbf24"]].map(([lbl,clr])=>(
                      <div key={lbl} style={{display:"flex",alignItems:"center",gap:4}}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:clr}}/>
                        <span style={{fontSize:10,color:clr,fontWeight:600,
                          letterSpacing:"0.05em",textTransform:"capitalize"}}>{lbl}</span>
                      </div>
                    ))}
                  </div>

                  {/* Structured mode: field-level border + phrase-level highlights within */}
                  {inputMode==="structured" && SF.filter(f=>sfFields[f.key]?.trim()).map(f=>{
                    const sent = sentimentFor(f.label, feedback);
                    const clr  = SENTIMENT_COLORS[sent] || T3;
                    return(
                      <div key={f.key} style={{marginBottom:10,
                        paddingLeft:8,borderLeft:`2px solid ${clr}`}}>
                        <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",
                          textTransform:"uppercase",color:clr,marginRight:4}}>{f.label}:</span>
                        <span style={{fontSize:12,lineHeight:1.7}}>
                          <AnnotatedText
                            text={sfFields[f.key]}
                            annotationMap={aMap}
                            fallbackColor={clr}/>
                        </span>
                      </div>
                    );
                  })}

                  {/* Free mode: labeled lines — field border + phrase highlights within */}
                  {inputMode==="free" && findings.trim() && (
                    <div style={{lineHeight:1.9}}>
                      {findings.split("\n").map((line,i)=>{
                        if(!line.trim()) return <div key={i} style={{height:6}}/>;
                        const match = line.match(/^([^:]+):\s*(.*)/);
                        if(match){
                          const fieldLabel = match[1].trim();
                          const text       = match[2].trim();
                          const sent = sentimentFor(fieldLabel, feedback);
                          const clr  = SENTIMENT_COLORS[sent] || T3;
                          return(
                            <div key={i} style={{marginBottom:8,
                              paddingLeft:8,borderLeft:`2px solid ${clr}`}}>
                              <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",
                                textTransform:"uppercase",color:clr,marginRight:4}}>
                                {fieldLabel}:
                              </span>
                              <span style={{fontSize:12}}>
                                <AnnotatedText text={text} annotationMap={aMap} fallbackColor={clr}/>
                              </span>
                            </div>
                          );
                        }
                        return <div key={i} style={{fontSize:12,color:T3,marginBottom:4}}>{line}</div>;
                      })}
                    </div>
                  )}

                  {/* Empty state */}
                  {((inputMode==="structured"&&!SF.some(f=>sfFields[f.key]?.trim()))
                    ||(inputMode==="free"&&!findings.trim())) && (
                    <div style={{fontSize:12,color:T5,fontStyle:"italic"}}>No findings entered.</div>
                  )}

                  {/* Impression — phrase-level annotations */}
                  {impression.trim()&&(()=>{
                    const sent = sentimentFor("Impression", feedback);
                    const clr  = SENTIMENT_COLORS[sent] || T3;
                    return(
                      <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #0b1820",
                        paddingLeft:8,borderLeft:`2px solid ${clr}`}}>
                        <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",
                          textTransform:"uppercase",color:clr,marginRight:4}}>Impression:</span>
                        <span style={{fontSize:12,lineHeight:1.7}}>
                          <AnnotatedText text={impression} annotationMap={aMap} fallbackColor={clr}/>
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );})()}

            {/* Section scores */}
            <div style={{flex:1,overflowY:"auto"}}>
              {/* Succinct: Terminology hidden; sections sorted correct → incorrect → uncertain.
                 Detailed: original rubric order, all sections visible. */}
              {(verbosity==="succinct"
                ? [...feedback.sections]
                    .filter(s => !s.label.toLowerCase().includes("terminology"))
                    .sort((a,b)=>{
                      const ord={correct:0,incorrect:1,uncertain:2};
                      const diff=(ord[a.sentiment]??1)-(ord[b.sentiment]??1);
                      return diff!==0 ? diff : b.score-a.score; // within same sentiment, higher score first
                    })
                : feedback.sections
              ).map((s,i)=>{
                const SC={
                  correct:  {text:"#4ade80",bg:"rgba(74,222,128,0.05)", border:"rgba(74,222,128,0.18)", label:"Correct"  },
                  incorrect:{text:"#f87171",bg:"rgba(248,113,113,0.05)",border:"rgba(248,113,113,0.18)",label:"Incorrect"},
                  uncertain:{text:"#fbbf24",bg:"rgba(251,191,36,0.05)", border:"rgba(251,191,36,0.18)", label:"Uncertain"},
                };
                const sc=SC[s.sentiment]||SC.uncertain;
                return(
                <div key={i} style={{
                  borderBottom:"1px solid #080d18",
                  borderLeft:`3px solid ${sc.text}`,
                  background:sc.bg,
                  animation:`fadeSlide .4s ease ${i*.07+.1}s both`}}>

                  {/* Header row */}
                  <div style={{padding:"12px 18px 0",display:"flex",
                    justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:7,height:7,borderRadius:"50%",
                        background:sc.text,flexShrink:0}}/>
                      <span style={{fontSize:14,fontWeight:700,color:sc.text}}>
                        {s.label}
                      </span>
                      <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.07em",
                        textTransform:"uppercase",color:sc.text,padding:"2px 7px",
                        borderRadius:3,background:sc.bg,border:`1px solid ${sc.border}`}}>
                        {sc.label}
                      </span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {s.review_flag&&(
                        <button
                          onClick={()=>setFlaggedItems(prev=>{
                            const key=`${feedback.overall}-${i}`;
                            const next=new Set(prev);
                            next.has(key)?next.delete(key):next.add(key);
                            return next;
                          })}
                          title={s.review_note||"Flag for radiologist review"}
                          style={{fontSize:11,padding:"2px 8px",borderRadius:3,
                            border:"1px solid #7a5a20",background:"rgba(180,120,20,0.12)",
                            color:"#fbbf24",cursor:"pointer",fontFamily:FF,fontWeight:600,
                            display:"flex",alignItems:"center",gap:4}}>
                          ⛑ Review
                        </button>
                      )}
                      <span style={{fontFamily:MONO,fontSize:14,fontWeight:700,
                        color:sc.text}}>{s.score}</span>
                    </div>
                  </div>

                  {/* Score bar — uses sentiment colour */}
                  <div style={{margin:"0 18px",height:3,borderRadius:2,
                    background:"#0c1825",marginBottom:10,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${s.score}%`,
                      background:sc.text,borderRadius:2,transition:"width 1s ease"}}/>
                  </div>

                  {/* Tier 2/3 review note */}
                  {s.review_flag&&s.review_note&&(
                    <div style={{margin:"0 18px",fontSize:12,color:"#fbbf24",
                      lineHeight:1.6,padding:"7px 10px",borderRadius:4,marginBottom:8,
                      background:"rgba(251,191,36,0.07)",
                      border:"1px solid rgba(251,191,36,0.2)"}}>
                      ⛑ {s.review_note}
                    </div>
                  )}

                  {/* Feedback text — coloured by sentiment */}
                  <div style={{padding:"0 18px 13px",fontSize:13,lineHeight:1.75,
                    fontWeight:500,color:sc.text,transition:"opacity .2s"}}>
                    {verbosity==="succinct"?s.detail_short:s.detail_long}
                  </div>
                </div>
              );})}

              {/* Terminology nudge — succinct mode only */}
              {verbosity==="succinct"&&feedback.sections.some(s=>s.label.toLowerCase().includes("terminology"))&&(
                <div style={{padding:"11px 22px",borderTop:"1px solid #080d18",
                  display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:5,height:5,borderRadius:"50%",
                    background:"#fbbf24",flexShrink:0}}/>
                  <span style={{fontSize:12,color:T5}}>
                    Terminology feedback available in{" "}
                    <span onClick={()=>setVerbosity("detailed")}
                      style={{color:"#fbbf24",cursor:"pointer",fontWeight:600,
                        textDecoration:"underline",textUnderlineOffset:3}}>
                      Detailed
                    </span>{" "}view
                  </span>
                </div>
              )}
            </div>

            {/* Next Case */}
            <div style={{padding:"16px 22px 20px",borderTop:"1px solid #0b1820",
              flexShrink:0,background:"#06080d"}}>
              <div style={{display:"flex",alignItems:"center",gap:13,padding:"12px 14px",
                borderRadius:8,background:"#08101c",border:"1px solid #0d1c2c",marginBottom:12}}>
                <div style={{width:40,height:40,borderRadius:6,background:A_BG,
                  border:`1px solid ${A_BD}`,display:"flex",alignItems:"center",
                  justifyContent:"center",flexShrink:0}}>
                  <svg viewBox="0 0 20 20" width="20" height="20">
                    <ellipse cx="10" cy="10" rx="7" ry="9" fill="#0d0d0d"/>
                    <ellipse cx="7"  cy="9"  rx="3" ry="5" fill="#070707"/>
                    <ellipse cx="13" cy="9"  rx="3" ry="5" fill="#080808"/>
                    <ellipse cx="9"  cy="12" rx="3" ry="3" fill="#181818"/>
                  </svg>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:500,color:T4,marginBottom:3}}>Up next — Case 2 of 12</div>
                  <div style={{fontSize:15,fontWeight:600,color:T3}}>Chest PA + Lateral</div>
                </div>
                <div style={{fontSize:12,fontWeight:500,color:T5,fontFamily:MONO}}>CR</div>
              </div>
              <button className="nextbtn" onClick={handleReset}
                style={{width:"100%",padding:"15px 20px",borderRadius:9,
                  border:`1.5px solid ${A}`,background:A_BG,color:A_LT,
                  fontFamily:FF,fontSize:16,fontWeight:700,cursor:"pointer",
                  letterSpacing:"0.01em",transition:"all .25s",
                  display:"flex",alignItems:"center",justifyContent:"center",gap:14,
                  animation:"glowPulse 3s ease-in-out infinite"}}>
                <span>Continue to Next Case</span>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <circle cx="11" cy="11" r="10" stroke={A} strokeWidth="1.5"/>
                  <path d="M9 7.5L14 11L9 14.5" stroke={A_LT} strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <div style={{textAlign:"center",marginTop:11,fontSize:13,color:T5}}>
                or&nbsp;
                <span className="revlink" onClick={()=>setPhase("dictate")}
                  style={{color:T4,cursor:"pointer",textDecoration:"underline",
                    textUnderlineOffset:3,transition:"color .15s"}}>
                  review your report
                </span>
              </div>
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}
