#!/usr/bin/env node
// Three simulated instruments streaming into a Cortex space (synthetic).
//
//   node daemon/lab-daemon.mjs [--for 30] [--window 30] [--cycle 12] [--fault cavitation|gripper] [--once] [--dry-run [--windows 30]] [--url https://na8ve.com]
//
// Samples every channel at 10 Hz, summarises each 30-second window (mean,
// min, max, last), and sends one batch per window. Every --cycle minutes the
// fault plays out: Feed Pump 2 cavitates (the default), or with --fault gripper
// Arm 3's gripper pads wear past their cycle limit while the feed and the
// broth stay steady. It stops after --for minutes.
// The ingest key comes from NA8VE_INGEST_KEY or ~/.na8ve/ingest/lab-daemon.key.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt; };
const flag = (name) => args.includes(`--${name}`);
const MINUTES = Number(opt("for", "30"));
const WINDOW_S = Number(opt("window", "30"));
const CYCLE_S = Number(opt("cycle", "12")) * 60;
const FAULT = opt("fault", "cavitation");
if (!["cavitation", "gripper"].includes(FAULT)) { console.error("--fault is cavitation or gripper"); process.exit(2); }
const URL_BASE = opt("url", process.env.NA8VE_SITE_URL || "https://na8ve.com").replace(/\/+$/, "");
const DRY = flag("dry-run");
const ONCE = flag("once");
const MAX_WINDOWS = Number(opt("windows", DRY ? "30" : "0"));
const HZ = 10;

function key() {
  if (process.env.NA8VE_INGEST_KEY) return process.env.NA8VE_INGEST_KEY.trim();
  try { return readFileSync(join(process.env.NA8VE_HOME || join(homedir(), ".na8ve"), "ingest", `${opt("key-name", "lab-daemon")}.key`), "utf8").trim(); }
  catch { return ""; }
}

let seed = 20260929;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const noise = (s) => (rand() + rand() + rand() - 1.5) * s;

const state = { feed: 2.0, visc: 1.8, cycles: FAULT === "gripper" ? 41180 : 14502 };
const start = Date.now();

function sample(t) {
  const phase = t % CYCLE_S;
  const spiking = FAULT === "cavitation" && phase > CYCLE_S * 0.5 && phase < CYCLE_S * 0.5 + 90;
  // Worn pads slip as the cycle runs on: torque sags with no change upstream.
  const wear = FAULT === "gripper" && phase > CYCLE_S * 0.5 ? Math.min(1.6, ((phase - CYCLE_S * 0.5) / 90) * 1.6) : 0;
  state.feed += ((spiking ? 4.6 : 2.0) - state.feed) * 0.08;
  state.visc += (1.8 + (state.feed - 2.0) * 0.9 - state.visc) * 0.004;
  if (rand() < 0.05) state.cycles += 1;
  const hours = t / 3600;
  return {
    "hplc-1:retention-time": 4.21 + hours * 0.08 + noise(0.004),
    "hplc-1:column-pressure": 182 + hours * 6.4 + noise(0.6),
    "hplc-1:peak-area": 1520 + noise(18),
    "reactor-b:ph": 7.2 - (state.feed - 2.0) * 0.02 + noise(0.01),
    "reactor-b:temperature": 37.1 + noise(0.04),
    "reactor-b:viscosity": state.visc + noise(0.03),
    "reactor-b:glucose-feed": state.feed + noise(0.05),
    "arm-3:torque": 12.6 - (state.visc - 1.8) * 1.6 - wear + noise(0.15),
    "arm-3:cycles": state.cycles,
  };
}

const CHANNELS = {
  "hplc-1:retention-time": ["HPLC Suite 1", "Retention time", "min"],
  "hplc-1:column-pressure": ["HPLC Suite 1", "Column pressure", "bar"],
  "hplc-1:peak-area": ["HPLC Suite 1", "Peak area", "mAU*s"],
  "reactor-b:ph": ["Bioreactor B", "pH", "pH"],
  "reactor-b:temperature": ["Bioreactor B", "Temperature", "°C"],
  "reactor-b:viscosity": ["Bioreactor B", "Viscosity", "cP"],
  "reactor-b:glucose-feed": ["Bioreactor B", "Glucose feed rate", "L/h"],
  "arm-3:torque": ["Robotic Arm 3", "Torque", "Nm"],
  "arm-3:cycles": ["Robotic Arm 3", "Cycle count", "cycles"],
};

