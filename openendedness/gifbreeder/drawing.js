/**
 * Drawing page:
 * Upload genome JSON and draw distance divider lines directly on the GIF preview.
 * Same distance-field algorithm as activation-lab.js, without the network editor.
 */

const DrawingState = {
    genome: null,
    renderer: null,
    previewCanvas: null,
    previewCtx: null,
    lineCanvas: null,
    lineCtx: null,
    lineStrokes: [],
    activeLineStroke: null,
    // 'direct'   -> distance from drawn stroke pixels themselves (default)
    // 'shortest' -> distance from canvas midpoint, strokes force detours
    // 'ridge'    -> distance from computed clearance-ridge center (legacy)
    warpMode: 'direct',
    brushWidth: 8,
    distanceFieldCache: null,
    distanceFieldDirty: true,
    renderPending: false,
    exportInProgress: false,
    loadedGenomeName: 'No genome loaded',
    showDField: false,
    dFieldCanvas: null,
    dFieldCtx: null,
    // Half-width of the CPPN x/y input ranges (defaults reproduce the fixed
    // [-0.5, 0.5] cube the renderer used before extents were configurable).
    xExtent: 0.5,
    yExtent: 0.5,
    // Half-width of the CPPN t-input range around t=0.5. 0.5 → t ∈ [0, 1].
    tExtent: 0.5,
    // performance.now() at the start of the current animation loop; used by
    // the pixel-inspector ticker to compute the CPPN t input for the frame
    // currently on screen. Null when no genome is loaded.
    animationStartTime: null
};
const DRAWING_ARCHIVE_DIR = 'archive';
const DRAWING_EXPRESSIONS_DIR = 'expressions';
const DRAWING_WEIGHT_BOUNDS = { min: -8, max: 8 };
const DRAWING_DOWNLOAD_GIF_RESOLUTION = 512;
// Page-private worker copy: the site's shared gif-export-worker.js predates
// distance-field support and would silently export without the drawing.
const DRAWING_GIF_EXPORT_WORKER_PATH = 'drawing-gif-export-worker.js';
const DRAWING_DOWNLOAD_RESOLUTION_OPTIONS = [64, 128, 512, 1024];
const DRAWING_DISTANCE_PREVIEW_RESOLUTION = 256;
// Brush widths are specified in 512-space so stroke thickness relative to
// the image stays the same at any preview/export resolution.
const DRAWING_DISTANCE_REFERENCE_RESOLUTION = 512;
const DRAWING_DISTANCE_LINE_ALPHA_THRESHOLD = 8;
const DRAWING_GALLERY_DIR = 'limbomorphs';
const DRAWING_GALLERY_MANIFEST_PATH = `${DRAWING_GALLERY_DIR}/manifest.json`;
const DRAWING_GALLERY_TILE_RESOLUTION = 32;
const DRAWING_STATE_STORAGE_KEY = 'cppn-drawing-state-v1';
const LAB_SEED_STORAGE_KEY = 'cppn-activation-seed-v1';
let DrawingProjectSaveRootHandle = null;

function getCurrentVersionDirectoryName() {
    const path = typeof window !== 'undefined' && window.location
        ? decodeURIComponent(window.location.pathname || '')
        : '';
    const match = /(?:^|\/)(legacy_v[\w.]+)(?:\/|$)/.exec(path);
    return match ? match[1] : '';
}

function getTargetSaveDirectorySegments(subdirectoryName) {
    const versionDirectory = getCurrentVersionDirectoryName();
    if (!versionDirectory) return [subdirectoryName];
    if (DrawingProjectSaveRootHandle && DrawingProjectSaveRootHandle.name === versionDirectory) {
        return [subdirectoryName];
    }
    return [versionDirectory, subdirectoryName];
}

async function getNestedDirectoryHandle(rootHandle, segments) {
    let directoryHandle = rootHandle;
    for (const segment of segments) {
        directoryHandle = await directoryHandle.getDirectoryHandle(segment, { create: true });
    }
    return directoryHandle;
}

function downloadBlobFallback(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 0);
}

async function saveBlobToVersionSubdirectory(blob, fileName, _subdirectoryName) {
    downloadBlobFallback(blob, fileName);
    return false;
}

function getOutputColorModeManager() {
    return window.CPPN && window.CPPN.OutputColorModeManager
        ? window.CPPN.OutputColorModeManager
        : null;
}

function initDrawingPage() {
    const previewCanvas = document.getElementById('preview-canvas');
    const lineCanvas = document.getElementById('distance-line-canvas');
    if (!previewCanvas || !lineCanvas) return;

    enforceDrawingWeightBounds();
    DrawingState.previewCanvas = previewCanvas;
    DrawingState.previewCtx = previewCanvas.getContext('2d', { willReadFrequently: true });
    DrawingState.lineCanvas = lineCanvas;
    DrawingState.lineCtx = lineCanvas.getContext('2d');
    const dFieldCanvas = document.getElementById('distance-field-canvas');
    if (dFieldCanvas) {
        DrawingState.dFieldCanvas = dFieldCanvas;
        DrawingState.dFieldCtx = dFieldCanvas.getContext('2d');
    }
    DrawingState.renderer = new CPPN.CPPNRenderer();

    setupDrawingPageEvents();
    fitPreviewSurface();
    syncDistanceDrawingCanvasSize();
    redrawDistanceLines();
    const outputModeManager = getOutputColorModeManager();
    if (outputModeManager) {
        outputModeManager.setMode('hsv', { reason: 'startup' });
    }
    setDrawingActionsEnabled(false);
    const restoredFromSession = restoreDrawingStateFromSession();
    initGalleryPanel({ skipAutoSelect: restoredFromSession });
    requestAnimationFrame(tickPixelInspectorT);
}

// The preview surface is a square of absolutely-positioned canvases; CSS
// aspect-ratio distorts them when both width and height are constrained,
// so size the square explicitly to fit the stage.
function fitPreviewSurface() {
    const stage = document.querySelector('.drawing-panel .lab-preview-stage');
    const surface = document.querySelector('.distance-preview-surface');
    if (!stage || !surface) return;

    const styles = window.getComputedStyle(stage);
    const availableWidth = stage.clientWidth
        - parseFloat(styles.paddingLeft || '0')
        - parseFloat(styles.paddingRight || '0');
    const availableHeight = stage.clientHeight
        - parseFloat(styles.paddingTop || '0')
        - parseFloat(styles.paddingBottom || '0');
    const size = Math.max(64, Math.floor(Math.min(availableWidth, availableHeight)));

    surface.style.width = `${size}px`;
    surface.style.height = `${size}px`;
}

