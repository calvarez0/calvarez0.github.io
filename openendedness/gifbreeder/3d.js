/**
 * 3D page:
 * Load a limbomorph genome and evaluate the CPPN over a 3D volume where the
 * time input (t) is treated as a z spatial coordinate. Cluster the resulting
 * colors into a small palette so the "parts" of the pattern become togglable —
 * hide parts to see through to the inner ones. Rendered as a Three.js
 * InstancedMesh of unit-cell cubes (surface-culled for perf at high N).
 *
 * Backgrounding: after the active genome finishes computing at the current
 * (N, k), the remaining gallery genomes are sampled+clustered in the background
 * and cached. Switching between them at the same (N, k) is then instant.
 */

const GALLERY_DIR = 'limbomorphs_archive';
const GALLERY_MANIFEST_PATH = `${GALLERY_DIR}/manifest.json`;
const GALLERY_TILE_RESOLUTION = 32;
// Solid-torus embedding constants. Chosen so the donut sits inside the same
// [-0.5, 0.5]^3 bounding box the cube view uses, which keeps the OrbitControls
// framing usable when the user toggles between shapes.
const TORUS_R = 0.34; // major radius (from world origin to tube axis)
const TORUS_r = 0.16; // maximum minor radius (tube surface)

// Axis indices used for the display permutation.
// 0 = x (source ix, CPPN x input), 1 = y (source iy), 2 = t (source iz).
const AXIS_NAMES = ['x', 'y', 't'];
// Ordered [displayX-source, displayY-source, displayZ-source]. Default order
// [0,1,2] means display's X/Y/Z axes show the CPPN's x/y/t inputs directly.
const AXIS_PERMUTATIONS = [
    { perm: [0, 1, 2], label: 'x, y, t' },
    { perm: [0, 2, 1], label: 'x, t, y' },
    { perm: [1, 0, 2], label: 'y, x, t' },
    { perm: [2, 1, 0], label: 't, y, x' },
    { perm: [1, 2, 0], label: 'y, t, x' },
    { perm: [2, 0, 1], label: 't, x, y' }
];

function permKey(perm) {
    return `${perm[0]}${perm[1]}${perm[2]}`;
}

const DRAWING_TRANSFER_KEY = 'gifbreeder-3d-transfer-v1';
const DRAWING_LINE_ALPHA_THRESHOLD = 8;
const DRAWING_LINE_REFERENCE_RESOLUTION = 512;

// --- Distance field from user-drawn strokes ---
// Ported from drawing.js so 3d.html can rebuild the same field the drawing
// preview uses, at whatever resolution 3d.html is currently sampling at.
// Strokes are objects { width: number, points: [{ x, y }] } with x,y in [0, 1].

function drawStrokesToContext(strokes, ctx, width, height, options = {}) {
    if (!ctx) return;
    const strokeStyle = options.strokeStyle || '#000';
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = strokeStyle;
    for (const stroke of strokes) {
        if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) continue;
        ctx.beginPath();
        stroke.points.forEach((point, index) => {
            const x = point.x * width;
            const y = point.y * height;
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        const strokeWidth = Number.isFinite(stroke.width) ? stroke.width : 8;
        ctx.lineWidth = Math.max(1, strokeWidth * (width / DRAWING_LINE_REFERENCE_RESOLUTION));
        ctx.stroke();
    }
    ctx.restore();
}

function runGridDijkstra(distances, mask, width, height, wallsBlock) {
    const heapIndices = [];
    const heapValues = [];
    const heapPush = (index, value) => {
        let i = heapIndices.length;
        heapIndices.push(index);
        heapValues.push(value);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (heapValues[parent] <= heapValues[i]) break;
            [heapValues[parent], heapValues[i]] = [heapValues[i], heapValues[parent]];
            [heapIndices[parent], heapIndices[i]] = [heapIndices[i], heapIndices[parent]];
            i = parent;
        }
    };
    const heapPop = () => {
        const topIndex = heapIndices[0];
        const topValue = heapValues[0];
        const lastIndex = heapIndices.pop();
        const lastValue = heapValues.pop();
        if (heapIndices.length) {
            heapIndices[0] = lastIndex;
            heapValues[0] = lastValue;
            let i = 0;
            for (;;) {
                const left = 2 * i + 1;
                const right = left + 1;
                let smallest = i;
                if (left < heapValues.length && heapValues[left] < heapValues[smallest]) smallest = left;
                if (right < heapValues.length && heapValues[right] < heapValues[smallest]) smallest = right;
                if (smallest === i) break;
                [heapValues[smallest], heapValues[i]] = [heapValues[i], heapValues[smallest]];
                [heapIndices[smallest], heapIndices[i]] = [heapIndices[i], heapIndices[smallest]];
                i = smallest;
            }
        }
        return { index: topIndex, value: topValue };
    };
    for (let index = 0; index < distances.length; index++) {
        if (Number.isFinite(distances[index])) heapPush(index, distances[index]);
    }
    while (heapIndices.length) {
        const { index, value } = heapPop();
        if (value > distances[index] + 1e-9) continue;
        const px = index % width;
        const py = (index / width) | 0;
        for (let dy = -1; dy <= 1; dy++) {
            const ny = py + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = px + dx;
                if (nx < 0 || nx >= width) continue;
                const neighborIndex = ny * width + nx;
                if (wallsBlock && mask[neighborIndex]) continue;
                if (dx !== 0 && dy !== 0) {
                    if (wallsBlock && mask[py * width + nx] && mask[ny * width + px]) continue;
                }
                const stepCost = (dx !== 0 && dy !== 0) ? Math.SQRT2 : 1;
                const nextValue = value + stepCost;
                if (nextValue < distances[neighborIndex] - 1e-9) {
                    distances[neighborIndex] = nextValue;
                    heapPush(neighborIndex, nextValue);
                }
            }
        }
    }
}

function computeWallClearanceField(mask, width, height) {
    const clearance = new Float64Array(width * height).fill(Infinity);
    for (let index = 0; index < clearance.length; index++) {
        if (mask[index]) { clearance[index] = 0; continue; }
        const px = index % width;
        const py = (index / width) | 0;
        if (px === 0 || py === 0 || px === width - 1 || py === height - 1) {
            clearance[index] = 0.5;
        }
    }
    runGridDijkstra(clearance, mask, width, height, false);
    return clearance;
}

function isClearancePeak(clearance, width, height, index) {
    const epsilon = 1e-4;
    const px = index % width;
    const py = (index / width) | 0;
    const value = clearance[index];
    for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = px + dx;
            if (nx < 0 || nx >= width) continue;
            if (clearance[ny * width + nx] > value + epsilon) return false;
        }
    }
    return true;
}

function isSimplePoint(remaining, width, height, index) {
    const px = index % width;
    const py = (index / width) | 0;
    const at = (dx, dy) => {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return 0;
        return remaining[ny * width + nx] ? 1 : 0;
    };
    const ring = [
        at(1, 0), at(1, -1), at(0, -1), at(-1, -1),
        at(-1, 0), at(-1, 1), at(0, 1), at(1, 1)
    ];
    let connectivity = 0;
    for (const k of [0, 2, 4, 6]) {
        const a = 1 - ring[k];
        const b = 1 - ring[(k + 1) % 8];
        const c = 1 - ring[(k + 2) % 8];
        connectivity += a - a * b * c;
    }
    return connectivity === 1;
}

function extractConnectedCenterRidge(clearance, mask, width, height) {
    const pixelCount = width * height;
    const remaining = new Uint8Array(pixelCount);
    const anchor = new Uint8Array(pixelCount);
    for (let index = 0; index < pixelCount; index++) {
        if (mask[index]) continue;
        remaining[index] = 1;
        if (isClearancePeak(clearance, width, height, index)) anchor[index] = 1;
    }
    const heapIndices = [];
    const heapValues = [];
    const heapPush = (index, value) => {
        let i = heapIndices.length;
        heapIndices.push(index);
        heapValues.push(value);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (heapValues[parent] <= heapValues[i]) break;
            [heapValues[parent], heapValues[i]] = [heapValues[i], heapValues[parent]];
            [heapIndices[parent], heapIndices[i]] = [heapIndices[i], heapIndices[parent]];
            i = parent;
        }
    };
    const heapPop = () => {
        const topIndex = heapIndices[0];
        const lastIndex = heapIndices.pop();
        const lastValue = heapValues.pop();
        if (heapIndices.length) {
            heapIndices[0] = lastIndex;
            heapValues[0] = lastValue;
            let i = 0;
            for (;;) {
                const left = 2 * i + 1;
                const right = left + 1;
                let smallest = i;
                if (left < heapValues.length && heapValues[left] < heapValues[smallest]) smallest = left;
                if (right < heapValues.length && heapValues[right] < heapValues[smallest]) smallest = right;
                if (smallest === i) break;
                [heapValues[smallest], heapValues[i]] = [heapValues[i], heapValues[smallest]];
                [heapIndices[smallest], heapIndices[i]] = [heapIndices[i], heapIndices[smallest]];
                i = smallest;
            }
        }
        return topIndex;
    };
    for (let index = 0; index < pixelCount; index++) {
        if (remaining[index] && !anchor[index]) heapPush(index, clearance[index]);
    }
    while (heapIndices.length) {
        const index = heapPop();
        if (!remaining[index] || anchor[index]) continue;
        if (!isSimplePoint(remaining, width, height, index)) continue;
        remaining[index] = 0;
        const px = index % width;
        const py = (index / width) | 0;
        for (let dy = -1; dy <= 1; dy++) {
            const ny = py + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = px + dx;
                if (nx < 0 || nx >= width) continue;
                const neighborIndex = ny * width + nx;
                if (remaining[neighborIndex] && !anchor[neighborIndex]) {
                    heapPush(neighborIndex, clearance[neighborIndex]);
                }
            }
        }
    }
    return remaining;
}