function windowOf(samples, subject, at) {
  const xs = samples.map((s) => s[subject]);
  const [device, quantity, unit] = CHANNELS[subject];
  const r = (x) => Number(x.toFixed(subject === "arm-3:cycles" ? 0 : 3));
  const w = { seconds: WINDOW_S, n: xs.length, mean: r(xs.reduce((a, b) => a + b, 0) / xs.length), min: r(Math.min(...xs)), max: r(Math.max(...xs)), last: r(xs[xs.length - 1]) };
  const reading = { subject, unit, at, device, quantity, tags: ["Batch 42"], window: w, value: w.last };
  if (subject === "arm-3:torque" && w.min < 12) reading.error = "E-14";
  return reading;
}

async function send(readings) {
  const res = await fetch(`${URL_BASE}/api/ingest/batch`, {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ readings }), signal: AbortSignal.timeout(280_000),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const KEY = key();
if (!DRY && !/^n8i_[A-Za-z0-9_-]{43}$/.test(KEY)) {
  console.error("No ingest key. Run: na8ve-agent ingest-key create lab-daemon --alarms daemon/alarms.jsonc");
  process.exit(2);
}

let stop = false;
process.on("SIGINT", () => { stop = true; console.log("\nstopping after this window"); });
console.log(`lab daemon: ${Object.keys(CHANNELS).length} channels at ${HZ} Hz, ${WINDOW_S}s windows, ${FAULT === "gripper" ? "gripper wear" : "a feed spike"} every ${CYCLE_S / 60} min, for ${MINUTES} min${DRY ? " (dry run)" : ` -> ${URL_BASE}`}`);

let simT = 0;
let sent = 0;
while (!stop && Date.now() - start < MINUTES * 60_000 && !(MAX_WINDOWS && sent >= MAX_WINDOWS)) {
  sent++;
  const samples = [];
  const windowStart = Date.now();
  for (let i = 0; i < WINDOW_S * HZ; i++) {
    samples.push(sample(simT));
    simT += 1 / HZ;
    if (!DRY && !ONCE) await new Promise((r) => setTimeout(r, Math.max(0, windowStart + (i + 1) * (1000 / HZ) - Date.now())));
  }
  const at = new Date(start + simT * 1000).toISOString();
  const readings = Object.keys(CHANNELS).map((s) => windowOf(samples, s, at));
  const torque = readings.find((r) => r.subject === "arm-3:torque");
  const summary = `${at.slice(11, 19)}  feed ${readings[6].window.mean.toFixed(2)} L/h  visc ${readings[5].window.mean.toFixed(2)} cP  torque ${torque.window.mean.toFixed(1)} Nm  rt ${readings[0].window.mean.toFixed(3)} min${torque.error ? "  E-14" : ""}`;
  if (DRY) { console.log(summary); if (ONCE) break; continue; }
  try {
    const r = await send(readings);
    console.log(`${summary}  -> ${r.status} ${r.body.ok ?? 0}/${readings.length}`);
    for (const a of r.body.alarms ?? []) {
      console.log(`  ALARM ${a.severity}: ${a.question}`);
      if (a.answer) {
        if (a.context) console.log(`  (given ${a.context} causal fact${a.context === 1 ? "" : "s"} from the graph)`);
        console.log("  Cortex:");
        const width = Math.max(40, (process.stdout.columns || 100) - 4);
        for (const para of a.answer.split(/\n+/)) {
          let line = "";
          for (const word of para.split(/\s+/).filter(Boolean)) {
            if (line && line.length + word.length + 1 > width) { console.log(`    ${line}`); line = word; }
            else line = line ? `${line} ${word}` : word;
          }
          if (line) console.log(`    ${line}`);
        }
        if (a.answerId) console.log(`  (kept in the space as memory ${a.answerId})`);
      }
      else if (a.turnError) console.log(`  (${a.turnError})`);
    }
    if (r.status === 404 || r.status === 401) { console.error("the key was refused; stopping"); break; }
  } catch (e) {
    console.log(`${summary}  -> not sent (${e.name}); continuing`);
  }
  if (ONCE) break;
}
console.log("lab daemon stopped");