function setupDrawingPageEvents() {
    document.getElementById('genome-upload-input').addEventListener('change', handleGenomeUpload);
    document.getElementById('save-genome-btn').addEventListener('click', downloadDrawingGenomeJson);
    document.getElementById('download-preview-btn').addEventListener('click', toggleDownloadResolutionMenu);
    document.getElementById('download-resolution-menu').addEventListener('click', handleDownloadResolutionMenuClick);
    setupDistanceDrawingEvents();

    window.addEventListener('resize', () => {
        fitPreviewSurface();
        if (!DrawingState.genome) return;
        syncDistanceDrawingCanvasSize();
        redrawDistanceLines();
        queuePreviewRender();
    });

    document.addEventListener('click', (event) => {
        const menuRoot = event.target instanceof Element ? event.target.closest('.download-menu') : null;
        if (!menuRoot) closeDownloadResolutionMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeDownloadResolutionMenu();
    });

    const labLink = document.querySelector('a[href="activation-lab.html"]');
    if (labLink) {
        labLink.addEventListener('click', () => {
            seedActivationLabFromDrawing();
            saveDrawingStateToSession();
        });
    }

    window.addEventListener('beforeunload', () => {
        saveDrawingStateToSession();
    });
}

function setupDistanceDrawingEvents() {
    const lineCanvas = DrawingState.lineCanvas;
    if (!lineCanvas) return;

    const toolSelect = document.getElementById('drawing-tool-select');
    const clearButton = document.getElementById('distance-clear-btn');
    const brushSlider = document.getElementById('distance-brush-slider');

    if (toolSelect) {
        toolSelect.value = DrawingState.warpMode;
        toolSelect.addEventListener('change', () => {
            const nextMode = toolSelect.value;
            if (nextMode !== 'direct' && nextMode !== 'shortest' && nextMode !== 'ridge') return;
            if (nextMode === DrawingState.warpMode) return;
            DrawingState.warpMode = nextMode;
            markDistanceFieldDirty();
            runDistanceFieldUpdate();
            saveDrawingStateToSession();
        });
    }

    if (clearButton) {
        clearButton.addEventListener('click', () => {
            DrawingState.lineStrokes = [];
            DrawingState.activeLineStroke = null;
            markDistanceFieldDirty();
            redrawDistanceLines();
            runDistanceFieldUpdate();
            saveDrawingStateToSession();
        });
    }

    const dFieldToggle = document.getElementById('drawing-show-d-field');
    if (dFieldToggle) {
        dFieldToggle.checked = DrawingState.showDField;
        dFieldToggle.addEventListener('change', () => {
            DrawingState.showDField = dFieldToggle.checked;
            renderDistanceFieldOverlay();
            saveDrawingStateToSession();
        });
    }

    bindExtentInput('drawing-x-extent', 'xExtent');
    bindExtentInput('drawing-y-extent', 'yExtent');
    bindExtentInput('drawing-t-extent', 'tExtent');

    if (brushSlider) {
        brushSlider.addEventListener('input', (event) => {
            const nextWidth = Number.parseFloat(event.target.value);
            if (Number.isFinite(nextWidth)) {
                DrawingState.brushWidth = Math.max(1, nextWidth);
                saveDrawingStateToSession();
            }
        });
    }

    lineCanvas.addEventListener('pointerdown', handleDistancePointerDown);
    lineCanvas.addEventListener('pointermove', handleDistancePointerMove);
    lineCanvas.addEventListener('pointerup', handleDistancePointerUp);
    lineCanvas.addEventListener('pointercancel', handleDistancePointerUp);
    lineCanvas.addEventListener('lostpointercapture', handleDistancePointerUp);
    lineCanvas.addEventListener('pointermove', handlePixelInspectorMove);
    lineCanvas.addEventListener('pointerleave', hidePixelInspector);
}

function bindExtentInput(inputId, stateKey) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = String(DrawingState[stateKey]);
    input.addEventListener('input', () => {
        const raw = Number.parseFloat(input.value);
        if (!Number.isFinite(raw)) return;
        DrawingState[stateKey] = raw;
        // Extent changes rescale the CPPN inputs, so the field-in-CPPN-units
        // and the render both need refreshing. The stroke pixel mask itself
        // is invariant to extent (strokes live in canvas-fractional space).
        renderCPPNPreview();
        saveDrawingStateToSession();
    });
}

function restoreExtentField(stateKey, value, inputId) {
    if (!Number.isFinite(value)) return;
    DrawingState[stateKey] = value;
    const input = document.getElementById(inputId);
    if (input) input.value = String(value);
}

function getDistanceCanvasPoint(event) {
    const canvas = DrawingState.lineCanvas;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    };
}

function handleDistancePointerDown(event) {
    const canvas = DrawingState.lineCanvas;
    const point = getDistanceCanvasPoint(event);
    if (!canvas || !point) return;

    event.preventDefault();
    try {
        canvas.setPointerCapture(event.pointerId);
    } catch (error) {
        // Synthetic pointer events in headless tests may not be capturable.
    }
    DrawingState.activeLineStroke = {
        width: DrawingState.brushWidth,
        points: [point]
    };
    DrawingState.lineStrokes.push(DrawingState.activeLineStroke);
    redrawDistanceLines();
}

function handleDistancePointerMove(event) {
    if (!DrawingState.activeLineStroke) return;
    const point = getDistanceCanvasPoint(event);
    if (!point) return;

    event.preventDefault();
    const points = DrawingState.activeLineStroke.points;
    const previous = points[points.length - 1];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    if ((dx * dx + dy * dy) < 0.000002) return;

    points.push(point);
    redrawDistanceLines();
}

function handleDistancePointerUp(event) {
    if (!DrawingState.activeLineStroke) return;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();

    const stroke = DrawingState.activeLineStroke;
    if (stroke.points.length === 1) {
        const point = stroke.points[0];
        stroke.points.push({ x: point.x + 0.0001, y: point.y + 0.0001 });
    }

    DrawingState.activeLineStroke = null;
    markDistanceFieldDirty();
    redrawDistanceLines();
    runDistanceFieldUpdate();
    saveDrawingStateToSession();
}

