/**
 * OSM XML 河流数据提取脚本（区域化版本）
 * 根据 --region 参数（或 REGION_CODE 环境变量，默认 ganzhou）从
 * regions/<region>/osm/*.osm 提取 waterway=river/stream 坐标，
 * 输出到 regions/<region>/map/rivers.json。
 *
 * 用法:
 *   node scripts/extract-rivers.mjs                 # 默认 region=ganzhou
 *   node scripts/extract-rivers.mjs --region hefei
 *   node scripts/extract-rivers.mjs --input /path/to/custom.osm --region nanchang
 */
import { createReadStream, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { createInterface } from "readline";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

function parseCliArgs() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--region") out.region = argv[++i];
    else if (a === "--input") out.input = argv[++i];
    else if (a.startsWith("--region=")) out.region = a.slice(9);
    else if (a.startsWith("--input=")) out.input = a.slice(8);
  }
  return out;
}

const cli = parseCliArgs();
const REGION = cli.region || process.env.REGION_CODE || "ganzhou";
const REGION_DIR = resolve(PROJECT_ROOT, "regions", REGION);
const CONFIG_PATH = join(REGION_DIR, "region.config.json");

if (!existsSync(CONFIG_PATH)) {
  console.error(`[ERROR] 未找到 region 配置文件: ${CONFIG_PATH}`);
  process.exit(1);
}
const CONFIG = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));

function resolveOsmInput() {
  if (cli.input) return resolve(process.cwd(), cli.input);
  const osmDir = join(REGION_DIR, "osm");
  if (existsSync(osmDir)) {
    const files = readdirSync(osmDir).filter((f) => /\.osm$|^map$/.test(f));
    if (files.length > 0) return join(osmDir, files[0]);
  }
  const fallback = resolve(PROJECT_ROOT, "docs/map");
  if (existsSync(fallback)) {
    console.warn(`[WARN] regions/${REGION}/osm 为空，回退使用 docs/map（可能仅含赣州数据）`);
    return fallback;
  }
  console.error(`[ERROR] 未找到 OSM 输入：请将 .osm 文件放入 regions/${REGION}/osm/ 下，或使用 --input 指定`);
  process.exit(1);
}

const OSM_FILE = resolveOsmInput();
const OUT_FILE = join(REGION_DIR, "map", "rivers.json");

console.log("=== OSM River Extractor ===");
console.log(`Region: ${REGION} (${CONFIG.displayName || ""})`);
console.log("Input:", OSM_FILE);
console.log("Output:", OUT_FILE);

// Phase 1: Collect all node IDs referenced by waterway ways
// Phase 2: Collect node coordinates
// Phase 3: Resolve ways to coordinate arrays

/** @type {Map<string, {lat: number, lon: number}>} */
const nodes = new Map();

/** @type {Map<string, {nodeRefs: string[], tags: Record<string, string>}>} */
const ways = new Map();

// State machine for XML parsing
let currentElement = null; // 'node' | 'way' | null
let currentId = "";
let currentLat = 0;
let currentLon = 0;
let currentNodeRefs = [];
let currentTags = {};
let isWaterway = false;

// Collect way IDs that are waterways (river or stream)
const waterwayWayIds = new Set();
// Collect node IDs we need
const neededNodeIds = new Set();

console.log("\n--- Phase 1: Scanning ways for waterways ---");

const rl1 = createInterface({
  input: createReadStream(OSM_FILE, { encoding: "utf-8" }),
  crlfDelay: Infinity,
});

let lineCount = 0;
let wayCount = 0;