// Cheaper than buildDistanceFieldFromStrokes when we only need to know which
// pixels are covered by a stroke (for the 3D perturbation extrusion mesh).
function buildStrokeMask(strokes, width, height) {
    if (!Array.isArray(strokes) || strokes.length === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    drawStrokesToContext(strokes, ctx, width, height);
    const alphaData = ctx.getImageData(0, 0, width, height).data;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) {
        mask[i] = alphaData[i * 4 + 3] > DRAWING_LINE_ALPHA_THRESHOLD ? 1 : 0;
    }
    return { width, height, mask };
}

function buildDistanceFieldFromStrokes(strokes, width, height) {
    if (!Array.isArray(strokes) || strokes.length === 0) return null;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskCtx) return null;
    drawStrokesToContext(strokes, maskCtx, width, height);
    const alphaData = maskCtx.getImageData(0, 0, width, height).data;
    const pixelCount = width * height;
    const mask = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        mask[i] = alphaData[i * 4 + 3] > DRAWING_LINE_ALPHA_THRESHOLD ? 1 : 0;
    }
    const clearance = computeWallClearanceField(mask, width, height);
    const centers = extractConnectedCenterRidge(clearance, mask, width, height);
    const centerDistances = new Float64Array(pixelCount).fill(Infinity);
    let centerCount = 0;
    for (let index = 0; index < pixelCount; index++) {
        if (centers[index]) {
            centerDistances[index] = 0;
            centerCount++;
        }
    }
    const values = new Float32Array(pixelCount);
    if (centerCount > 0) {
        runGridDijkstra(centerDistances, mask, width, height, true);
        for (let index = 0; index < pixelCount; index++) {
            values[index] = Number.isFinite(centerDistances[index])
                ? centerDistances[index] / width
                : 0;
        }
    }
    return { width, height, values, mask };
}
// Rough cap on cached label bytes across all entries. Beyond this we evict
// least-recently-used entries. 512^3 = 134MB per entry, so this holds ~6 of
// them at the biggest resolution.
const CACHE_BYTE_BUDGET = 800 * 1024 * 1024;

const State = {
    resolution: 128,
    k: 4,
    shape: 'cube', // 'cube' | 'torus'
    // Which source axis (x=0, y=1, t=2) is displayed at each display axis
    // (display X, Y, Z). Default [0, 1, 2] = identity. Any of the 6
    // permutations in AXIS_PERMUTATIONS is valid.
    axisPerm: [0, 1, 2],
    autoRotate: true,
    partsVisible: [],
    activeFileName: null,
    activeResult: null, // { N, labels, centers, counts, k } — always in natural (unswapped) order
    displayLabels: null, // Uint8Array of labels in the current display order (respects axisPerm)
    // cacheKey = `${fileName}::N=${N}::k=${k}` → { result, bytes, lastUsed }
    cache: new Map(),
    cacheBytes: 0,
    // fileName → { fileName, payload, genome, tile }
    galleryEntries: new Map(),
    // Job token: each new selection/N/k change increments; in-flight jobs
    // check this to cancel themselves at chunk boundaries.
    currentJobToken: 0,
    isProcessing: false,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    voxelMesh: null,
    // Separate mesh for the drawn-perturbation strokes extruded through the t
    // axis. Rendered independently of the color-cluster surface so it can be
    // toggled on/off without disturbing the main volume.
    strokeMesh: null,
    showStrokes: true,
    // Strokes for the currently active entry (null when the entry has none).
    activeStrokes: null,
    // Last-known non-empty strokes preserved for the drawing-page hand-off.
    // Mirrors drawing.html's "strokes persist across genome switches" behavior.
    // Never cleared on gallery-entry switches, only on an explicit incoming
    // update from the drawing page (via applyDrawingTransfer).
    transferStrokes: null,
    frameGroup: null,
    frameLineMaterial: null,
    axisLabels: null,
    keyLight: null,
    fillLight: null,
    tileRenderer: null
};

function setPreviewStatus(text) {
    const container = document.getElementById('preview-status');
    if (!container) return;
    container.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    container.appendChild(p);
}

function setGalleryStatus(text) {
    const container = document.getElementById('gallery-status');
    if (!container) return;
    container.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    container.appendChild(p);
}

function setLoadingVisible(visible, text) {
    const el = document.getElementById('volume-loading');
    const textEl = document.getElementById('volume-loading-text');
    if (!el) return;
    el.hidden = !visible;
    if (textEl && typeof text === 'string') textEl.textContent = text;
}

// (u, v) both in radians; returns the world-space point on the torus surface
// at tube-radial fraction `radial` ∈ [0, 1] from tube axis to tube surface.
function torusEmbedding(u, v, radial) {
    const cosU = Math.cos(u), sinU = Math.sin(u);
    const cosV = Math.cos(v), sinV = Math.sin(v);
    const tubeRadius = radial * TORUS_r;
    const rho = TORUS_R + tubeRadius * cosV;
    return { x: rho * cosU, y: tubeRadius * sinV, z: rho * sinU };
}

// Returns a labels array in display-index order for the given axis
// permutation. perm[i] = source axis (0=x, 1=y, 2=t) shown at display axis i.
// Identity perm [0,1,2] returns the input labels unchanged; other permutations
// build a new transposed array so downstream code (surface culling, mesh
// rendering) can work in display coords without conditional lookups.
function computeDisplayLabels(labels, N, perm) {
    if (perm[0] === 0 && perm[1] === 1 && perm[2] === 2) return labels;
    const swapped = new Uint8Array(labels.length);
    for (let iz = 0; iz < N; iz++) {
        for (let iy = 0; iy < N; iy++) {
            for (let ix = 0; ix < N; ix++) {
                // vals[axis] = source-space coordinate along that axis.
                // di = value of the source axis that display axis i shows.
                const vals = [ix, iy, iz];
                const dix = vals[perm[0]];
                const diy = vals[perm[1]];
                const diz = vals[perm[2]];
                swapped[(diz * N + diy) * N + dix] = labels[(iz * N + iy) * N + ix];
            }
        }
    }
    return swapped;
}

function voxelWorldPosition(ix, iy, iz, N, shape, cellSize) {
    if (shape === 'torus') {
        const u = 2 * Math.PI * ix / N;
        const v = 2 * Math.PI * iy / N;
        const radial = iz / Math.max(1, N - 1);
        return torusEmbedding(u, v, radial);
    }
    const origin = -0.5 + cellSize / 2;
    // y flip so iy=0 (the top of the 2D preview) maps to +y (top) in 3D.
    return {
        x: origin + ix * cellSize,
        y: origin + (N - 1 - iy) * cellSize,
        z: origin + iz * cellSize
    };
}