function syncDistanceDrawingCanvasSize() {
    const canvas = DrawingState.lineCanvas;
    if (!canvas) return;

    if (canvas.width !== DRAWING_DISTANCE_PREVIEW_RESOLUTION || canvas.height !== DRAWING_DISTANCE_PREVIEW_RESOLUTION) {
        canvas.width = DRAWING_DISTANCE_PREVIEW_RESOLUTION;
        canvas.height = DRAWING_DISTANCE_PREVIEW_RESOLUTION;
    }
}

function drawDistanceStrokesToContext(ctx, width, height, options = {}) {
    if (!ctx) return;

    const strokeStyle = options.strokeStyle || '#000';
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = strokeStyle;

    for (const stroke of DrawingState.lineStrokes) {
        if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) continue;

        ctx.beginPath();
        stroke.points.forEach((point, index) => {
            const x = point.x * width;
            const y = point.y * height;
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.lineWidth = Math.max(
            1,
            (Number.isFinite(stroke.width) ? stroke.width : DrawingState.brushWidth)
                * (width / DRAWING_DISTANCE_REFERENCE_RESOLUTION)
        );
        ctx.stroke();
    }

    ctx.restore();
}

function redrawDistanceLines() {
    syncDistanceDrawingCanvasSize();
    // White strokes + CSS mix-blend-mode: difference on the canvas invert
    // whatever pattern is underneath, keeping lines visible on any background.
    drawDistanceStrokesToContext(
        DrawingState.lineCtx,
        DRAWING_DISTANCE_PREVIEW_RESOLUTION,
        DRAWING_DISTANCE_PREVIEW_RESOLUTION,
        { strokeStyle: '#fff' }
    );
}

function markDistanceFieldDirty() {
    DrawingState.distanceFieldDirty = true;
    DrawingState.distanceFieldCache = null;
}

function getDistanceFieldForResolution(resolution) {
    if (!DrawingState.lineStrokes.length) return null;

    const size = Math.max(1, Math.floor(resolution));
    if (
        DrawingState.distanceFieldCache
        && !DrawingState.distanceFieldDirty
        && DrawingState.distanceFieldCache.width === size
        && DrawingState.distanceFieldCache.height === size
    ) {
        return DrawingState.distanceFieldCache;
    }

    const field = buildDistanceFieldFromLines(size, size);
    DrawingState.distanceFieldCache = field;
    DrawingState.distanceFieldDirty = false;
    return field;
}

function buildDistanceFieldFromLines(width, height) {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskCtx) return null;

    drawDistanceStrokesToContext(maskCtx, width, height);
    const alphaData = maskCtx.getImageData(0, 0, width, height).data;
    const pixelCount = width * height;
    const mask = new Uint8Array(pixelCount);

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
        mask[pixelIndex] = alphaData[pixelIndex * 4 + 3] > DRAWING_DISTANCE_LINE_ALPHA_THRESHOLD ? 1 : 0;
    }

    let values;
    if (DrawingState.warpMode === 'ridge') {
        values = computeRidgeCenterValues(mask, width, height);
    } else if (DrawingState.warpMode === 'shortest') {
        values = computeShortestDistanceValues(mask, width, height);
    } else {
        values = computeDirectCenterValues(mask, width, height);
    }

    return {
        width,
        height,
        values,
        mask
    };
}

// Ridge-center warp (legacy): walls = drawn strokes + image border. The
// "center" of each walled-off region is a connected ridge (clearance peaks
// anchored together by topology-preserving thinning). d = geodesic distance
// from that ridge, so walls truly divide the pattern even when strokes only
// partially cross the image.
function computeRidgeCenterValues(mask, width, height) {
    const pixelCount = width * height;
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
    if (centerCount === 0) return values;

    runGridDijkstra(centerDistances, mask, width, height, true);
    for (let index = 0; index < pixelCount; index++) {
        values[index] = Number.isFinite(centerDistances[index])
            ? centerDistances[index] / width
            : 0;
    }
    return values;
}

// Shortest-distance warp: center stays fixed at the canvas midpoint. Pixels
// whose straight line to center is blocked by a stroke are re-measured as the
// shortest path around the obstruction.
function computeShortestDistanceValues(mask, width, height) {
    const pixelCount = width * height;
    const values = new Float32Array(pixelCount);

    const cx = (width / 2) | 0;
    const cy = (height / 2) | 0;
    const centerIndex = cy * width + cx;
    const seedIndex = mask[centerIndex]
        ? findNearestFreePixel(mask, width, height, cx, cy)
        : centerIndex;
    if (seedIndex < 0) return values;

    const distances = new Float64Array(pixelCount).fill(Infinity);
    distances[seedIndex] = 0;
    runGridDijkstra(distances, mask, width, height, true);

    for (let index = 0; index < pixelCount; index++) {
        values[index] = Number.isFinite(distances[index])
            ? distances[index] / width
            : 0;
    }
    return values;
}

// BFS to nudge the fixed center onto the nearest non-wall pixel when the user
// happens to draw directly on top of the canvas midpoint.
function findNearestFreePixel(mask, width, height, sx, sy) {
    const seen = new Uint8Array(width * height);
    const queue = [sy * width + sx];
    seen[sy * width + sx] = 1;
    while (queue.length) {
        const index = queue.shift();
        if (!mask[index]) return index;
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
                if (seen[neighborIndex]) continue;
                seen[neighborIndex] = 1;
                queue.push(neighborIndex);
            }
        }
    }
    return -1;
}

// Direct-center warp: the drawn stroke IS the center. d at every pixel is the
// true Euclidean coord-space distance to the nearest stroke pixel. Matches the
// CPPN's native d = sqrt(x*x + y*y) exactly when the stroke is a single pixel
// at the canvas midpoint — no octagonal / grid-metric artifacts a Dijkstra
// flood would introduce. Uses an exact 2D EDT (Felzenszwalb-Huttenlocher
// lower-envelope) with per-axis scaling hx=1/width, hy=1/height so distances
// come out in the CPPN's [-0.5, 0.5]^2 coord units.
function computeDirectCenterValues(mask, width, height) {
    const pixelCount = width * height;
    const values = new Float32Array(pixelCount);

    let seedCount = 0;
    for (let index = 0; index < pixelCount; index++) {
        if (mask[index]) seedCount++;
    }
    if (seedCount === 0) return values;

    return computeExactEuclideanDistanceField(mask, width, height, 1 / width, 1 / height);
}