for await (const line of rl1) {
  lineCount++;
  if (lineCount % 1000000 === 0) {
    console.log(`  Scanned ${(lineCount / 1000000).toFixed(1)}M lines...`);
  }

  const trimmed = line.trim();

  if (trimmed.startsWith("<way ")) {
    currentElement = "way";
    const idMatch = trimmed.match(/id="(\d+)"/);
    currentId = idMatch ? idMatch[1] : "";
    currentNodeRefs = [];
    currentTags = {};
    isWaterway = false;
  } else if (currentElement === "way") {
    if (trimmed.startsWith("<nd ")) {
      const refMatch = trimmed.match(/ref="(\d+)"/);
      if (refMatch) currentNodeRefs.push(refMatch[1]);
    } else if (trimmed.startsWith("<tag ")) {
      const kMatch = trimmed.match(/k="([^"]+)"/);
      const vMatch = trimmed.match(/v="([^"]+)"/);
      if (kMatch && vMatch) {
        currentTags[kMatch[1]] = vMatch[1];
        if (kMatch[1] === "waterway" && (vMatch[1] === "river" || vMatch[1] === "stream")) {
          isWaterway = true;
        }
      }
    } else if (trimmed === "</way>") {
      if (isWaterway && currentNodeRefs.length > 0) {
        waterwayWayIds.add(currentId);
        ways.set(currentId, {
          nodeRefs: [...currentNodeRefs],
          tags: { ...currentTags },
        });
        for (const ref of currentNodeRefs) {
          neededNodeIds.add(ref);
        }
        wayCount++;
      }
      currentElement = null;
    }
  }
}

console.log(`  Found ${wayCount} waterway ways`);
console.log(`  Need ${neededNodeIds.size} node coordinates`);

// Phase 2: Collect node coordinates
console.log("\n--- Phase 2: Collecting node coordinates ---");

const rl2 = createInterface({
  input: createReadStream(OSM_FILE, { encoding: "utf-8" }),
  crlfDelay: Infinity,
});

lineCount = 0;
let nodeFound = 0;

for await (const line of rl2) {
  lineCount++;
  if (lineCount % 1000000 === 0) {
    console.log(`  Scanned ${(lineCount / 1000000).toFixed(1)}M lines, found ${nodeFound} nodes...`);
  }

  const trimmed = line.trim();

  if (trimmed.startsWith("<node ")) {
    const idMatch = trimmed.match(/id="(\d+)"/);
    if (idMatch && neededNodeIds.has(idMatch[1])) {
      const latMatch = trimmed.match(/lat="([^"]+)"/);
      const lonMatch = trimmed.match(/lon="([^"]+)"/);
      if (latMatch && lonMatch) {
        nodes.set(idMatch[1], {
          lat: parseFloat(latMatch[1]),
          lon: parseFloat(lonMatch[1]),
        });
        nodeFound++;
      }
    }
  }

  // Stop early once we found all needed nodes
  if (nodeFound >= neededNodeIds.size) {
    console.log("  All needed nodes found, stopping early.");
    break;
  }
}

console.log(`  Resolved ${nodeFound} / ${neededNodeIds.size} nodes`);

// Phase 3: Build GeoJSON
console.log("\n--- Phase 3: Building GeoJSON ---");

const features = [];

for (const [wayId, way] of ways) {
  const coords = [];
  let valid = true;

  for (const ref of way.nodeRefs) {
    const node = nodes.get(ref);
    if (node) {
      coords.push([node.lon, node.lat]);
    } else {
      // Skip ways with missing nodes
      valid = false;
      break;
    }
  }

  if (valid && coords.length >= 2) {
    features.push({
      type: "Feature",
      properties: {
        id: wayId,
        name: way.tags.name || "",
        waterway: way.tags.waterway || "river",
        nameEn: way.tags["name:en"] || "",
      },
      geometry: {
        type: "LineString",
        coordinates: coords,
      },
    });
  }
}

// Sort: rivers first, then streams; longer features first
features.sort((a, b) => {
  if (a.properties.waterway !== b.properties.waterway) {
    return a.properties.waterway === "river" ? -1 : 1;
  }
  return b.geometry.coordinates.length - a.geometry.coordinates.length;
});

const b = CONFIG.osmBounds;
const geojson = {
  type: "FeatureCollection",
  bbox: [b.minLon, b.minLat, b.maxLon, b.maxLat],
  features,
};

// Write output
writeFileSync(OUT_FILE, JSON.stringify(geojson), "utf-8");

const riverCount = features.filter((f) => f.properties.waterway === "river").length;
const streamCount = features.filter((f) => f.properties.waterway === "stream").length;
const totalCoords = features.reduce((s, f) => s + f.geometry.coordinates.length, 0);

console.log(`\n=== Done ===`);
console.log(`  Rivers: ${riverCount}`);
console.log(`  Streams: ${streamCount}`);
console.log(`  Total coordinate points: ${totalCoords}`);
console.log(`  Output: ${OUT_FILE}`);
