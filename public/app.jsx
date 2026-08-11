const { useState } = React;

const ROOM_TYPES = [
  { key: "bedroom", label: "Bedroom" },
  { key: "bathroom", label: "Bathroom / Toilet" },
  { key: "kitchen", label: "Kitchen" },
  { key: "living", label: "Living Room" },
  { key: "dining", label: "Dining Room" },
  { key: "balcony", label: "Balcony" },
  { key: "store", label: "Store Room" },
  { key: "puja", label: "Puja / Prayer Room" },
  { key: "study", label: "Study / Office" },
  { key: "garage", label: "Garage / Parking", onlyGround: true },
];

const floorLabel = (i) => (i === 0 ? "Ground Floor" : `Floor ${i}`);

const defaultRoomsFor = (i) =>
  i === 0
    ? { bedroom: 1, bathroom: 1, kitchen: 1, living: 1, dining: 0, balcony: 0, store: 1, puja: 0, study: 0, garage: 1 }
    : { bedroom: 2, bathroom: 2, kitchen: 0, living: 0, dining: 0, balcony: 1, store: 0, puja: 0, study: 0, garage: 0 };

const createDefaultFloor = (i) => ({ label: floorLabel(i), rooms: defaultRoomsFor(i), notes: "" });

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

.fpd-root {
  --paper: #F7F5EE;
  --grid: #E4DFCF;
  --ink: #1B2430;
  --ink-soft: #5B6472;
  --accent: #B4791B;
  --accent-soft: #EAD3A0;
  --surface: #FFFFFF;
  --border: #DAD5C4;
  --danger: #A83E27;
  font-family: 'Archivo', sans-serif;
  color: var(--ink);
  display: flex;
  min-height: 640px;
  height: 100%;
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.fpd-mono { font-family: 'JetBrains Mono', monospace; }
.fpd-sidebar {
  width: 340px;
  min-width: 280px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.fpd-eyebrow {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--accent);
  text-transform: uppercase;
  padding: 18px 18px 0 18px;
}
.fpd-title {
  font-weight: 700;
  font-size: 18px;
  padding: 2px 18px 14px 18px;
  border-bottom: 1px solid var(--border);
}
.fpd-section {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.fpd-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-soft);
  margin-bottom: 6px;
  display: block;
}
.fpd-input, .fpd-select, .fpd-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  background: var(--paper);
  border-radius: 4px;
  padding: 7px 9px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: var(--ink);
}
.fpd-textarea { font-family: 'Archivo', sans-serif; resize: vertical; min-height: 46px; }
.fpd-row { display: flex; gap: 8px; }
.fpd-row > div { flex: 1; }
.fpd-tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.fpd-tab {
  border: 1px solid var(--border);
  background: var(--paper);
  color: var(--ink-soft);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 999px;
  cursor: pointer;
}
.fpd-tab.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.fpd-stepper-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
}
.fpd-stepper-label { font-size: 13px; }
.fpd-stepper-ctrl { display: flex; align-items: center; gap: 8px; }
.fpd-stepper-btn {
  width: 22px; height: 22px;
  border: 1px solid var(--border);
  background: var(--paper);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  color: var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
}
.fpd-stepper-btn:hover { border-color: var(--accent); color: var(--accent); }
.fpd-stepper-val { width: 18px; text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.fpd-generate {
  margin: 14px 18px 18px 18px;
  background: var(--ink);
  color: var(--paper);
  border: none;
  border-radius: 4px;
  padding: 11px 14px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  cursor: pointer;
}
.fpd-generate:disabled { opacity: 0.5; cursor: default; }
.fpd-generate:hover:not(:disabled) { background: var(--accent); }
.fpd-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 22px 22px;
  overflow-y: auto;
}
.fpd-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between; gap: 12px;
  padding: 14px 20px; background: rgba(247,245,238,0.9); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; backdrop-filter: blur(2px);
}
.fpd-project-input {
  font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 16px;
  border: none; background: transparent; border-bottom: 1px dashed var(--border);
  padding: 2px 0; min-width: 180px;
}
.fpd-project-input:focus { outline: none; border-bottom-color: var(--accent); }
.fpd-meta { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-soft); }
.fpd-actions { display: flex; gap: 8px; }
.fpd-btn {
  border: 1px solid var(--border); background: var(--surface); color: var(--ink);
  font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 7px 11px;
  border-radius: 4px; cursor: pointer;
}
.fpd-btn:hover { border-color: var(--accent); color: var(--accent); }
.fpd-btn:disabled { opacity: 0.4; cursor: default; }
.fpd-canvas-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 28px; }
.fpd-sheet {
  background: #fff; border: 1px solid var(--border); box-shadow: 0 6px 24px rgba(27,36,48,0.08);
  width: 100%; max-width: 760px;
}
.fpd-sheet-img { width: 100%; display: block; border-bottom: 1px solid var(--border); }
.fpd-titleblock {
  display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; font-family: 'JetBrains Mono', monospace; font-size: 10px;
}
.fpd-tb-cell { padding: 8px 10px; border-right: 1px solid var(--border); }
.fpd-tb-cell:last-child { border-right: none; }
.fpd-tb-k { color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px; }
.fpd-empty {
  max-width: 380px; text-align: center; color: var(--ink-soft); font-size: 13px; line-height: 1.6;
}
.fpd-empty svg { margin-bottom: 14px; }
.fpd-status { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-soft); text-align: center; }
.fpd-error-box {
  border: 1px solid var(--danger); background: #FBEDE8; color: var(--danger);
  padding: 12px 14px; border-radius: 4px; font-size: 12px; max-width: 420px;
}
.fpd-code {
  background: var(--ink); color: #D9DEE6; font-family: 'JetBrains Mono', monospace; font-size: 10.5px;
  padding: 12px; border-radius: 4px; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all;
}
.fpd-spin {
  width: 26px; height: 26px; border: 3px solid var(--border); border-top-color: var(--accent);
  border-radius: 50%; animation: fpd-spin 0.8s linear infinite; margin: 0 auto 10px auto;
}
@keyframes fpd-spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) {
  .fpd-root { flex-direction: column; height: auto; }
  .fpd-sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--border); }
}
`;

async function callGenerate(specs, autoFix) {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ specs, local: false, useFallback: true, autoFix }),
    headersTimeout: 600000,
    bodyTimeout: 600000
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !data.ok) {
    throw new Error((data && data.error) || `Server error (${response.status})`);
  }
  return data;
}

function svgDataUri(svg) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function FloorPlanDrafter() {
  const [projectTitle, setProjectTitle] = useState("Untitled Residence");
  const [plotWidth, setPlotWidth] = useState(30);
  const [plotLength, setPlotLength] = useState(40);
  const [unit, setUnit] = useState("ft");
  const [numFloors, setNumFloors] = useState(2);
  const [detail, setDetail] = useState("advanced");
  const [autoFix, setAutoFix] = useState(true);
  const [floors, setFloors] = useState([createDefaultFloor(0), createDefaultFloor(1)]);
  const [activeFloor, setActiveFloor] = useState(0);
  const [svgs, setSvgs] = useState({});
  const [statuses, setStatuses] = useState({});
  const [errors, setErrors] = useState({});
  const [repairInfo, setRepairInfo] = useState({});
  const [generatingAll, setGeneratingAll] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const handleNumFloors = (e) => {
    let n = parseInt(e.target.value, 10);
    if (isNaN(n)) n = 1;
    n = Math.min(6, Math.max(1, n));
    setNumFloors(n);
    setFloors((prev) => {
      const next = [...prev];
      while (next.length < n) next.push(createDefaultFloor(next.length));
      next.length = n;
      return next;
    });
    setSvgs((prev) => {
      const copy = { ...prev };
      Object.keys(copy).forEach((k) => { if (parseInt(k, 10) >= n) delete copy[k]; });
      return copy;
    });
    setActiveFloor((a) => Math.min(a, n - 1));
  };

  const updateRoom = (floorIdx, key, delta) => {
    setFloors((prev) =>
      prev.map((f, i) =>
        i === floorIdx ? { ...f, rooms: { ...f.rooms, [key]: Math.max(0, (f.rooms[key] || 0) + delta) } } : f
      )
    );
  };

  const updateNotes = (floorIdx, val) => {
    setFloors((prev) => prev.map((f, i) => (i === floorIdx ? { ...f, notes: val } : f)));
  };

  const generateFloor = async (idx) => {
    setStatuses((s) => ({ ...s, [idx]: "loading" }));
    setErrors((e) => ({ ...e, [idx]: null }));
    try {
      const data = await callGenerate({
        projectTitle,
        plotWidth,
        plotLength,
        unit,
        detail,
        floor: floors[idx],
        floorIndex: idx,
        numFloors: floors.length
      }, autoFix);
      setSvgs((s) => ({ ...s, [idx]: data.svg }));
      setRepairInfo((r) => ({ ...r, [idx]: { repaired: !!data.repaired, issues: data.issues || [] } }));
      setStatuses((s) => ({ ...s, [idx]: "done" }));
    } catch (err) {
      setErrors((e) => ({ ...e, [idx]: (err && err.message) || "Failed to generate" }));
      setStatuses((s) => ({ ...s, [idx]: "error" }));
    }
  };

  const generateAll = async () => {
    setGeneratingAll(true);
    for (let i = 0; i < floors.length; i++) {
      setActiveFloor(i);
      await generateFloor(i);
    }
    setGeneratingAll(false);
  };

  const downloadSVG = (idx) => {
    const svg = svgs[idx];
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectTitle.replace(/\s+/g, "_")}_${floors[idx].label.replace(/\s+/g, "_")}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const currentFloor = floors[activeFloor];
  const currentStatus = statuses[activeFloor];
  const currentSvg = svgs[activeFloor];
  const currentError = errors[activeFloor];
  const today = new Date().toLocaleDateString();

  return (
    <div className="fpd-root">
      <style>{CSS}</style>

      <div className="fpd-sidebar">
        <div className="fpd-eyebrow">Architectural Drafting</div>
        <div className="fpd-title">Floor Plan Generator</div>

        <div className="fpd-section">
          <span className="fpd-label">Project Name</span>
          <input className="fpd-input" style={{ fontFamily: "Archivo, sans-serif" }} value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} />
        </div>

        <div className="fpd-section">
          <span className="fpd-label">Plot Dimensions</span>
          <div className="fpd-row">
            <div>
              <span className="fpd-label">Width</span>
              <input className="fpd-input" type="number" min="5" max="300" value={plotWidth} onChange={(e) => setPlotWidth(Math.max(5, parseInt(e.target.value, 10) || 5))} />
            </div>
            <div>
              <span className="fpd-label">Length</span>
              <input className="fpd-input" type="number" min="5" max="300" value={plotLength} onChange={(e) => setPlotLength(Math.max(5, parseInt(e.target.value, 10) || 5))} />
            </div>
            <div>
              <span className="fpd-label">Unit</span>
              <select className="fpd-select" value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="ft">ft</option>
                <option value="m">m</option>
              </select>
            </div>
          </div>
        </div>

        <div className="fpd-section">
          <span className="fpd-label">Number of Floors</span>
          <input className="fpd-input" type="number" min="1" max="6" value={numFloors} onChange={handleNumFloors} />
        </div>

        <div className="fpd-section">
          <span className="fpd-label">Detail Level</span>
          <select className="fpd-select" value={detail} onChange={(e) => setDetail(e.target.value)}>
            <option value="advanced">Advanced (doors, windows, furniture, schedule)</option>
            <option value="basic">Basic (schematic line plan)</option>
          </select>
          <label className="fpd-meta" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 11, cursor: "pointer", lineHeight: 1.4 }}>
            <input type="checkbox" checked={autoFix} onChange={(e) => setAutoFix(e.target.checked)} />
            Auto-fix geometry (QA check + repair pass when overlaps are found)
          </label>
        </div>

        <div className="fpd-tabs">
          {floors.map((f, i) => (
            <button key={i} className={`fpd-tab${activeFloor === i ? " active" : ""}`} onClick={() => setActiveFloor(i)}>
              {f.label}{svgs[i] ? " \u2713" : ""}
            </button>
          ))}
        </div>

        <div className="fpd-section" style={{ flex: 1 }}>
          <span className="fpd-label">Rooms on {currentFloor.label}</span>
          {ROOM_TYPES.filter((rt) => !rt.onlyGround || activeFloor === 0).map((rt) => (
            <div className="fpd-stepper-row" key={rt.key}>
              <span className="fpd-stepper-label">{rt.label}</span>
              <div className="fpd-stepper-ctrl">
                <button className="fpd-stepper-btn" onClick={() => updateRoom(activeFloor, rt.key, -1)}>-</button>
                <span className="fpd-stepper-val">{currentFloor.rooms[rt.key]}</span>
                <button className="fpd-stepper-btn" onClick={() => updateRoom(activeFloor, rt.key, 1)}>+</button>
              </div>
            </div>
          ))}
          <span className="fpd-label" style={{ marginTop: 10 }}>Notes (optional)</span>
          <textarea
            className="fpd-textarea"
            placeholder="e.g. open kitchen facing east, attached bathroom for bedroom 1..."
            value={currentFloor.notes}
            onChange={(e) => updateNotes(activeFloor, e.target.value)}
          />
        </div>

        <button className="fpd-generate" disabled={generatingAll} onClick={generateAll}>
          {generatingAll ? `Drafting ${floors[activeFloor].label}...` : "Draft All Floor Plans"}
        </button>
        <div className="fpd-section" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="fpd-meta" style={{ fontSize: 10, lineHeight: 1.5 }}>
            SVG is synthesized by an NVIDIA LLM (OpenAI GPT-OSS 120B by default) via local server /api/generate with SSE streaming. If the API is slow or fails, a built-in schematic template is drawn instead.
          </div>
        </div>
      </div>

      <div className="fpd-main">
        <div className="fpd-topbar">
          <div>
            <div className="fpd-meta">{plotWidth} x {plotLength} {unit} PLOT &middot; {floors.length} FLOOR{floors.length > 1 ? "S" : ""}</div>
          </div>
          <div className="fpd-actions">
            <button className="fpd-btn" disabled={!currentSvg} onClick={() => setShowCode((s) => !s)}>{showCode ? "Hide Code" : "View Code"}</button>
            <button className="fpd-btn" disabled={!currentSvg} onClick={() => downloadSVG(activeFloor)}>Download SVG</button>
            <button className="fpd-btn" disabled={currentStatus === "loading"} onClick={() => generateFloor(activeFloor)}>
              {currentSvg ? "Redraft This Floor" : "Draft This Floor"}
            </button>
          </div>
        </div>

        <div className="fpd-canvas-wrap">
          {currentStatus === "loading" && (
            <div className="fpd-status">
              <div className="fpd-spin" />
              Drafting {currentFloor.label}... (about 1-6 min; the auto-fix pass can add time)
            </div>
          )}

          {currentStatus === "error" && (
            <div className="fpd-error-box">
              <strong>Could not generate this floor.</strong><br />
              {currentError}
            </div>
          )}

          {!currentStatus && !currentSvg && (
            <div className="fpd-empty">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <rect x="8" y="8" width="48" height="48" stroke="#B4791B" strokeWidth="2" />
                <line x1="8" y1="30" x2="56" y2="30" stroke="#B4791B" strokeWidth="1.4" />
                <line x1="30" y1="8" x2="30" y2="30" stroke="#B4791B" strokeWidth="1.4" />
              </svg>
              <div>Set your plot size, floor count, and room counts on the left, then click <strong>Draft All Floor Plans</strong>. Each floor is drawn top-down with dimension labels and fixed, non-overlapping room geometry.</div>
            </div>
          )}

          {currentStatus === "done" && currentSvg && (
            <div className="fpd-sheet">
              <img className="fpd-sheet-img" src={svgDataUri(currentSvg)} alt={`${currentFloor.label} floor plan`} />
              <div className="fpd-titleblock">
                <div className="fpd-tb-cell">
                  <div className="fpd-tb-k">Project</div>
                  {projectTitle}
                </div>
                <div className="fpd-tb-cell">
                  <div className="fpd-tb-k">Floor</div>
                  {currentFloor.label}
                </div>
                <div className="fpd-tb-cell">
                  <div className="fpd-tb-k">Scale</div>
                  NTS
                </div>
                <div className="fpd-tb-cell">
                  <div className="fpd-tb-k">Sheet</div>
                  A-{activeFloor + 1} &middot; {today}
                </div>
              </div>
              {showCode && (
                <div style={{ padding: 12 }}>
                  <div className="fpd-code">{currentSvg}</div>
                </div>
              )}
              {repairInfo[activeFloor] && repairInfo[activeFloor].repaired && (
                <div className="fpd-tb-cell" style={{ gridColumn: "1 / -1", borderRight: "none", borderTop: "1px solid var(--border)" }}>
                  <div className="fpd-tb-k">QA Report</div>
                  {repairInfo[activeFloor].issues.length === 0
                    ? "An overlap was detected and automatically repaired by a second render pass. Final plan passed the geometry check."
                    : `Automatically repaired, but ${repairInfo[activeFloor].issues.length} minor issue(s) remain: ${repairInfo[activeFloor].issues.slice(0, 3).join("; ")}.`}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}