// Exact 2D Euclidean distance transform. For each pixel, returns the
// Euclidean distance (in coord units) to the nearest pixel where mask != 0.
// Two 1D sweeps: column pass gives squared coord y-distance per column;
// row pass composes it into full squared 2D distance via lower envelope of
// parabolas with axis-weight a = hx^2.
function computeExactEuclideanDistanceField(mask, width, height, hx, hy) {
    const pixelCount = width * height;
    const INF = Number.POSITIVE_INFINITY;
    const hy2 = hy * hy;
    const hx2 = hx * hx;

    const g = new Float64Array(pixelCount);
    const colIn = new Float64Array(height);
    const colOut = new Float64Array(height);
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            colIn[y] = mask[y * width + x] ? 0 : INF;
        }
        edt1dWeighted(colIn, colOut, height, hy2);
        for (let y = 0; y < height; y++) {
            g[y * width + x] = colOut[y];
        }
    }

    const rowIn = new Float64Array(width);
    const rowOut = new Float64Array(width);
    const values = new Float32Array(pixelCount);
    for (let y = 0; y < height; y++) {
        const rowBase = y * width;
        for (let x = 0; x < width; x++) {
            rowIn[x] = g[rowBase + x];
        }
        edt1dWeighted(rowIn, rowOut, width, hx2);
        for (let x = 0; x < width; x++) {
            const dSq = rowOut[x];
            values[rowBase + x] = Number.isFinite(dSq) ? Math.sqrt(dSq) : 0;
        }
    }
    return values;
}

// 1D lower-envelope EDT (Felzenszwalb-Huttenlocher, 2004), generalized to
// weighted squared-distance parabolas f_p(q) = a*(q - p)^2 + fSrc[p].
// Positions with fSrc[p] = +Infinity are skipped (no parabola contributed).
// Writes out[q] = min_p f_p(q), or +Infinity if no finite source exists.
function edt1dWeighted(fSrc, out, n, a) {
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    let k = -1;
    z[0] = Number.NEGATIVE_INFINITY;

    for (let q = 0; q < n; q++) {
        const fq = fSrc[q];
        if (!Number.isFinite(fq)) continue;

        let pushed = false;
        while (k >= 0) {
            const p = v[k];
            const s = ((fq + a * q * q) - (fSrc[p] + a * p * p)) / (2 * a * (q - p));
            if (s > z[k]) {
                k++;
                v[k] = q;
                z[k] = s;
                z[k + 1] = Number.POSITIVE_INFINITY;
                pushed = true;
                break;
            }
            k--;
        }
        if (!pushed) {
            k = 0;
            v[0] = q;
            z[0] = Number.NEGATIVE_INFINITY;
            z[1] = Number.POSITIVE_INFINITY;
        }
    }

    if (k < 0) {
        for (let q = 0; q < n; q++) out[q] = Number.POSITIVE_INFINITY;
        return;
    }

    let ptr = 0;
    for (let q = 0; q < n; q++) {
        while (z[ptr + 1] < q) ptr++;
        const dq = q - v[ptr];
        out[q] = a * dq * dq + fSrc[v[ptr]];
    }
}

function computeWallClearanceField(mask, width, height) {
    const clearance = new Float64Array(width * height).fill(Infinity);

    for (let index = 0; index < clearance.length; index++) {
        if (mask[index]) {
            clearance[index] = 0;
            continue;
        }
        const px = index % width;
        const py = (index / width) | 0;
        if (px === 0 || py === 0 || px === width - 1 || py === height - 1) {
            clearance[index] = 0.5;
        }
    }

    runGridDijkstra(clearance, mask, width, height, false);
    return clearance;
}

function isClearancePeak(clearance, mask, width, height, index) {
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
    // ring order: E, NE, N, NW, W, SW, S, SE
    const ring = [
        at(1, 0), at(1, -1), at(0, -1), at(-1, -1),
        at(-1, 0), at(-1, 1), at(0, 1), at(1, 1)
    ];

    // Yokoi connectivity number for (8,4): removal keeps topology iff C === 1
    let connectivity = 0;
    for (const k of [0, 2, 4, 6]) {
        const a = 1 - ring[k];
        const b = 1 - ring[(k + 1) % 8];
        const c = 1 - ring[(k + 2) % 8];
        connectivity += a - a * b * c;
    }
    return connectivity === 1;
}

