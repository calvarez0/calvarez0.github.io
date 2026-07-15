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
    isDistanceDrawEnabled: true,
    brushWidth: 8,
    distanceFieldCache: null,
    distanceFieldDirty: true,
    renderPending: false,
    exportInProgress: false,
    loadedGenomeName: 'No genome loaded'
};
const DRAWING_ARCHIVE_DIR = 'archive';
const DRAWING_EXPRESSIONS_DIR = 'expressions';
const DRAWING_WEIGHT_BOUNDS = { min: -8, max: 8 };
const DRAWING_DOWNLOAD_GIF_RESOLUTION = 512;
const DRAWING_GIF_EXPORT_WORKER_PATH = 'gif-export-worker.js';
const DRAWING_DOWNLOAD_RESOLUTION_OPTIONS = [64, 128, 512, 1024];
const DRAWING_DISTANCE_PREVIEW_RESOLUTION = 256;
// Brush widths are specified in 512-space so stroke thickness relative to
// the image stays the same at any preview/export resolution.
const DRAWING_DISTANCE_REFERENCE_RESOLUTION = 512;
const DRAWING_DISTANCE_LINE_ALPHA_THRESHOLD = 8;
const DRAWING_GALLERY_DIR = 'limbomorphs';
const DRAWING_GALLERY_MANIFEST_PATH = `${DRAWING_GALLERY_DIR}/manifest.json`;
const DRAWING_GALLERY_TILE_RESOLUTION = 32;
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

async function saveBlobToVersionSubdirectory(blob, fileName, subdirectoryName) {
    if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
        try {
            if (!DrawingProjectSaveRootHandle) {
                DrawingProjectSaveRootHandle = await window.showDirectoryPicker({
                    id: 'gifbreeder-save-root',
                    mode: 'readwrite'
                });
            }

            const targetDirectory = await getNestedDirectoryHandle(
                DrawingProjectSaveRootHandle,
                getTargetSaveDirectorySegments(subdirectoryName)
            );
            const fileHandle = await targetDirectory.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return true;
        } catch (error) {
            if (error && error.name === 'AbortError') return false;
            console.warn('Falling back to browser download:', error);
        }
    }

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
    initGalleryPanel();
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
}

function setupDistanceDrawingEvents() {
    const lineCanvas = DrawingState.lineCanvas;
    if (!lineCanvas) return;

    const toggleButton = document.getElementById('distance-draw-toggle-btn');
    const clearButton = document.getElementById('distance-clear-btn');
    const brushSlider = document.getElementById('distance-brush-slider');

    if (toggleButton) {
        toggleButton.addEventListener('click', () => {
            DrawingState.isDistanceDrawEnabled = !DrawingState.isDistanceDrawEnabled;
            toggleButton.classList.toggle('is-active', DrawingState.isDistanceDrawEnabled);
            lineCanvas.style.pointerEvents = DrawingState.isDistanceDrawEnabled ? 'auto' : 'none';
        });
    }

    if (clearButton) {
        clearButton.addEventListener('click', () => {
            DrawingState.lineStrokes = [];
            DrawingState.activeLineStroke = null;
            markDistanceFieldDirty();
            redrawDistanceLines();
            runDistanceFieldUpdate();
        });
    }

    if (brushSlider) {
        brushSlider.addEventListener('input', (event) => {
            const nextWidth = Number.parseFloat(event.target.value);
            if (Number.isFinite(nextWidth)) {
                DrawingState.brushWidth = Math.max(1, nextWidth);
            }
        });
    }

    lineCanvas.addEventListener('pointerdown', handleDistancePointerDown);
    lineCanvas.addEventListener('pointermove', handleDistancePointerMove);
    lineCanvas.addEventListener('pointerup', handleDistancePointerUp);
    lineCanvas.addEventListener('pointercancel', handleDistancePointerUp);
    lineCanvas.addEventListener('lostpointercapture', handleDistancePointerUp);
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
    if (!DrawingState.isDistanceDrawEnabled) return;
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

    // Walls = drawn strokes + image border. The "center" of each walled-off
    // region is a connected ridge: clearance peaks anchored together by
    // topology-preserving thinning. d = geodesic distance from that ridge,
    // so walls truly divide the pattern even when strokes only partially
    // cross the image.
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

    return {
        width,
        height,
        values,
        mask
    };
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

function applyLoadedGenome(genome, label) {
    DrawingState.genome = genome;
    DrawingState.loadedGenomeName = label || `Genome ${genome.id}`;
    setDrawingActionsEnabled(true);
    refreshPreviewStatus();
    queuePreviewRender();
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
    DrawingState.renderer.renderProgressive(DrawingState.genome, DrawingState.previewCanvas, onComplete, {
        resolution: DRAWING_DISTANCE_PREVIEW_RESOLUTION,
        distanceField
    });
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
                    distanceField
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
                distanceField: getDistanceFieldForResolution(exportResolution)
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

function setPreviewStatus(text) {
    const container = document.getElementById('preview-status');
    container.innerHTML = '';

    const p = document.createElement('p');
    p.textContent = text;
    container.appendChild(p);
}

function refreshPreviewStatus() {
    const genomeText = DrawingState.loadedGenomeName || 'No genome loaded';
    const size = DRAWING_DISTANCE_PREVIEW_RESOLUTION;
    setPreviewStatus(`${genomeText} | Preview: ${size} x ${size} | d follows drawn line regions`);
}

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

async function initGalleryPanel() {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;

    const files = await getGalleryGenomeFiles();
    files.sort();

    if (!files.length) {
        setGalleryStatus(`No genome JSON found in ${DRAWING_GALLERY_DIR}/`);
        setPreviewStatus('No gallery genomes found | upload a genome JSON to start');
        return;
    }

    grid.innerHTML = '';
    let loadedCount = 0;
    let hasSelectedFirst = false;

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

    if (!loadedCount) {
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