function addCubeFrame(group, width, height) {
    const s = 0.5;
    const corners = [
        [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
        [-s, -s, s],  [s, -s, s],  [s, s, s],  [-s, s, s]
    ];
    const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    const positions = [];
    for (const [i, j] of edges) {
        positions.push(...corners[i], ...corners[j]);
    }
    // LineSegments2 renders true screen-space-width lines. WebGL's native
    // LineBasicMaterial.linewidth is clamped to 1px on every browser, so real
    // "thin but crisp" lines require this addon path.
    const geom = new THREE.LineSegmentsGeometry().setPositions(positions);
    const mat = new THREE.LineMaterial({
        color: 0x111111,
        linewidth: 1.5, // world-space pixels
        transparent: true,
        opacity: 0.9
    });
    mat.resolution.set(width, height);
    const line = new THREE.LineSegments2(geom, mat);
    line.computeLineDistances();
    group.add(line);
    return mat;
}

function relativeLuminance(hex) {
    const c = new THREE.Color(hex);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function labelColorForBackground(bgHex) {
    // Pick a legible ink color from the current viewport BG. Standard perceptual
    // luminance threshold — same rule matplotlib/mpl-toolkits use for axis text.
    return relativeLuminance(bgHex) >= 0.45 ? '#141414' : '#f2f2f2';
}

function paintLabelCanvas(canvas, text, color) {
    const size = canvas.width;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    // Italic serif is the math/scientific convention for scalar variable names.
    // Times/STIX render cleanly in Chrome/Safari/Firefox canvas without loading
    // any external font.
    ctx.font = `italic 320px "STIX Two Text", "Times New Roman", Times, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, size / 2, size / 2);
}

function makeAxisLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    paintLabelCanvas(canvas, text, '#141414');
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.09, 0.09, 1);
    sprite.renderOrder = 999;
    sprite.userData.canvas = canvas;
    sprite.userData.text = text;
    sprite.userData.texture = texture;
    return sprite;
}

function addTorusFrame(group, width, height) {
    // A few "guide circles" traced on the outer torus surface convey the
    // shape more elegantly than a full wireframe of the whole TorusGeometry.
    // Two families: constant-u (tube cross-sections) and constant-v (loops
    // around the big ring). All packed into one LineSegments2 draw call.
    const positions = [];
    const uSteps = 8;
    const vSteps = 4;
    const seg = 96;
    for (let i = 0; i < uSteps; i++) {
        const u = 2 * Math.PI * i / uSteps;
        for (let k = 0; k < seg; k++) {
            const v0 = 2 * Math.PI * k / seg;
            const v1 = 2 * Math.PI * (k + 1) / seg;
            const p0 = torusEmbedding(u, v0, 1);
            const p1 = torusEmbedding(u, v1, 1);
            positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        }
    }
    for (let j = 0; j < vSteps; j++) {
        const v = 2 * Math.PI * j / vSteps;
        for (let k = 0; k < seg; k++) {
            const u0 = 2 * Math.PI * k / seg;
            const u1 = 2 * Math.PI * (k + 1) / seg;
            const p0 = torusEmbedding(u0, v, 1);
            const p1 = torusEmbedding(u1, v, 1);
            positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        }
    }
    const geom = new THREE.LineSegmentsGeometry().setPositions(positions);
    const mat = new THREE.LineMaterial({
        color: 0x111111,
        linewidth: 1.5,
        transparent: true,
        opacity: 0.8
    });
    mat.resolution.set(width, height);
    const line = new THREE.LineSegments2(geom, mat);
    line.computeLineDistances();
    group.add(line);
    return mat;
}

function addTorusAxisIndicators(group) {
    // On a torus the two surface axes wrap, so labels sit at cardinal
    // positions rather than at arrowheads.
    const [displayXName, displayYName, displayZName] = State.axisPerm.map((i) => AXIS_NAMES[i]);
    const sprites = [];
    const specs = [
        { text: displayXName, pos: new THREE.Vector3(TORUS_R + TORUS_r + 0.08, 0, 0) },
        { text: displayYName, pos: new THREE.Vector3(TORUS_R, TORUS_r + 0.07, 0) },
        { text: displayZName, pos: new THREE.Vector3(0, 0, TORUS_R + TORUS_r + 0.08) }
    ];
    for (const spec of specs) {
        const sprite = makeAxisLabel(spec.text);
        sprite.position.copy(spec.pos);
        group.add(sprite);
        sprites.push(sprite);
    }
    return sprites;
}

function addAxisIndicators(group, lineMaterial) {
    // Each axis is a short arrow extending past the +face of the cube:
    //   shaft (LineSegments2, same style as cube frame)
    //   arrowhead (small cone, MeshBasicMaterial so lighting doesn't dim it)
    //   italic-serif label just past the tip
    // The three arrows meet visually at the -x/-y/-z origin corner via their
    // parallel cube edges, so users can trace each label back to a real axis.
    const s = 0.5;
    const shaftLength = 0.11;
    const coneHeight = 0.055;
    const coneRadius = 0.018;
    const labelGap = 0.045;

    // Each arrow's label follows the axis permutation: the sprite at world +X
    // reads whatever source axis (x/y/t) is currently mapped to display X, and
    // similarly for +Y (display Y) and +Z (display Z).
    const [displayXName, displayYName, displayZName] = State.axisPerm.map((i) => AXIS_NAMES[i]);
    const axes = [
        { name: displayXName, dir: new THREE.Vector3(1, 0, 0), origin: new THREE.Vector3(s, -s, -s) },
        { name: displayYName, dir: new THREE.Vector3(0, 1, 0), origin: new THREE.Vector3(-s, s, -s) },
        { name: displayZName, dir: new THREE.Vector3(0, 0, 1), origin: new THREE.Vector3(-s, -s, s) }
    ];

    // One combined LineSegmentsGeometry for all three shafts keeps them a
    // single draw call in the same material as the cube frame.
    const shaftPositions = [];
    for (const ax of axes) {
        const start = ax.origin;
        const end = start.clone().addScaledVector(ax.dir, shaftLength);
        shaftPositions.push(start.x, start.y, start.z, end.x, end.y, end.z);
    }
    const shaftGeom = new THREE.LineSegmentsGeometry().setPositions(shaftPositions);
    const shafts = new THREE.LineSegments2(shaftGeom, lineMaterial);
    shafts.computeLineDistances();
    group.add(shafts);

    const coneGeom = new THREE.ConeGeometry(coneRadius, coneHeight, 20);
    const coneMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const yAxis = new THREE.Vector3(0, 1, 0);
    const sprites = [];
    for (const ax of axes) {
        const shaftEnd = ax.origin.clone().addScaledVector(ax.dir, shaftLength);
        const cone = new THREE.Mesh(coneGeom, coneMat);
        // Cone is authored along +Y; rotate to align its axis with ax.dir.
        cone.quaternion.setFromUnitVectors(yAxis, ax.dir);
        // Cone's local origin is its centroid; shift so the base sits on the shaft end.
        cone.position.copy(shaftEnd).addScaledVector(ax.dir, coneHeight / 2);
        group.add(cone);

        const label = makeAxisLabel(ax.name);
        label.position.copy(shaftEnd).addScaledVector(ax.dir, coneHeight + labelGap);
        group.add(label);
        sprites.push(label);
    }
    return sprites;
}

function disposeSceneObject(obj) {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
    }
    if (obj.userData && obj.userData.texture) obj.userData.texture.dispose();
}

function clearFrameGroup() {
    if (!State.frameGroup) return;
    while (State.frameGroup.children.length) {
        const child = State.frameGroup.children[0];
        State.frameGroup.remove(child);
        disposeSceneObject(child);
    }
    State.frameLineMaterial = null;
    State.axisLabels = null;
}

function currentStageSize() {
    const stage = document.getElementById('volume-stage');
    return {
        width: stage ? (stage.clientWidth || 512) : 512,
        height: stage ? (stage.clientHeight || 512) : 512
    };
}

function rebuildFrameForShape(width, height) {
    if (!State.frameGroup) return;
    const size = (width && height) ? { width, height } : currentStageSize();
    clearFrameGroup();
    if (State.shape === 'torus') {
        State.frameLineMaterial = addTorusFrame(State.frameGroup, size.width, size.height);
        State.axisLabels = addTorusAxisIndicators(State.frameGroup);
    } else {
        State.frameLineMaterial = addCubeFrame(State.frameGroup, size.width, size.height);
        State.axisLabels = addAxisIndicators(State.frameGroup, State.frameLineMaterial);
    }
    const bgInput = document.getElementById('volume-bg-color');
    refreshAxisLabelInk(bgInput ? bgInput.value : '#808080');
}

function refreshAxisLabelInk(bgHex) {
    if (!State.axisLabels) return;
    const color = labelColorForBackground(bgHex);
    for (const sprite of State.axisLabels) {
        paintLabelCanvas(sprite.userData.canvas, sprite.userData.text, color);
        sprite.userData.texture.needsUpdate = true;
    }
}

function initThreeScene() {
    const stage = document.getElementById('volume-stage');
    if (!stage) return;

    const width = stage.clientWidth || 512;
    const height = stage.clientHeight || 512;

    const scene = new THREE.Scene();
    // Mid-gray by default so both black-background and white-blob limbomorphs
    // read against the empty space around the cube.
    scene.background = new THREE.Color(0x808080);

    const camera = new THREE.PerspectiveCamera(45, width / Math.max(height, 1), 0.01, 100);
    camera.position.set(1.6, 1.2, 1.9);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(width, height, false);
    stage.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = State.autoRotate;
    controls.autoRotateSpeed = 0.6;
    controls.target.set(0, 0, 0);

    const frameGroup = new THREE.Group();
    scene.add(frameGroup);
    State.frameGroup = frameGroup;
    rebuildFrameForShape(width, height);

    // Headlight-style lighting: an ambient floor plus key + fill directional
    // lights whose positions are rewritten each frame to sit at upper-right
    // and lower-left of the current camera. That way the lit face of a voxel
    // always faces the viewer as they orbit, matching the convention used by
    // ParaView, MeshLab, matplotlib mplot3d, etc.
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 0.55);
    scene.add(key);
    scene.add(key.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.2);
    scene.add(fill);
    scene.add(fill.target);
    State.keyLight = key;
    State.fillLight = fill;

    State.scene = scene;
    State.camera = camera;
    State.renderer = renderer;
    State.controls = controls;

    const rightVec = new THREE.Vector3();
    const upVec = new THREE.Vector3();
    const animate = () => {
        controls.update();
        if (State.keyLight && State.fillLight) {
            rightVec.set(1, 0, 0).applyQuaternion(camera.quaternion);
            upVec.set(0, 1, 0).applyQuaternion(camera.quaternion);
            State.keyLight.position.copy(camera.position)
                .addScaledVector(rightVec, 1.6)
                .addScaledVector(upVec, 1.8);
            State.fillLight.position.copy(camera.position)
                .addScaledVector(rightVec, -1.2)
                .addScaledVector(upVec, -0.5);
            State.keyLight.target.position.set(0, 0, 0);
            State.keyLight.target.updateMatrixWorld();
            State.fillLight.target.position.set(0, 0, 0);
            State.fillLight.target.updateMatrixWorld();
        }
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);

    const onResize = () => {
        const w = stage.clientWidth || 512;
        const h = stage.clientHeight || 512;
        camera.aspect = w / Math.max(h, 1);
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        if (State.frameLineMaterial) State.frameLineMaterial.resolution.set(w, h);
    };
    window.addEventListener('resize', onResize);
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(onResize).observe(stage);
    }
}

// --- Streaming volume + clustering pipeline ---

async function yieldToUi() {
    return new Promise((r) => setTimeout(r, 0));
}

// Sample a coarse subgrid of the volume for k-means training. Peak memory
// stays tiny even at N=512 (subsample ≤ ~4k voxels).
function distanceFieldValueAt(field, ix, iy, N) {
    if (!field || !field.values) return null;
    const sx = field.width === N ? ix : Math.min(field.width - 1, Math.floor((ix / N) * field.width));
    const sy = field.height === N ? iy : Math.min(field.height - 1, Math.floor((iy / N) * field.height));
    return field.values[sy * field.width + sx];
}

function sampleSubgrid(network, N, distanceField) {
    const stride = Math.max(1, Math.floor(N / 12));
    const points = [];
    for (let iz = 0; iz < N; iz += stride) {
        const z = iz / Math.max(1, N - 1);
        for (let iy = 0; iy < N; iy += stride) {
            const y = iy / Math.max(1, N - 1) - 0.5;
            for (let ix = 0; ix < N; ix += stride) {
                const x = ix / Math.max(1, N - 1) - 0.5;
                const d = distanceFieldValueAt(distanceField, ix, iy, N);
                const c = network.activate(x, y, z, d, true);
                points.push(c.r, c.g, c.b);
            }
        }
    }
    return new Float32Array(points);
}

function kMeansPlusPlus(sample, k, iterations = 12) {
    const sampleN = sample.length / 3;
    const centers = new Float32Array(k * 3);
    const firstIdx = Math.floor(Math.random() * sampleN);
    centers[0] = sample[firstIdx * 3];
    centers[1] = sample[firstIdx * 3 + 1];
    centers[2] = sample[firstIdx * 3 + 2];
    const distSq = new Float32Array(sampleN).fill(Infinity);
    for (let c = 1; c < k; c++) {
        let sum = 0;
        for (let i = 0; i < sampleN; i++) {
            const dr = sample[i * 3] - centers[(c - 1) * 3];
            const dg = sample[i * 3 + 1] - centers[(c - 1) * 3 + 1];
            const db = sample[i * 3 + 2] - centers[(c - 1) * 3 + 2];
            const d = dr * dr + dg * dg + db * db;
            if (d < distSq[i]) distSq[i] = d;
            sum += distSq[i];
        }
        let pick = Math.random() * sum;
        let chosen = sampleN - 1;
        for (let i = 0; i < sampleN; i++) {
            pick -= distSq[i];
            if (pick <= 0) { chosen = i; break; }
        }
        centers[c * 3] = sample[chosen * 3];
        centers[c * 3 + 1] = sample[chosen * 3 + 1];
        centers[c * 3 + 2] = sample[chosen * 3 + 2];
    }

    const labels = new Uint8Array(sampleN);
    const sums = new Float32Array(k * 3);
    const counts = new Uint32Array(k);
    for (let iter = 0; iter < iterations; iter++) {
        let changed = 0;
        for (let i = 0; i < sampleN; i++) {
            const r = sample[i * 3], g = sample[i * 3 + 1], b = sample[i * 3 + 2];
            let best = 0, bestD = Infinity;
            for (let c = 0; c < k; c++) {
                const dr = r - centers[c * 3];
                const dg = g - centers[c * 3 + 1];
                const db = b - centers[c * 3 + 2];
                const d = dr * dr + dg * dg + db * db;
                if (d < bestD) { bestD = d; best = c; }
            }
            if (labels[i] !== best) changed++;
            labels[i] = best;
        }
        sums.fill(0);
        counts.fill(0);
        for (let i = 0; i < sampleN; i++) {
            const c = labels[i];
            sums[c * 3] += sample[i * 3];
            sums[c * 3 + 1] += sample[i * 3 + 1];
            sums[c * 3 + 2] += sample[i * 3 + 2];
            counts[c]++;
        }
        for (let c = 0; c < k; c++) {
            if (counts[c] > 0) {
                centers[c * 3] = sums[c * 3] / counts[c];
                centers[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
                centers[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
            }
        }
        if (changed === 0 && iter > 0) break;
    }
    return centers;
}

// Full-grid pass: at each voxel, evaluate the network and assign the nearest
// centroid label. Chunked over z slices so we can yield to the UI and check
// for cancellation between chunks.
async function assignLabelsStreaming(network, N, centers, k, onProgress, isCancelled, distanceField) {
    const labels = new Uint8Array(N * N * N);
    const counts = new Uint32Array(k);
    const denom = Math.max(1, N - 1);
    const slicesPerChunk = Math.max(1, Math.floor(N / 24));
    for (let iz = 0; iz < N; iz += slicesPerChunk) {
        const endIz = Math.min(N, iz + slicesPerChunk);
        for (let z_i = iz; z_i < endIz; z_i++) {
            const z = z_i / denom;
            for (let iy = 0; iy < N; iy++) {
                const y = iy / denom - 0.5;
                for (let ix = 0; ix < N; ix++) {
                    const x = ix / denom - 0.5;
                    const dOverride = distanceFieldValueAt(distanceField, ix, iy, N);
                    const c = network.activate(x, y, z, dOverride, true);
                    let best = 0, bestD = Infinity;
                    for (let ci = 0; ci < k; ci++) {
                        const dr = c.r - centers[ci * 3];
                        const dg = c.g - centers[ci * 3 + 1];
                        const db = c.b - centers[ci * 3 + 2];
                        const d = dr * dr + dg * dg + db * db;
                        if (d < bestD) { bestD = d; best = ci; }
                    }
                    labels[(z_i * N + iy) * N + ix] = best;
                    counts[best]++;
                }
            }
        }
        if (typeof onProgress === 'function') onProgress(endIz / N);
        await yieldToUi();
        if (isCancelled()) return null;
    }
    return { labels, counts };
}

async function computeClusteredVolume(network, N, k, onProgress, isCancelled, strokes) {
    if (typeof onProgress === 'function') onProgress(0, 'sampling');
    const distanceField = (Array.isArray(strokes) && strokes.length > 0)
        ? buildDistanceFieldFromStrokes(strokes, N, N)
        : null;
    if (isCancelled()) return null;
    const subsample = sampleSubgrid(network, N, distanceField);
    if (isCancelled()) return null;
    if (typeof onProgress === 'function') onProgress(0, 'clustering');
    const centers = kMeansPlusPlus(subsample, k);
    if (isCancelled()) return null;
    const result = await assignLabelsStreaming(
        network, N, centers, k,
        (frac) => { if (typeof onProgress === 'function') onProgress(frac, 'assigning'); },
        isCancelled,
        distanceField
    );
    if (!result) return null;
    return {
        N,
        k,
        centers,
        labels: result.labels,
        counts: result.counts
    };
}

// --- Rendering ---

function isVoxelSurface(labels, visible, N, ix, iy, iz, periodicX, periodicY) {
    const idx = (iz * N + iy) * N + ix;
    const label = labels[idx];
    if (!visible[label]) return false;
    // z is always non-periodic; +/- z at the ends of the grid are surface.
    if (iz === 0 || iz === N - 1) return true;
    // x, y borders count as surface only when non-periodic (cube shape).
    if (!periodicX && (ix === 0 || ix === N - 1)) return true;
    if (!periodicY && (iy === 0 || iy === N - 1)) return true;

    const N2 = N * N;
    const wrapIx = periodicX
        ? { m: (ix - 1 + N) % N, p: (ix + 1) % N }
        : { m: ix - 1, p: ix + 1 };
    const wrapIy = periodicY
        ? { m: (iy - 1 + N) % N, p: (iy + 1) % N }
        : { m: iy - 1, p: iy + 1 };

    const rowBase = iz * N * N + iy * N;
    const nxm = labels[rowBase + wrapIx.m];
    const nxp = labels[rowBase + wrapIx.p];
    const nym = labels[iz * N * N + wrapIy.m * N + ix];
    const nyp = labels[iz * N * N + wrapIy.p * N + ix];
    const nzm = labels[idx - N2];
    const nzp = labels[idx + N2];
    return (
        !visible[nxm] || nxm !== label ||
        !visible[nxp] || nxp !== label ||
        !visible[nym] || nym !== label ||
        !visible[nyp] || nyp !== label ||
        !visible[nzm] || nzm !== label ||
        !visible[nzp] || nzp !== label
    );
}

function rebuildVoxelMesh() {
    if (!State.scene || !State.activeResult) return;

    if (State.voxelMesh) {
        State.scene.remove(State.voxelMesh);
        State.voxelMesh.geometry.dispose();
        State.voxelMesh.material.dispose();
        State.voxelMesh = null;
    }

    const { N, centers } = State.activeResult;
    const labels = State.displayLabels || State.activeResult.labels;
    const visible = State.partsVisible;
    const shape = State.shape;
    const periodicX = shape === 'torus';
    const periodicY = shape === 'torus';

    let count = 0;
    for (let iz = 0; iz < N; iz++) {
        for (let iy = 0; iy < N; iy++) {
            for (let ix = 0; ix < N; ix++) {
                if (isVoxelSurface(labels, visible, N, ix, iy, iz, periodicX, periodicY)) count++;
            }
        }
    }
    if (count === 0) return;

    // Cell size is chosen so the box lattice tiles roughly gap-free in each
    // shape. On the torus the mean voxel spacing is ~2π·R/N along the big
    // loop; using that as the box edge fills the tube visually.
    const cellSize = shape === 'torus'
        ? (2 * Math.PI * TORUS_R) / N
        : 1 / N;
    const boxGeom = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
    const material = new THREE.MeshLambertMaterial();
    const mesh = new THREE.InstancedMesh(boxGeom, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    let write = 0;
    for (let iz = 0; iz < N; iz++) {
        for (let iy = 0; iy < N; iy++) {
            for (let ix = 0; ix < N; ix++) {
                if (!isVoxelSurface(labels, visible, N, ix, iy, iz, periodicX, periodicY)) continue;
                const label = labels[(iz * N + iy) * N + ix];
                const p = voxelWorldPosition(ix, iy, iz, N, shape, cellSize);
                matrix.makeTranslation(p.x, p.y, p.z);
                mesh.setMatrixAt(write, matrix);
                color.setRGB(centers[label * 3], centers[label * 3 + 1], centers[label * 3 + 2]);
                mesh.setColorAt(write, color);
                write++;
            }
        }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    State.scene.add(mesh);
    State.voxelMesh = mesh;
}

// Extrudes the user's 2D perturbation strokes through the entire t axis and
// renders each stroke voxel with the inverted color of the underlying cluster
// centroid — mirroring the "invert" line rendering the drawing page uses so
// the 3D perturbation reads as the same lines the user drew on the 2D preview.
function rebuildStrokeMesh() {
    if (State.strokeMesh) {
        State.scene.remove(State.strokeMesh);
        State.strokeMesh.geometry.dispose();
        State.strokeMesh.material.dispose();
        State.strokeMesh = null;
    }
    if (!State.scene || !State.activeResult) return;
    if (!State.showStrokes) return;
    const strokes = State.activeStrokes;
    if (!Array.isArray(strokes) || strokes.length === 0) return;

    const { N, centers } = State.activeResult;
    // Look up cluster labels in source (unpermuted) order so the inverted color
    // matches the CPPN's actual output at (x=ix/N-0.5, y=iy/N-0.5, t=iz/N).
    const sourceLabels = State.activeResult.labels;

    const field = buildStrokeMask(strokes, N, N);
    if (!field || !field.mask) return;
    const mask = field.mask;

    // Count masked pixels first so we can size the InstancedMesh exactly.
    let maskedPixelCount = 0;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i]) maskedPixelCount++;
    }
    if (maskedPixelCount === 0) return;
    const count = maskedPixelCount * N;

    const shape = State.shape;
    const cellSize = shape === 'torus' ? (2 * Math.PI * TORUS_R) / N : 1 / N;
    const boxGeom = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
    const material = new THREE.MeshLambertMaterial();
    const mesh = new THREE.InstancedMesh(boxGeom, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const vals = [0, 0, 0];
    const perm = State.axisPerm;
    let write = 0;

    for (let iy = 0; iy < N; iy++) {
        for (let ix = 0; ix < N; ix++) {
            if (!mask[iy * N + ix]) continue;
            for (let iz = 0; iz < N; iz++) {
                const label = sourceLabels[(iz * N + iy) * N + ix];

                // Source coord (ix, iy, iz) → display coord under axis perm.
                vals[0] = ix; vals[1] = iy; vals[2] = iz;
                const dix = vals[perm[0]];
                const diy = vals[perm[1]];
                const diz = vals[perm[2]];
                const p = voxelWorldPosition(dix, diy, diz, N, shape, cellSize);
                matrix.makeTranslation(p.x, p.y, p.z);
                mesh.setMatrixAt(write, matrix);

                // Inverted centroid color — the "difference-blend" line
                // rendering the drawing page uses.
                color.setRGB(
                    1 - centers[label * 3],
                    1 - centers[label * 3 + 1],
                    1 - centers[label * 3 + 2]
                );
                mesh.setColorAt(write, color);
                write++;
            }
        }
    }
    mesh.count = write;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    State.scene.add(mesh);
    State.strokeMesh = mesh;
}

function rgbCssString(r, g, b) {
    const R = Math.max(0, Math.min(255, Math.round(r * 255)));
    const G = Math.max(0, Math.min(255, Math.round(g * 255)));
    const B = Math.max(0, Math.min(255, Math.round(b * 255)));
    return `rgb(${R}, ${G}, ${B})`;
}

function refreshPartsList() {
    const list = document.getElementById('parts-list');
    if (!list) return;
    list.innerHTML = '';

    if (!State.activeResult) return;
    const { centers, counts, k } = State.activeResult;
    const total = counts.reduce((s, c) => s + c, 0);
    // Sort clusters by volume share descending, then label them by their rank
    // (1 = largest) so the numbering matches the on-screen order and is stable
    // for the user regardless of the underlying k-means centroid index.
    const order = Array.from({ length: k }, (_, i) => i).sort((a, b) => counts[b] - counts[a]);

    for (let rank = 0; rank < order.length; rank++) {
        const c = order[rank];
        const row = document.createElement('label');
        row.className = 'part-row';
        if (!State.partsVisible[c]) row.classList.add('is-hidden');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(State.partsVisible[c]);
        checkbox.addEventListener('change', () => {
            State.partsVisible[c] = checkbox.checked;
            row.classList.toggle('is-hidden', !checkbox.checked);
            rebuildVoxelMesh();
            syncToggleAll();
        });

        const swatch = document.createElement('span');
        swatch.className = 'part-swatch';
        swatch.style.background = rgbCssString(centers[c * 3], centers[c * 3 + 1], centers[c * 3 + 2]);

        const meta = document.createElement('span');
        meta.className = 'part-meta';
        const name = document.createElement('span');
        name.textContent = `Part ${rank + 1}`;
        const share = document.createElement('span');
        const pct = total > 0 ? (counts[c] / total * 100) : 0;
        share.textContent = `${pct.toFixed(1)}%`;
        meta.appendChild(name);
        meta.appendChild(share);

        row.appendChild(checkbox);
        row.appendChild(swatch);
        row.appendChild(meta);
        list.appendChild(row);
    }
    syncToggleAll();
}

function syncToggleAll() {
    const toggleAll = document.getElementById('parts-toggle-all');
    if (!toggleAll) return;
    toggleAll.checked = State.partsVisible.length > 0 && State.partsVisible.every(Boolean);
}

// --- Cache ---

function cacheKeyFor(fileName, N, k) {
    return `${fileName}::N=${N}::k=${k}`;
}

function estimateResultBytes(result) {
    // Uint8Array labels dominate.
    return result.N * result.N * result.N + 128;
}

function cachePut(key, result) {
    if (State.cache.has(key)) {
        const prev = State.cache.get(key);
        State.cacheBytes -= prev.bytes;
        State.cache.delete(key);
    }
    const bytes = estimateResultBytes(result);
    State.cache.set(key, { result, bytes, lastUsed: performance.now() });
    State.cacheBytes += bytes;
    evictIfOverBudget();
}

function cacheGet(key) {
    const entry = State.cache.get(key);
    if (!entry) return null;
    entry.lastUsed = performance.now();
    // Move to end for LRU ordering (Map preserves insertion order).
    State.cache.delete(key);
    State.cache.set(key, entry);
    return entry.result;
}

function evictIfOverBudget() {
    while (State.cacheBytes > CACHE_BYTE_BUDGET && State.cache.size > 1) {
        const oldestKey = State.cache.keys().next().value;
        const entry = State.cache.get(oldestKey);
        State.cacheBytes -= entry.bytes;
        State.cache.delete(oldestKey);
    }
}

// --- Job queue: active first, then background prefetch ---

function invalidateJobsAndRestart() {
    State.currentJobToken++;
    if (!State.isProcessing) {
        processQueue();
    }
}

// Kicks the queue if idle without cancelling any in-flight compute. Used when
// gallery entries arrive after processing has finished the previous batch.
function nudgeQueueIfIdle() {
    if (!State.isProcessing) {
        processQueue();
    }
}

function updateBgStatus(text) {
    const el = document.getElementById('bg-status');
    if (el) el.textContent = text || '';
}

async function processQueue() {
    State.isProcessing = true;
    try {
        while (true) {
            const myToken = State.currentJobToken;
            const isCancelled = () => myToken !== State.currentJobToken;

            const N = State.resolution;
            const k = State.k;
            const active = State.activeFileName;

            // Priority order: active first, then any other gallery entries
            // still missing from the cache at (N, k). Rebuilt every iteration
            // so entries added mid-pass (gallery still loading) get picked up.
            const queue = [];
            if (active && State.galleryEntries.has(active)
                && !State.cache.has(cacheKeyFor(active, N, k))) {
                queue.push(active);
            }
            for (const [name] of State.galleryEntries) {
                if (name === active) continue;
                if (State.cache.has(cacheKeyFor(name, N, k))) continue;
                queue.push(name);
            }

            if (queue.length === 0) {
                if (isCancelled()) continue;
                updateBgStatus(`Cached ${State.cache.size} volume${State.cache.size === 1 ? '' : 's'}. Idle.`);
                break;
            }

            const fileName = queue[0];
            const entry = State.galleryEntries.get(fileName);
            if (!entry || !entry.genome) {
                // Shouldn't happen, but avoid spinning forever.
                await yieldToUi();
                continue;
            }

            const isActive = (fileName === active);
            if (isActive) setLoadingVisible(true, `Sampling ${fileName}…`);
            else updateBgStatus(`Prefetching ${fileName}… (${N}³, k=${k})`);

            const network = new CPPN.CPPNNetwork(entry.genome);
            const result = await computeClusteredVolume(
                network, N, k,
                (frac, phase) => {
                    const pct = Math.round(frac * 100);
                    if (isActive) {
                        if (phase === 'sampling') setLoadingVisible(true, 'Sampling subgrid…');
                        else if (phase === 'clustering') setLoadingVisible(true, 'Clustering colors…');
                        else setLoadingVisible(true, `Assigning labels… ${pct}%`);
                    } else {
                        updateBgStatus(`Prefetching ${fileName}… ${pct}% (${N}³, k=${k})`);
                    }
                },
                isCancelled,
                entry.strokes || null
            );
            if (isCancelled()) continue;
            if (!result) continue;

            cachePut(cacheKeyFor(fileName, N, k), result);

            if (fileName === State.activeFileName) {
                adoptResult(result, fileName);
                setLoadingVisible(false);
            }
        }
    } finally {
        State.isProcessing = false;
    }
}

function refreshDisplayLabels() {
    if (!State.activeResult) {
        State.displayLabels = null;
        return;
    }
    State.displayLabels = computeDisplayLabels(
        State.activeResult.labels,
        State.activeResult.N,
        State.axisPerm
    );
}

function adoptResult(result, fileName) {
    State.activeResult = result;
    if (State.partsVisible.length !== result.k) {
        State.partsVisible = new Array(result.k).fill(true);
    }
    // Read strokes off the active gallery entry so the perturbation extrusion
    // renders whatever the drawing page currently has.
    const entry = State.galleryEntries.get(fileName);
    State.activeStrokes = (entry && Array.isArray(entry.strokes) && entry.strokes.length > 0)
        ? entry.strokes
        : null;
    refreshDisplayLabels();
    refreshPartsList();
    syncStrokeToggleAvailability();
    rebuildVoxelMesh();
    rebuildStrokeMesh();
    const total = result.N * result.N * result.N;
    setPreviewStatus(`${fileName} | ${result.N}³ voxels (${total.toLocaleString()}) | ${result.k} parts`);
}

function selectActive(fileName) {
    if (!fileName) return;
    State.activeFileName = fileName;
    const cached = cacheGet(cacheKeyFor(fileName, State.resolution, State.k));
    if (cached) {
        adoptResult(cached, fileName);
        setLoadingVisible(false);
    } else {
        setPreviewStatus(`${fileName} | preparing ${State.resolution}³ volume…`);
    }
    invalidateJobsAndRestart();
    // Mirror the current selection to localStorage so the drawing page picks it
    // up on its next load (or on a live storage event, if it ever listens).
    persistActiveToDrawing();
}

// Write the current active entry (its underlying payload + preserved strokes)
// to the shared localStorage slot. Content-hashed so a redundant re-write of
// the same state — e.g. after applyDrawingTransfer just read this value — is
// silently skipped, avoiding a cross-tab storage-event echo loop.
function persistActiveToDrawing() {
    if (typeof localStorage === 'undefined') return;
    if (!State.activeFileName) return;
    const entry = State.galleryEntries.get(State.activeFileName);
    if (!entry || !entry.payload) return;

    // Use the preserved cross-page strokes rather than State.activeStrokes so
    // switching to a plain gallery entry in 3D doesn't wipe the user's drawn
    // strokes on the drawing page.
    const strokesSource = Array.isArray(State.transferStrokes)
        ? State.transferStrokes
        : (Array.isArray(State.activeStrokes) ? State.activeStrokes : []);
    const strokes = strokesSource.map((s) => ({
        width: s.width,
        points: s.points.map((p) => ({ x: p.x, y: p.y }))
    }));

    const toWrite = {
        ...entry.payload,
        format: 'gifbreeder-3d-transfer-v1',
        savedAt: new Date().toISOString(),
        lineStrokes: strokes,
        label: entry.label || State.activeFileName
    };

    try {
        const existing = localStorage.getItem(DRAWING_TRANSFER_KEY);
        if (existing) {
            const parsed = JSON.parse(existing);
            const oldSig = JSON.stringify({
                g: parsed.genome || null,
                s: Array.isArray(parsed.lineStrokes) ? parsed.lineStrokes : [],
                l: parsed.label || null
            });
            const newSig = JSON.stringify({
                g: toWrite.genome || null,
                s: toWrite.lineStrokes,
                l: toWrite.label
            });
            if (oldSig === newSig) return;
        }
        localStorage.setItem(DRAWING_TRANSFER_KEY, JSON.stringify(toWrite));
    } catch (error) {
        console.warn('Could not persist active 3D state to drawing localStorage:', error);
    }
}

// --- Gallery loading (mirrors drawing.js manifest → directory-listing fallback) ---

function toFetchUrl(path) {
    if (typeof path !== 'string') return path;
    if (/^https?:\/\//i.test(path)) return path;
    return encodeURI(path);
}

function isGenomeJsonPath(path) {
    if (typeof path !== 'string') return false;
    const lowered = path.toLowerCase();
    if (!lowered.endsWith('.json')) return false;
    return !lowered.endsWith('/manifest.json') && lowered !== 'manifest.json';
}

function normalizeGalleryPath(path) {
    if (typeof path !== 'string') return null;
    const trimmed = path.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const withoutLeadingDot = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
    if (withoutLeadingDot.startsWith(`${GALLERY_DIR}/`)) return withoutLeadingDot;
    return `${GALLERY_DIR}/${withoutLeadingDot}`;
}

async function loadGalleryManifestFiles() {
    try {
        const response = await fetch(GALLERY_MANIFEST_PATH, { cache: 'no-store' });
        if (!response.ok) return [];
        const manifest = await response.json();
        if (!manifest || !Array.isArray(manifest.files)) return [];
        const files = manifest.files
            .map((name) => normalizeGalleryPath(name))
            .filter((path) => isGenomeJsonPath(path));
        return Array.from(new Set(files));
    } catch (error) {
        return [];
    }
}

async function loadGalleryFilesFromDirectoryListing() {
    try {
        const response = await fetch(`${GALLERY_DIR}/`, { cache: 'no-store' });
        if (!response.ok) return [];
        const html = await response.text();
        const matches = html.matchAll(/href="([^"]+\.json)"/gi);
        const files = [];
        for (const match of matches) {
            const href = match[1];
            if (!href) continue;
            let resolvedPath = href;
            try {
                const url = new URL(href, new URL(`${GALLERY_DIR}/`, window.location.href));
                resolvedPath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
                resolvedPath = decodeURIComponent(resolvedPath);
            } catch (error) {
                resolvedPath = href;
            }
            const galleryIndex = resolvedPath.lastIndexOf(`${GALLERY_DIR}/`);
            if (galleryIndex >= 0) resolvedPath = resolvedPath.slice(galleryIndex);
            const normalized = normalizeGalleryPath(resolvedPath);
            if (isGenomeJsonPath(normalized)) files.push(normalized);
        }
        return Array.from(new Set(files));
    } catch (error) {
        return [];
    }
}

async function getGalleryGenomeFiles() {
    const fromManifest = await loadGalleryManifestFiles();
    if (fromManifest.length > 0) return fromManifest;
    return loadGalleryFilesFromDirectoryListing();
}

function parseGenomePayload(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('missing genome payload');
    }
    if (payload.population && typeof payload.population === 'object') {
        return parseGenomePayload(payload.population);
    }
    if (payload.innovationState
        && window.NEAT
        && typeof window.NEAT.importInnovationState === 'function') {
        window.NEAT.importInnovationState(payload.innovationState);
    }
    if (Array.isArray(payload.genomes) && payload.genomes.length > 0) {
        const first = payload.genomes[0] && payload.genomes[0].genome
            ? { ...payload.genomes[0].genome }
            : { ...payload.genomes[0] };
        if (payload.lineageRecords && typeof payload.lineageRecords === 'object') {
            first.lineageRecords = payload.lineageRecords;
        }
        return { genome: NEAT.Genome.deserialize(first), label: 'Genome 1 from genomes[]' };
    }
    if (payload.genome && typeof payload.genome === 'object') {
        const serialized = { ...payload.genome };
        if (payload.lineage && payload.lineage.records && typeof payload.lineage.records === 'object') {
            serialized.lineageRecords = payload.lineage.records;
        }
        if (payload.lineageRecords && typeof payload.lineageRecords === 'object') {
            serialized.lineageRecords = payload.lineageRecords;
        }
        const genome = NEAT.Genome.deserialize(serialized);
        return { genome, label: payload.genome.id ? `Genome ${payload.genome.id}` : 'Loaded genome' };
    }
    if (Array.isArray(payload.nodes) && Array.isArray(payload.connections)) {
        const serialized = { ...payload };
        if (payload.lineageRecords && typeof payload.lineageRecords === 'object') {
            serialized.lineageRecords = payload.lineageRecords;
        }
        return {
            genome: NEAT.Genome.deserialize(serialized),
            label: payload.id ? `Genome ${payload.id}` : 'Loaded genome'
        };
    }
    throw new Error('no genome found (expected genome.nodes + genome.connections)');
}

// --- Drawing-page cross-transfer ---
// The drawing page writes the current genome + user-drawn strokes to
// localStorage on every change. We adopt it as a special "From drawing" entry
// that lives at the top of the gallery and re-computes whenever the drawing
// content changes.

const DRAWING_TRANSFER_ENTRY_KEY = 'drawing-transfer';

function readCrossPageDrawingState() {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(DRAWING_TRANSFER_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.genome) return null;
        return parsed;
    } catch (error) {
        return null;
    }
}

function normalizeStrokes(strokes) {
    if (!Array.isArray(strokes)) return [];
    return strokes
        .map((stroke) => ({
            width: Number.isFinite(stroke && stroke.width) ? stroke.width : 8,
            points: Array.isArray(stroke && stroke.points)
                ? stroke.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
                : []
        }))
        .filter((s) => s.points.length > 0);
}

function transferContentHash(payload, strokes) {
    // Cheap hash: JSON of the genome shape + strokes. Genomes are small enough
    // that stringifying is fine and catches any mutation from the drawing page.
    try {
        return JSON.stringify({ g: payload.genome || null, s: strokes });
    } catch (error) {
        return String(Math.random());
    }
}

function invalidateCacheForFileName(fileName) {
    for (const key of Array.from(State.cache.keys())) {
        if (!key.startsWith(`${fileName}::`)) continue;
        const entry = State.cache.get(key);
        State.cacheBytes -= entry.bytes;
        State.cache.delete(key);
    }
}

function ensureDrawingTransferTile(fileName, label) {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return null;
    const existing = State.galleryEntries.get(fileName);
    if (existing && existing.tile) {
        existing.tile.title = label;
        return existing.tile;
    }
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'gallery-tile drawing-transfer-tile';
    tile.title = label;
    const canvas = document.createElement('canvas');
    tile.appendChild(canvas);
    // Prepend so the "From drawing" tile is always the first cell of the grid.
    if (grid.firstChild) grid.insertBefore(tile, grid.firstChild);
    else grid.appendChild(tile);
    tile.addEventListener('click', () => {
        document.querySelectorAll('.gallery-tile.is-active').forEach((el) => el.classList.remove('is-active'));
        tile.classList.add('is-active');
        selectActive(fileName);
    });
    return tile;
}

function renderDrawingTransferTile(canvas, genome, strokes) {
    if (!canvas || !State.tileRenderer) return;
    const res = GALLERY_TILE_RESOLUTION;
    const distanceField = strokes && strokes.length
        ? buildDistanceFieldFromStrokes(strokes, res, res)
        : null;
    State.tileRenderer.renderProgressive(genome, canvas, null, {
        resolution: res,
        distanceField,
        distanceLineRendering: distanceField ? 'invert' : 'none'
    });
}

function applyDrawingTransfer(payload, options = {}) {
    if (!payload || !payload.genome) return false;
    if (!State.tileRenderer) State.tileRenderer = new CPPN.CPPNRenderer();

    if (window.NEAT && typeof window.NEAT.resetInnovationState === 'function') {
        window.NEAT.resetInnovationState();
    }
    let loadResult;
    try {
        loadResult = parseGenomePayload(payload);
    } catch (error) {
        console.warn('Could not parse drawing transfer genome:', error);
        return false;
    }

    const fileName = DRAWING_TRANSFER_ENTRY_KEY;
    const strokes = normalizeStrokes(payload.lineStrokes);
    const label = payload.label || 'From drawing';
    // Snapshot the strokes at the transfer's shape so the persist path can
    // preserve them across in-tab gallery switches.
    State.transferStrokes = strokes.length ? strokes : null;
    const contentHash = transferContentHash(payload, strokes);
    const existing = State.galleryEntries.get(fileName);
    const contentChanged = !existing || existing.contentHash !== contentHash;

    const tile = ensureDrawingTransferTile(fileName, label);
    if (tile) {
        const canvas = tile.querySelector('canvas');
        if (contentChanged) renderDrawingTransferTile(canvas, loadResult.genome, strokes);
    }

    State.galleryEntries.set(fileName, {
        fileName,
        payload,
        genome: loadResult.genome,
        tile,
        strokes,
        contentHash,
        label
    });

    if (contentChanged) {
        invalidateCacheForFileName(fileName);
    }

    const wantsSelect = options.select === true
        || (!State.activeFileName && options.select !== false);
    if (wantsSelect) {
        document.querySelectorAll('.gallery-tile.is-active').forEach((el) => el.classList.remove('is-active'));
        if (tile) tile.classList.add('is-active');
        selectActive(fileName);
    } else if (contentChanged && State.activeFileName === fileName) {
        // Content changed on the currently-selected entry — force a recompute.
        invalidateJobsAndRestart();
    }
    return true;
}

async function initGalleryPanel() {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;

    const files = await getGalleryGenomeFiles();
    files.sort();

    if (!files.length) {
        setGalleryStatus(`No genome JSON found in ${GALLERY_DIR}/`);
        if (!State.activeFileName) {
            setPreviewStatus('No gallery genomes found | upload a genome JSON to start');
        }
        return;
    }

    if (!State.tileRenderer) State.tileRenderer = new CPPN.CPPNRenderer();

    let loadedCount = 0;

    for (const filePath of files) {
        try {
            const response = await fetch(toFetchUrl(filePath), { cache: 'no-store' });
            if (!response.ok) continue;
            const payload = await response.json();

            if (window.NEAT && typeof window.NEAT.resetInnovationState === 'function') {
                window.NEAT.resetInnovationState();
            }
            const loadResult = parseGenomePayload(payload);

            const fileName = filePath.split('/').pop() || filePath;
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'gallery-tile';
            tile.title = fileName;

            const canvas = document.createElement('canvas');
            tile.appendChild(canvas);
            grid.appendChild(tile);

            State.tileRenderer.renderProgressive(loadResult.genome, canvas, null, {
                resolution: GALLERY_TILE_RESOLUTION
            });

            State.galleryEntries.set(fileName, {
                fileName,
                payload,
                genome: loadResult.genome,
                tile
            });

            tile.addEventListener('click', () => {
                document.querySelectorAll('.gallery-tile.is-active').forEach((el) => el.classList.remove('is-active'));
                tile.classList.add('is-active');
                selectActive(fileName);
            });
            loadedCount++;

            // Only auto-select the first gallery genome if nothing else has
            // claimed the viewport yet (e.g., a cross-page drawing transfer).
            if (!State.activeFileName) {
                tile.classList.add('is-active');
                selectActive(fileName);
            } else {
                nudgeQueueIfIdle();
            }
        } catch (error) {
            console.warn(`Skipping gallery genome ${filePath}:`, error);
        }
    }

    setGalleryStatus(loadedCount
        ? `${loadedCount} genome${loadedCount === 1 ? '' : 's'} | others prefetch in background`
        : `No loadable genomes in ${GALLERY_DIR}/`);

    if (!loadedCount) {
        setPreviewStatus('No gallery genomes found | upload a genome JSON to start');
    }
}

// --- Upload ---

function handleGenomeUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const raw = typeof reader.result === 'string' ? reader.result : '';
            const parsed = JSON.parse(raw);
            if (window.NEAT && typeof window.NEAT.resetInnovationState === 'function') {
                window.NEAT.resetInnovationState();
            }
            const loadResult = parseGenomePayload(parsed);
            const fileName = `upload::${file.name}`;
            State.galleryEntries.set(fileName, {
                fileName,
                payload: parsed,
                genome: loadResult.genome,
                tile: null
            });
            selectActive(fileName);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid JSON';
            setPreviewStatus(`Could not load genome JSON: ${message}`);
        }
    };
    reader.onerror = () => setPreviewStatus('Could not read that JSON file.');
    reader.readAsText(file);
    event.target.value = '';
}

// --- Controls ---

function updateShapeHint() {
    const hint = document.getElementById('shape-hint');
    if (!hint) return;
    if (State.shape === 'torus') {
        hint.textContent = 'Torus: x and y wrap as the big-loop and tube angles; t is radial from tube center (t=0) to tube surface (t=1).';
    } else {
        hint.textContent = 'Drag to rotate. Scroll to zoom. Right-drag to pan. z axis = the same t input that drives the 2D GIF frames.';
    }
}

function bindControls() {
    const shapeSelect = document.getElementById('volume-shape');
    if (shapeSelect) {
        shapeSelect.value = State.shape;
        shapeSelect.addEventListener('change', (e) => {
            State.shape = e.target.value === 'torus' ? 'torus' : 'cube';
            rebuildFrameForShape();
            rebuildVoxelMesh();
            rebuildStrokeMesh();
            updateShapeHint();
        });
    }

    const resSelect = document.getElementById('volume-resolution');
    resSelect.value = String(State.resolution);
    resSelect.addEventListener('change', (e) => {
        State.resolution = parseInt(e.target.value, 10) || 128;
        // Keep the current view up until the new-N compute lands. If cached, adoption is instant.
        if (State.activeFileName) {
            const cached = cacheGet(cacheKeyFor(State.activeFileName, State.resolution, State.k));
            if (cached) adoptResult(cached, State.activeFileName);
            else setPreviewStatus(`${State.activeFileName} | preparing ${State.resolution}³ volume…`);
        }
        invalidateJobsAndRestart();
    });

    const kSelect = document.getElementById('volume-k');
    kSelect.value = String(State.k);
    kSelect.addEventListener('change', (e) => {
        State.k = parseInt(e.target.value, 10) || 4;
        if (State.activeFileName) {
            const cached = cacheGet(cacheKeyFor(State.activeFileName, State.resolution, State.k));
            if (cached) adoptResult(cached, State.activeFileName);
            else setPreviewStatus(`${State.activeFileName} | preparing k=${State.k}…`);
        }
        invalidateJobsAndRestart();
    });

    document.getElementById('volume-autorotate').addEventListener('click', (e) => {
        State.autoRotate = !State.autoRotate;
        e.currentTarget.classList.toggle('is-active', State.autoRotate);
        if (State.controls) State.controls.autoRotate = State.autoRotate;
    });

    const permSelect = document.getElementById('volume-axis-perm');
    if (permSelect) {
        permSelect.innerHTML = '';
        for (const entry of AXIS_PERMUTATIONS) {
            const opt = document.createElement('option');
            opt.value = permKey(entry.perm);
            opt.textContent = entry.label;
            permSelect.appendChild(opt);
        }
        permSelect.value = permKey(State.axisPerm);
        permSelect.addEventListener('change', (e) => {
            const entry = AXIS_PERMUTATIONS.find((p) => permKey(p.perm) === e.target.value);
            if (!entry) return;
            State.axisPerm = entry.perm.slice();
            // Re-render the axis labels (which read State.axisPerm) and re-transpose
            // the labels to display order for the new permutation.
            rebuildFrameForShape();
            refreshDisplayLabels();
            rebuildVoxelMesh();
            rebuildStrokeMesh();
        });
    }

    document.getElementById('volume-reset-view').addEventListener('click', () => {
        if (!State.camera || !State.controls) return;
        State.camera.position.set(1.6, 1.2, 1.9);
        State.controls.target.set(0, 0, 0);
        State.controls.update();
    });

    document.getElementById('volume-bg-color').addEventListener('input', (e) => {
        if (State.scene) State.scene.background = new THREE.Color(e.target.value);
        refreshAxisLabelInk(e.target.value);
    });

    document.getElementById('parts-toggle-all').addEventListener('change', (e) => {
        const on = e.target.checked;
        State.partsVisible = State.partsVisible.map(() => on);
        refreshPartsList();
        rebuildVoxelMesh();
    });

    const strokesToggle = document.getElementById('strokes-toggle');
    if (strokesToggle) {
        strokesToggle.checked = State.showStrokes;
        strokesToggle.addEventListener('change', (e) => {
            State.showStrokes = e.target.checked;
            rebuildStrokeMesh();
        });
    }

    document.getElementById('genome-upload-input').addEventListener('change', handleGenomeUpload);
}

// Only surface the "Show perturbation" checkbox when the current entry
// actually has drawn strokes — otherwise it's a misleading no-op control.
function syncStrokeToggleAvailability() {
    const wrap = document.getElementById('strokes-toggle-wrap');
    const toggle = document.getElementById('strokes-toggle');
    if (!wrap) return;
    const hasStrokes = Array.isArray(State.activeStrokes) && State.activeStrokes.length > 0;
    wrap.hidden = !hasStrokes;
    if (toggle) toggle.checked = State.showStrokes;
}

function initPage() {
    const outputModeManager = window.CPPN && window.CPPN.OutputColorModeManager
        ? window.CPPN.OutputColorModeManager
        : null;
    if (outputModeManager) outputModeManager.setMode('hsv', { reason: 'startup' });

    if (typeof THREE === 'undefined' || typeof THREE.OrbitControls === 'undefined') {
        setPreviewStatus('Three.js failed to load — check your network connection.');
        return;
    }

    initThreeScene();
    bindControls();

    // Adopt any drawing-page state before the gallery loads, so its "From
    // drawing" tile appears at the top and the volume for it starts sampling
    // first. If no transfer exists, initGalleryPanel auto-selects the first
    // gallery genome as before.
    if (!State.tileRenderer) State.tileRenderer = new CPPN.CPPNRenderer();
    const initialTransfer = readCrossPageDrawingState();
    if (initialTransfer) applyDrawingTransfer(initialTransfer);

    initGalleryPanel();

    // React to further drawing-page updates while this tab is open. Storage
    // events fire only in OTHER tabs on the same origin, which is exactly the
    // drawing-page → 3d-page hand-off we want.
    window.addEventListener('storage', (event) => {
        if (event.key !== DRAWING_TRANSFER_KEY) return;
        if (!event.newValue) return;
        let payload;
        try { payload = JSON.parse(event.newValue); }
        catch { return; }
        if (payload) applyDrawingTransfer(payload);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
} else {
    initPage();
}