// Thin the free space down to a connected center ridge: clearance peaks are
// anchors, everything else is eroded (lowest clearance first) unless removal
// would break connectivity. Result: one continuous center per walled-off region.
function extractConnectedCenterRidge(clearance, mask, width, height) {
    const pixelCount = width * height;
    const remaining = new Uint8Array(pixelCount);
    const anchor = new Uint8Array(pixelCount);

    for (let index = 0; index < pixelCount; index++) {
        if (mask[index]) continue;
        remaining[index] = 1;
        if (isClearancePeak(clearance, mask, width, height, index)) {
            anchor[index] = 1;
        }
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
                    // no cutting through diagonal wall corners
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

function applyLoadedGenome(genome, label, options = {}) {
    DrawingState.genome = genome;
    DrawingState.loadedGenomeName = label || `Genome ${genome.id}`;
    setDrawingActionsEnabled(true);
    refreshPreviewStatus();
    queuePreviewRender();
    if (options.persist !== false) saveDrawingStateToSession();
}

function saveDrawingStateToSession() {
    if (!DrawingState.genome || typeof DrawingState.genome.serialize !== 'function') return;

    try {
        const payload = {
            format: 'cppn-drawing-state-v1',
            savedAt: new Date().toISOString(),
            label: DrawingState.loadedGenomeName,
            innovationState: window.NEAT && typeof window.NEAT.exportInnovationState === 'function'
                ? window.NEAT.exportInnovationState()
                : null,
            genome: DrawingState.genome.serialize(),
            strokes: DrawingState.lineStrokes,
            brushWidth: DrawingState.brushWidth,
            warpMode: DrawingState.warpMode,
            showDField: DrawingState.showDField,
            xExtent: DrawingState.xExtent,
            yExtent: DrawingState.yExtent,
            tExtent: DrawingState.tExtent
        };
        sessionStorage.setItem(DRAWING_STATE_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        // Ignore session persistence issues (private mode/quota, etc.).
    }
}

function restoreDrawingStateFromSession() {
    try {
        const raw = sessionStorage.getItem(DRAWING_STATE_STORAGE_KEY);
        if (!raw) return false;

        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.genome) return false;

        if (window.NEAT && typeof window.NEAT.resetInnovationState === 'function') {
            window.NEAT.resetInnovationState();
        }
        if (parsed.innovationState
            && window.NEAT
            && typeof window.NEAT.importInnovationState === 'function') {
            window.NEAT.importInnovationState(parsed.innovationState);
        }

        const genome = NEAT.Genome.deserialize(parsed.genome);

        DrawingState.lineStrokes = Array.isArray(parsed.strokes) ? parsed.strokes : [];
        DrawingState.activeLineStroke = null;
        if (Number.isFinite(parsed.brushWidth)) {
            DrawingState.brushWidth = Math.max(1, parsed.brushWidth);
            const slider = document.getElementById('distance-brush-slider');
            if (slider) slider.value = String(DrawingState.brushWidth);
        }
        if (parsed.warpMode === 'direct' || parsed.warpMode === 'shortest' || parsed.warpMode === 'ridge') {
            DrawingState.warpMode = parsed.warpMode;
            const toolSelect = document.getElementById('drawing-tool-select');
            if (toolSelect) toolSelect.value = DrawingState.warpMode;
        }
        if (typeof parsed.showDField === 'boolean') {
            DrawingState.showDField = parsed.showDField;
            const dFieldToggle = document.getElementById('drawing-show-d-field');
            if (dFieldToggle) dFieldToggle.checked = DrawingState.showDField;
        }
        restoreExtentField('xExtent', parsed.xExtent, 'drawing-x-extent');
        restoreExtentField('yExtent', parsed.yExtent, 'drawing-y-extent');
        restoreExtentField('tExtent', parsed.tExtent, 'drawing-t-extent');
        markDistanceFieldDirty();
        applyLoadedGenome(genome, parsed.label || `Genome ${genome.id}`, { persist: false });
        redrawDistanceLines();
        return true;
    } catch (error) {
        return false;
    }
}

function seedActivationLabFromDrawing() {
    if (!DrawingState.genome || typeof DrawingState.genome.serialize !== 'function') return;

    try {
        const payload = {
            format: 'cppn-activation-seed-v1',
            savedAt: new Date().toISOString(),
            label: DrawingState.loadedGenomeName || `Genome ${DrawingState.genome.id}`,
            innovationState: window.NEAT && typeof window.NEAT.exportInnovationState === 'function'
                ? window.NEAT.exportInnovationState()
                : null,
            genome: DrawingState.genome.serialize()
        };
        sessionStorage.setItem(LAB_SEED_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        // Ignore session persistence issues.
    }
}

function setDrawingActionsEnabled(hasGenome) {
    const enabled = Boolean(hasGenome);
    document.getElementById('save-genome-btn').disabled = !enabled;
    const downloadButton = document.getElementById('download-preview-btn');
    downloadButton.disabled = !enabled || DrawingState.exportInProgress;
    document.querySelectorAll('button[data-download-resolution]').forEach((button) => {
        button.disabled = !enabled || DrawingState.exportInProgress;
    });
    if (!enabled) closeDownloadResolutionMenu();
}

function toggleDownloadResolutionMenu(event) {
    if (event) event.preventDefault();
    const trigger = document.getElementById('download-preview-btn');
    if (!trigger || trigger.disabled || DrawingState.exportInProgress || !DrawingState.genome) return;

    const menu = document.getElementById('download-resolution-menu');
    if (!menu) return;
    const shouldOpen = menu.classList.contains('hidden');
    setDownloadResolutionMenuOpen(shouldOpen);
}

function setDownloadResolutionMenuOpen(isOpen) {
    const menu = document.getElementById('download-resolution-menu');
    const trigger = document.getElementById('download-preview-btn');
    if (!menu || !trigger) return;

    menu.classList.toggle('hidden', !isOpen);
    trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function closeDownloadResolutionMenu() {
    setDownloadResolutionMenuOpen(false);
}

function handleDownloadResolutionMenuClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const optionButton = target.closest('button[data-download-resolution]');
    if (!optionButton) return;
    event.preventDefault();

    const resolution = Number.parseInt(optionButton.dataset.downloadResolution || '', 10);
    if (!DRAWING_DOWNLOAD_RESOLUTION_OPTIONS.includes(resolution)) return;

    closeDownloadResolutionMenu();
    downloadPreviewImage(resolution);
}

function serializeGenomeForDrawing(genome) {
    if (!genome) return null;
    return {
        id: genome.id,
        historyId: genome.historyId,
        generation: genome.generation,
        parentHistoryIds: Array.isArray(genome.parentHistoryIds) ? [...genome.parentHistoryIds] : [],
        nextNodeId: genome.nextNodeId,
        nodes: genome.serializeNodes(),
        connections: genome.serializeConnections()
    };
}

function enforceDrawingWeightBounds() {
    if (!window.NEAT || !window.NEAT.CONFIG) return;
    window.NEAT.CONFIG.weightMin = DRAWING_WEIGHT_BOUNDS.min;
    window.NEAT.CONFIG.weightMax = DRAWING_WEIGHT_BOUNDS.max;
}

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

            applyLoadedGenome(loadResult.genome, loadResult.label || file.name);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid JSON';
            setPreviewStatus(`Could not load genome JSON: ${message}`);
        }
    };

    reader.onerror = () => {
        setPreviewStatus('Could not read that JSON file.');
    };

    reader.readAsText(file);
    event.target.value = '';
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
        return {
            genome: NEAT.Genome.deserialize(first),
            label: 'Genome 1 from genomes[]'
        };
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
        return {
            genome,
            label: payload.genome.id ? `Genome ${payload.genome.id}` : 'Loaded genome'
        };
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

function queuePreviewRender() {
    if (!DrawingState.genome) return;
    if (DrawingState.renderPending) return;

    DrawingState.renderPending = true;
    requestAnimationFrame(() => {
        DrawingState.renderPending = false;
        renderPreviewImage();
    });
}

function renderPreviewImage() {
    if (!DrawingState.previewCtx || !DrawingState.genome) return;
    renderCPPNPreview();
}

function renderCPPNPreview(onComplete = null) {
    if (!DrawingState.renderer || !DrawingState.previewCanvas || !DrawingState.genome) return;
    const distanceField = getDistanceFieldForResolution(DRAWING_DISTANCE_PREVIEW_RESOLUTION);
    // 'none': don't bake line pixels into the pattern — the difference-blend
    // overlay canvas shows them as the live-inverted color instead. Baking
    // them here too would double-invert wherever the overlay sits on top.
    DrawingState.animationStartTime = performance.now();
    DrawingState.renderer.renderProgressive(DrawingState.genome, DrawingState.previewCanvas, onComplete, {
        resolution: DRAWING_DISTANCE_PREVIEW_RESOLUTION,
        distanceField,
        distanceLineRendering: 'none',
        xExtent: DrawingState.xExtent,
        yExtent: DrawingState.yExtent,
        tExtent: DrawingState.tExtent
    });
    renderDistanceFieldOverlay(distanceField);
}

function renderDistanceFieldOverlay(precomputedField) {
    const canvas = DrawingState.dFieldCanvas;
    const ctx = DrawingState.dFieldCtx;
    if (!canvas || !ctx) return;

    if (!DrawingState.showDField) {
        canvas.hidden = true;
        return;
    }

    const size = DRAWING_DISTANCE_PREVIEW_RESOLUTION;
    const field = precomputedField !== undefined
        ? precomputedField
        : getDistanceFieldForResolution(size);

    // Show the overlay even without strokes so the user still sees the
    // Euclidean d the CPPN would consume.
    const gridW = field ? field.width : size;
    const gridH = field ? field.height : size;
    if (canvas.width !== gridW || canvas.height !== gridH) {
        canvas.width = gridW;
        canvas.height = gridH;
    }
    canvas.hidden = false;

    const xExtent = DrawingState.xExtent;
    const yExtent = DrawingState.yExtent;
    // buildDistanceFieldFromLines divides by grid width, so values are in
    // "fraction of grid" units. Scale by 2*xExtent to get CPPN-coord distances
    // that can be compared against the Euclidean fallback.
    const valueScale = 2 * xExtent;
    const maxNorm = Math.max(1e-6, Math.hypot(xExtent, yExtent));

    const image = ctx.createImageData(gridW, gridH);
    const data = image.data;
    const ridgeMode = DrawingState.warpMode !== 'shortest';
    const values = field ? field.values : null;
    const mask = field ? field.mask : null;

    const ridgeCutoff = 0.02 * maxNorm;
    const detourCutoff = 0.02 * maxNorm;

    for (let py = 0; py < gridH; py++) {
        const yCoord = ((py + 0.5) / gridH - 0.5) * 2 * yExtent;
        for (let px = 0; px < gridW; px++) {
            const xCoord = ((px + 0.5) / gridW - 0.5) * 2 * xExtent;
            const euclid = Math.hypot(xCoord, yCoord);
            const idx = py * gridW + px;
            const d = values ? values[idx] * valueScale : euclid;
            const outIdx = idx * 4;

            if (mask && mask[idx]) {
                data[outIdx] = 0;
                data[outIdx + 1] = 0;
                data[outIdx + 2] = 0;
                data[outIdx + 3] = 0;
                continue;
            }

            const [rBase, gBase, bBase] = distanceFieldColor(d / maxNorm);
            let r = rBase, g = gBase, b = bBase;

            if (ridgeMode && Number.isFinite(d) && d <= ridgeCutoff) {
                r = 255; g = 50; b = 60;
            } else if (!ridgeMode && Number.isFinite(d) && d > euclid + detourCutoff) {
                const strength = Math.min(1, (d - euclid) / (0.5 * maxNorm));
                r = Math.round(r * (1 - strength) + 255 * strength);
                g = Math.round(g * (1 - strength) + 60 * strength);
                b = Math.round(b * (1 - strength) + 200 * strength);
            }

            data[outIdx] = r;
            data[outIdx + 1] = g;
            data[outIdx + 2] = b;
            data[outIdx + 3] = 255;
        }
    }

    if (!ridgeMode) {
        const cx = Math.floor(gridW / 2);
        const cy = Math.floor(gridH / 2);
        const radius = Math.max(1, Math.round(gridW / 90));
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx * dx + dy * dy > radius * radius) continue;
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
                const outIdx = (ny * gridW + nx) * 4;
                data[outIdx] = 255;
                data[outIdx + 1] = 50;
                data[outIdx + 2] = 60;
                data[outIdx + 3] = 255;
            }
        }
    }

    ctx.putImageData(image, 0, 0);
}

