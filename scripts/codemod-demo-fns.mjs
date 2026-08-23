// Rewrites TanStack Start-style `fn({ data: payload })` calls to plain `fn(payload)`.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(new URL(import.meta.url).pathname, "..", "..");
const targets = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") walk(full);
    else if (s.isFile() && /\.(ts|tsx)$/.test(entry)) targets.push(full);
  }
}
walk(path.join(projectRoot, "src"));

const changed = [];
const FN = String.raw`\b(?:fetch\w+|advance|assign|persist\w+|remove\w+|toggle\w+|set\w+|invite|revoke|update\w+|save\w+|delete\w+|list\w+|get\w+)`;

// Match balanced braces to capture inner object literals safely.
function findBalanced(src, openIdx) {
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function replaceDataWrap(src) {
  const re = new RegExp(`(${FN})\\(\\{\\s*data:`, "g");
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    const fnName = m[1];
    const dataKeyStart = m.index + m[0].length;
    // skip whitespace
    let i = dataKeyStart;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== "{") continue;
    const innerStart = i;
    const innerEnd = findBalanced(src, i);
    if (innerEnd < 0) continue;
    // find matching closing paren after the data object
    let j = innerEnd + 1;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] !== "}") continue;
    let k = j + 1;
    while (k < src.length && /\s/.test(src[k])) k++;
    if (src[k] !== ")") continue;
    out += src.slice(last, m.index);
    out += `${fnName}(`;
    // Include any leading whitespace/newline? keep simple with single space
    out += src.slice(innerStart, innerEnd + 1).trim();
    out += ")";
    last = k + 1;
    re.lastIndex = last;
  }
  out += src.slice(last);
  return out;
}

for (const file of targets) {
  const original = readFileSync(file, "utf8");
  let src = original;

  // MutationFn inline arrow form:
  src = src.replace(
    /\(payload:\s*Parameters<typeof\s+(\w+)>\[0\]\["data"\]\)\s*=>\s*(\w+)\(\{\s*data:\s*payload\s*\}\)/g,
    (_, fn1, fn2) => `(_payload: Parameters<typeof ${fn2}>[0]) => ${fn2}(_payload)`,
  );

  src = replaceDataWrap(src);

  if (src !== original) {
    writeFileSync(file, src, "utf8");
    changed.push(path.relative(projectRoot, file));
  }
}

console.log("Rewrote:", changed.length);
for (const c of changed) console.log(" -", c);