// Smooth colormap for normalized d. 0..1 sweeps deep blue -> teal -> yellow;
// >1 pushes into orange/red so detour distances stand out.
function distanceFieldColor(normalized) {
    if (!Number.isFinite(normalized)) return [30, 30, 36];
    if (normalized <= 1) {
        const stops = [
            [0.00, 30, 20, 90],
            [0.30, 40, 100, 175],
            [0.60, 60, 175, 165],
            [0.85, 180, 210, 100],
            [1.00, 250, 235, 90]
        ];
        return interpolateColormap(stops, normalized, [250, 235, 90]);
    }
    const excess = Math.min(1, normalized - 1);
    const stops = [
        [0.0, 250, 200, 90],
        [0.5, 240, 120, 90],
        [1.0, 200, 60, 90]
    ];
    return interpolateColormap(stops, excess, [200, 60, 90]);
}

function interpolateColormap(stops, position, fallback) {
    for (let i = 1; i < stops.length; i++) {
        if (position <= stops[i][0]) {
            const [a0, ar, ag, ab] = stops[i - 1];
            const [b0, br, bg, bb] = stops[i];
            const t = (position - a0) / (b0 - a0);
            return [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t];
        }
    }
    return fallback;
}

// Populate the (x, y, d) readout for the pixel under the cursor. x/y are in
// CPPN coord space (matching the network's inputs); d is read from the same
// distance field the renderer consumes, or the Euclidean fallback the CPPN
// uses when no strokes exist.
function handlePixelInspectorMove(event) {
    const canvas = DrawingState.lineCanvas;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const imgX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const imgY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const xExtent = DrawingState.xExtent;
    const yExtent = DrawingState.yExtent;
    const xCoord = (imgX - 0.5) * 2 * xExtent;
    const yCoord = (imgY - 0.5) * 2 * yExtent;

    const field = getDistanceFieldForResolution(DRAWING_DISTANCE_PREVIEW_RESOLUTION);
    let dValue;
    if (field && field.values) {
        const px = Math.max(0, Math.min(field.width - 1, Math.floor(imgX * field.width)));
        const py = Math.max(0, Math.min(field.height - 1, Math.floor(imgY * field.height)));
        const raw = field.values[py * field.width + px];
        // field.values are normalized by grid width; rescale into CPPN coord
        // units so the readout matches what the network sees.
        dValue = Number.isFinite(raw) ? raw * 2 * xExtent : 0;
    } else {
        dValue = Math.hypot(xCoord, yCoord);
    }

    writePixelInspector(xCoord, yCoord, dValue);
}

function writePixelInspector(x, y, d) {
    const xEl = document.getElementById('pi-x');
    const yEl = document.getElementById('pi-y');
    const dEl = document.getElementById('pi-d');
    if (xEl) xEl.textContent = x === null ? '—' : formatInspectorNumber(x);
    if (yEl) yEl.textContent = y === null ? '—' : formatInspectorNumber(y);
    if (dEl) dEl.textContent = d === null ? '—' : formatInspectorNumber(d);
}

function hidePixelInspector() {
    writePixelInspector(null, null, null);
}

function formatInspectorNumber(value) {
    if (!Number.isFinite(value)) return '—';
    const sign = value < 0 ? '-' : ' ';
    return sign + Math.abs(value).toFixed(3);
}

// Mirrors the tInput formula in renderFrameToImageData so the readout matches
// exactly what the CPPN sees on the frame currently on screen.
function currentAnimationTInput() {
    if (!DrawingState.genome || DrawingState.animationStartTime === null) return null;
    const cfg = window.CPPN && window.CPPN.GIF_CONFIG;
    const frameCount = cfg && Number.isFinite(cfg.frameCount) ? cfg.frameCount : 45;
    const frameRate = cfg && Number.isFinite(cfg.frameRate) ? cfg.frameRate : 15;
    const frameDurationMs = 1000 / Math.max(1, frameRate);
    const elapsed = performance.now() - DrawingState.animationStartTime;
    const frameIndex = ((Math.floor(elapsed / frameDurationMs) % frameCount) + frameCount) % frameCount;
    const frameFraction = frameIndex / Math.max(frameCount - 1, 1);
    return 0.5 + (frameFraction - 0.5) * 2 * DrawingState.tExtent;
}

function tickPixelInspectorT() {
    const tEl = document.getElementById('pi-t');
    if (tEl) {
        const t = currentAnimationTInput();
        tEl.textContent = t === null ? '—' : formatInspectorNumber(t);
    }
    requestAnimationFrame(tickPixelInspectorT);
}

function setDistanceLoadingVisible(isVisible) {
    const overlay = document.getElementById('distance-loading-overlay');
    if (overlay) overlay.hidden = !isVisible;
}

function runDistanceFieldUpdate() {
    if (!DrawingState.genome || !DrawingState.renderer) return;

    setDistanceLoadingVisible(true);
    // double rAF + timeout lets the overlay paint before the synchronous
    // distance-field build and first-frame render block the main thread
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            setTimeout(() => {
                try {
                    renderCPPNPreview(() => setDistanceLoadingVisible(false));
                } catch (error) {
                    setDistanceLoadingVisible(false);
                    throw error;
                }
            }, 0);
        });
    });
}

async function downloadPreviewImage(resolution = DRAWING_DOWNLOAD_GIF_RESOLUTION) {
    if (!DrawingState.genome) return;

    const button = document.getElementById('download-preview-btn');
    const originalText = button ? button.textContent : '';
    const exportResolution = DRAWING_DOWNLOAD_RESOLUTION_OPTIONS.includes(resolution)
        ? resolution
        : DRAWING_DOWNLOAD_GIF_RESOLUTION;

    DrawingState.exportInProgress = true;
    setDrawingActionsEnabled(true);
    closeDownloadResolutionMenu();
    if (button) {
        button.textContent = `Encoding GIF (${exportResolution})...`;
    }

    try {
        const serializedGenome = serializeGenomeForDrawing(DrawingState.genome);
        if (!serializedGenome) {
            throw new Error('No genome available for export.');
        }

        const outputModeManager = getOutputColorModeManager();
        const frameRate = window.CPPN && window.CPPN.GIF_CONFIG && Number.isFinite(window.CPPN.GIF_CONFIG.frameRate)
            ? window.CPPN.GIF_CONFIG.frameRate
            : 15;
        const frameCount = window.CPPN && window.CPPN.GIF_CONFIG && Number.isFinite(window.CPPN.GIF_CONFIG.frameCount)
            ? window.CPPN.GIF_CONFIG.frameCount
            : 45;
        const frameDurationMs = 1000 / Math.max(1, frameRate);

        let blob;
        try {
            const distanceField = getDistanceFieldForResolution(exportResolution);
            blob = await createGifBlobViaWorker(
                serializedGenome,
                {
                    resolution: exportResolution,
                    frameCount,
                    frameDurationMs,
                    outputColorMode: outputModeManager ? outputModeManager.getMode() : 'hsv',
                    distanceField,
                    distanceLineRendering: 'invert',
                    xExtent: DrawingState.xExtent,
                    yExtent: DrawingState.yExtent,
                    tExtent: DrawingState.tExtent
                },
                (progress) => {
                    if (!button) return;
                    if (!progress || !Number.isInteger(progress.completedFrames) || !Number.isInteger(progress.totalFrames)) {
                        button.textContent = `Encoding GIF (${exportResolution})...`;
                        return;
                    }
                    button.textContent = `Encoding GIF (${exportResolution})... ${progress.completedFrames}/${progress.totalFrames}`;
                }
            );
        } catch (workerError) {
            blob = DrawingState.renderer.createGifBlob(DrawingState.genome, {
                resolution: exportResolution,
                distanceField: getDistanceFieldForResolution(exportResolution),
                distanceLineRendering: 'invert',
                xExtent: DrawingState.xExtent,
                yExtent: DrawingState.yExtent,
                tExtent: DrawingState.tExtent
            });
        }

        const genomeId = typeof DrawingState.genome.id === 'string' && DrawingState.genome.id
            ? DrawingState.genome.id
            : 'output';
        await saveBlobToVersionSubdirectory(
            blob,
            `drawing-output-${genomeId}.gif`,
            DRAWING_EXPRESSIONS_DIR
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown GIF export error';
        setPreviewStatus(`Could not export GIF: ${message}`);
    } finally {
        DrawingState.exportInProgress = false;
        setDrawingActionsEnabled(Boolean(DrawingState.genome));
        if (button) {
            button.textContent = originalText || 'Download GIF';
        }
    }
}

function createGifBlobViaWorker(genome, options, onProgress) {
    return new Promise((resolve, reject) => {
        if (typeof Worker === 'undefined') {
            reject(new Error('Web Workers are not supported in this browser.'));
            return;
        }

        let settled = false;
        let worker;

        const cleanup = () => {
            if (worker) {
                worker.terminate();
                worker = null;
            }
        };

        const fail = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };

        try {
            worker = new Worker(DRAWING_GIF_EXPORT_WORKER_PATH);
        } catch (error) {
            fail(error instanceof Error ? error : new Error('Could not create GIF export worker.'));
            return;
        }

        worker.onmessage = (event) => {
            const data = event.data || {};
            if (data.type === 'progress') {
                if (typeof onProgress === 'function') onProgress(data);
                return;
            }

            if (data.type === 'success') {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(new Blob([data.bytes], { type: 'image/gif' }));
                return;
            }

            if (data.type === 'error') {
                const message = typeof data.message === 'string' ? data.message : 'Worker export failed.';
                fail(new Error(message));
            }
        };

        worker.onerror = () => {
            fail(new Error('Worker crashed while exporting GIF.'));
        };

        worker.postMessage({
            type: 'export-gif',
            genome,
            options
        });
    });
}

async function downloadDrawingGenomeJson() {
    if (!DrawingState.genome) return;

    const exported = typeof DrawingState.genome.exportWithLineage === 'function'
        ? DrawingState.genome.exportWithLineage()
        : null;
    if (!exported || !exported.genome) return;

    const payload = {
        format: 'cppn-activation-lab-genome-v2',
        savedAt: new Date().toISOString(),
        label: DrawingState.loadedGenomeName || `Genome ${DrawingState.genome.id}`,
        innovationState: exported.innovationState,
        genome: exported.genome,
        lineage: exported.lineage
    };

    const genomeId = typeof DrawingState.genome.id === 'string' && DrawingState.genome.id
        ? DrawingState.genome.id
        : 'edited';
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    await saveBlobToVersionSubdirectory(
        blob,
        `drawing-genome-${genomeId}.json`,
        DRAWING_ARCHIVE_DIR
    );
}

// The old on-screen status line was replaced by the pixel-inspector under the
// preview. Route the (rare) status texts to the console so errors are still
// discoverable in devtools without eating layout space.
function setPreviewStatus(text) {
    if (text) console.warn('[drawing]', text);
}

function refreshPreviewStatus() {}

function setGalleryStatus(text) {
    const container = document.getElementById('gallery-status');
    if (!container) return;

    container.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    container.appendChild(p);
}

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
    if (withoutLeadingDot.startsWith(`${DRAWING_GALLERY_DIR}/`)) {
        return withoutLeadingDot;
    }

    return `${DRAWING_GALLERY_DIR}/${withoutLeadingDot}`;
}

async function getGalleryGenomeFiles() {
    const fromManifest = await loadGalleryManifestFiles();
    if (fromManifest.length > 0) return fromManifest;
    return loadGalleryFilesFromDirectoryListing();
}

async function loadGalleryManifestFiles() {
    try {
        const response = await fetch(DRAWING_GALLERY_MANIFEST_PATH, { cache: 'no-store' });
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
        const response = await fetch(`${DRAWING_GALLERY_DIR}/`, { cache: 'no-store' });
        if (!response.ok) return [];

        const html = await response.text();
        const matches = html.matchAll(/href="([^"]+\.json)"/gi);
        const files = [];

        for (const match of matches) {
            const href = match[1];
            if (!href) continue;

            let resolvedPath = href;
            try {
                const url = new URL(href, new URL(`${DRAWING_GALLERY_DIR}/`, window.location.href));
                resolvedPath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
                resolvedPath = decodeURIComponent(resolvedPath);
            } catch (error) {
                resolvedPath = href;
            }

            const galleryIndex = resolvedPath.lastIndexOf(`${DRAWING_GALLERY_DIR}/`);
            if (galleryIndex >= 0) resolvedPath = resolvedPath.slice(galleryIndex);

            const normalized = normalizeGalleryPath(resolvedPath);
            if (isGenomeJsonPath(normalized)) files.push(normalized);
        }

        return Array.from(new Set(files));
    } catch (error) {
        return [];
    }
}

async function initGalleryPanel(options = {}) {
    const skipAutoSelect = Boolean(options.skipAutoSelect);
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;

    const files = await getGalleryGenomeFiles();
    files.sort();

    if (!files.length) {
        setGalleryStatus(`No genome JSON found in ${DRAWING_GALLERY_DIR}/`);
        if (!skipAutoSelect) {
            setPreviewStatus('No gallery genomes found | upload a genome JSON to start');
        }
        return;
    }

    grid.innerHTML = '';
    let loadedCount = 0;
    let hasSelectedFirst = skipAutoSelect;

    // Genomes load sequentially: the first loadable one is shown immediately
    // in the main preview, the rest fill in behind it. Each tile keeps its
    // parsed payload in closure, so clicks never refetch.
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

            DrawingState.renderer.renderProgressive(loadResult.genome, canvas, null, {
                resolution: DRAWING_GALLERY_TILE_RESOLUTION
            });

            tile.addEventListener('click', () => selectGalleryGenome(payload, fileName, tile));
            loadedCount++;

            if (!hasSelectedFirst) {
                hasSelectedFirst = true;
                selectGalleryGenome(payload, fileName, tile);
            }
        } catch (error) {
            console.warn(`Skipping gallery genome ${filePath}:`, error);
        }
    }

    setGalleryStatus(loadedCount
        ? `${loadedCount} genome${loadedCount === 1 ? '' : 's'} | click to load at ${DRAWING_DISTANCE_PREVIEW_RESOLUTION}`
        : `No loadable genomes in ${DRAWING_GALLERY_DIR}/`);

    if (!loadedCount && !skipAutoSelect) {
        setPreviewStatus('No gallery genomes found | upload a genome JSON to start');
    }
}

function selectGalleryGenome(payload, fileName, tile) {
    try {
        if (window.NEAT && typeof window.NEAT.resetInnovationState === 'function') {
            window.NEAT.resetInnovationState();
        }
        const loadResult = parseGenomePayload(payload);
        applyLoadedGenome(loadResult.genome, fileName);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid genome';
        setPreviewStatus(`Could not load ${fileName}: ${message}`);
        return;
    }

    document.querySelectorAll('.gallery-tile.is-active').forEach((el) => el.classList.remove('is-active'));
    tile.classList.add('is-active');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDrawingPage);
} else {
    initDrawingPage();
}
