/**
 * Activation Lab page:
 * Upload genome JSON, edit CPPN connection activations, and preview changes live.
 */

const LabState = {
    genome: null,
    visualizer: null,
    renderer: null,
    previewCanvas: null,
    previewCtx: null,
    originalGenomeSnapshot: null,
    selectedConnectionIndex: null,
    renderPending: false,
    exportInProgress: false,
    loadedGenomeName: 'No genome loaded'
};
const LAB_SEED_STORAGE_KEY = 'cppn-activation-seed-v1';
const LAB_ARCHIVE_DIR = 'archive';
const LAB_ARCHIVE_MANIFEST_PATH = `${LAB_ARCHIVE_DIR}/manifest.json`;
const LAB_WEIGHT_BOUNDS = { min: -8, max: 8 };
const LAB_DOWNLOAD_GIF_RESOLUTION = 512;
const LAB_GIF_EXPORT_WORKER_PATH = 'gif-export-worker.js';
const LAB_DOWNLOAD_RESOLUTION_OPTIONS = [64, 128, 512, 1024];

function getOutputColorModeManager() {
    return window.CPPN && window.CPPN.OutputColorModeManager
        ? window.CPPN.OutputColorModeManager
        : null;
}

function syncOutputModeUI() {
    const manager = getOutputColorModeManager();
    const mode = manager ? manager.getMode() : 'hsv';

    document.querySelectorAll('button[data-output-mode]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.outputMode === mode);
    });
}

function initActivationLab() {
    const networkSvg = document.getElementById('editor-network-svg');
    const previewCanvas = document.getElementById('preview-canvas');
    if (!networkSvg || !previewCanvas) return;

    enforceLabWeightBounds();
    LabState.previewCanvas = previewCanvas;
    LabState.previewCtx = previewCanvas.getContext('2d', { willReadFrequently: true });

    LabState.visualizer = new CPPN.NetworkVisualizer(networkSvg, {
        interactive: true,
        onConnectionSelected: handleConnectionSelection,
        onConnectionWeightChanged: handleConnectionWeightChange
    });
    LabState.renderer = new CPPN.CPPNRenderer();

    setupActivationLabEvents();
    const outputModeManager = getOutputColorModeManager();
    if (outputModeManager) {
        outputModeManager.setMode('hsv', { reason: 'startup' });
    }
    syncOutputModeUI();
    setLabActionsEnabled(false);
    if (!loadSeedGenomeFromSession()) {
        randomizeNetwork();
    }
}

function setupActivationLabEvents() {
    document.getElementById('genome-upload-input').addEventListener('change', handleGenomeUpload);
    document.getElementById('randomize-network-btn').addEventListener('click', randomizeNetwork);
    document.getElementById('reset-connection-btn').addEventListener('click', resetSelectedConnectionToOriginal);
    document.getElementById('network-zoom-in-btn').addEventListener('click', () => LabState.visualizer.zoomIn());
    document.getElementById('network-zoom-out-btn').addEventListener('click', () => LabState.visualizer.zoomOut());
    document.getElementById('network-reset-view-btn').addEventListener('click', () => LabState.visualizer.resetView());
    document.getElementById('save-lab-genome-btn').addEventListener('click', downloadLabGenomeJson);
    document.getElementById('download-preview-btn').addEventListener('click', toggleDownloadResolutionMenu);
    document.getElementById('download-resolution-menu').addEventListener('click', handleDownloadResolutionMenuClick);
    document.getElementById('connection-picker').addEventListener('click', handleConnectionPickerClick);
    document.querySelector('.lab-controls').addEventListener('click', handleLabOutputModeButtonClick);
    window.addEventListener('cppn-output-mode-change', handleLabOutputModeChange);

    document.querySelector('.connection-buttons').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-delta]');
        if (!button) return;

        const delta = Number.parseFloat(button.dataset.delta);
        if (!Number.isFinite(delta)) return;
        nudgeSelectedConnection(delta);
    });

    document.getElementById('connection-value-input').addEventListener('input', (event) => {
        const nextValue = Number.parseFloat(event.target.value);
        if (!Number.isFinite(nextValue)) return;
        setSelectedConnectionValue(nextValue);
    });

    document.getElementById('connection-value-slider').addEventListener('input', (event) => {
        const nextValue = Number.parseFloat(event.target.value);
        if (!Number.isFinite(nextValue)) return;
        setSelectedConnectionValue(nextValue);
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === '[') {
            nudgeSelectedConnection(-0.05);
        } else if (event.key === ']') {
            nudgeSelectedConnection(0.05);
        }
    });

    window.addEventListener('resize', () => {
        if (!LabState.genome) return;
        renderNetwork({ preserveView: true, preserveSelection: true });
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

function handleLabOutputModeButtonClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('button[data-output-mode]');
    if (!button) return;

    const manager = getOutputColorModeManager();
    if (!manager) return;

    manager.setMode(button.dataset.outputMode, { reason: 'display' });
}

function handleLabOutputModeChange() {
    syncOutputModeUI();
    if (!LabState.genome) return;
    renderNetwork({ preserveView: true, preserveSelection: true });
    queuePreviewRender();
}

async function randomizeNetwork() {
    const randomizeButton = document.getElementById('randomize-network-btn');
    if (randomizeButton) randomizeButton.disabled = true;

    try {
        const genome = NEAT.Genome.createRandomizedInitial(NEAT.CONFIG.initialHiddenNodesMax);
        genome.id = Math.random().toString(36).substr(2, 9);
        genome.setAsInitial(1);
        applyLoadedGenome(genome, `Random genome ${genome.id}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown randomization error';
        setPreviewStatus(`Could not create a fresh random genome: ${message}`);
    } finally {
        if (randomizeButton) randomizeButton.disabled = false;
    }
}

function applyLoadedGenome(genome, label) {
    LabState.genome = genome;
    LabState.loadedGenomeName = label || `Genome ${genome.id}`;
    LabState.originalGenomeSnapshot = serializeGenomeForLab(genome);
    renderNetwork();
    clearConnectionEditor();
    setLabActionsEnabled(true);
    refreshPreviewStatus();
    queuePreviewRender();
}

function setLabActionsEnabled(hasGenome) {
    const enabled = Boolean(hasGenome);
    document.getElementById('save-lab-genome-btn').disabled = !enabled;
    const downloadButton = document.getElementById('download-preview-btn');
    downloadButton.disabled = !enabled || LabState.exportInProgress;
    document.querySelectorAll('button[data-download-resolution]').forEach((button) => {
        button.disabled = !enabled || LabState.exportInProgress;
    });
    if (!enabled) closeDownloadResolutionMenu();
    if (!enabled) {
        document.getElementById('reset-connection-btn').disabled = true;
    }
}

function toggleDownloadResolutionMenu(event) {
    if (event) event.preventDefault();
    const trigger = document.getElementById('download-preview-btn');
    if (!trigger || trigger.disabled || LabState.exportInProgress || !LabState.genome) return;

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
    if (!LAB_DOWNLOAD_RESOLUTION_OPTIONS.includes(resolution)) return;

    closeDownloadResolutionMenu();
    downloadPreviewImage(resolution);
}

function serializeGenomeForLab(genome) {
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

function resetSelectedConnectionToOriginal() {
    if (!LabState.genome || !LabState.originalGenomeSnapshot || !LabState.visualizer) return;

    const selectedIndex = LabState.visualizer.selectedConnectionIndex;
    if (!Number.isInteger(selectedIndex)) return;

    const originalConnections = Array.isArray(LabState.originalGenomeSnapshot.connections)
        ? LabState.originalGenomeSnapshot.connections
        : [];
    const originalConn = originalConnections[selectedIndex];
    if (!originalConn || !Number.isFinite(originalConn.weight)) return;

    const conn = LabState.visualizer.setConnectionWeight(selectedIndex, originalConn.weight);
    if (!conn) return;

    populateConnectionEditor(conn, selectedIndex);
    queuePreviewRender();
}

function updateResetConnectionButtonState(selectedIndex) {
    const resetButton = document.getElementById('reset-connection-btn');
    if (!resetButton) return;

    if (!Number.isInteger(selectedIndex)) {
        resetButton.disabled = true;
        return;
    }

    const originalConnections = LabState.originalGenomeSnapshot && Array.isArray(LabState.originalGenomeSnapshot.connections)
        ? LabState.originalGenomeSnapshot.connections
        : [];
    const originalConn = originalConnections[selectedIndex];
    resetButton.disabled = !(originalConn && Number.isFinite(originalConn.weight));
}

async function getArchiveGenomeFiles() {
    const fromManifest = await loadArchiveManifestFiles();
    if (fromManifest.length > 0) return fromManifest;
    return loadArchiveFilesFromDirectoryListing();
}

async function loadArchiveManifestFiles() {
    try {
        const response = await fetch(LAB_ARCHIVE_MANIFEST_PATH, { cache: 'no-store' });
        if (!response.ok) return [];

        const manifest = await response.json();
        if (!manifest || !Array.isArray(manifest.files)) return [];

        const files = manifest.files
            .map((name) => normalizeArchivePath(name))
            .filter((path) => isGenomeArchivePath(path));

        return Array.from(new Set(files));
    } catch (error) {
        return [];
    }
}

async function loadArchiveFilesFromDirectoryListing() {
    try {
        const response = await fetch(`${LAB_ARCHIVE_DIR}/`, { cache: 'no-store' });
        if (!response.ok) return [];

        const html = await response.text();
        const matches = html.matchAll(/href="([^"]+\.json)"/gi);
        const files = [];

        for (const match of matches) {
            const href = match[1];
            if (!href) continue;

            let resolvedPath = href;
            try {
                const url = new URL(href, window.location.href);
                resolvedPath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
            } catch (error) {
                resolvedPath = href;
            }

            const normalized = normalizeArchivePath(resolvedPath);
            if (isGenomeArchivePath(normalized)) files.push(normalized);
        }

        return Array.from(new Set(files));
    } catch (error) {
        return [];
    }
}

function normalizeArchivePath(path) {
    if (typeof path !== 'string') return null;
    const trimmed = path.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;

    const withoutLeadingDot = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
    if (withoutLeadingDot.startsWith(`${LAB_ARCHIVE_DIR}/`)) {
        return withoutLeadingDot;
    }

    return `${LAB_ARCHIVE_DIR}/${withoutLeadingDot}`;
}

function toFetchUrl(path) {
    if (typeof path !== 'string') return path;
    if (/^https?:\/\//i.test(path)) return path;
    return encodeURI(path);
}

function isGenomeArchivePath(path) {
    if (typeof path !== 'string') return false;
    const lowered = path.toLowerCase();
    if (!lowered.endsWith('.json')) return false;
    return !lowered.endsWith('/manifest.json') && lowered !== 'manifest.json';
}

function loadSeedGenomeFromSession() {
    try {
        const raw = sessionStorage.getItem(LAB_SEED_STORAGE_KEY);
        if (!raw) return false;

        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.genome) return false;

        const genome = NEAT.Genome.deserialize(parsed.genome);
        const label = typeof parsed.label === 'string'
            ? parsed.label
            : `Genome ${genome.id}`;
        applyLoadedGenome(genome, label);
        return true;
    } catch (error) {
        return false;
    }
}

function renderNetwork(options = {}) {
    if (!LabState.genome || !LabState.visualizer) return;

    LabState.visualizer.visualize(LabState.genome, options);
    const selectedIndex = LabState.visualizer.selectedConnectionIndex;
    LabState.selectedConnectionIndex = selectedIndex;
    renderConnectionPicker();
    if (selectedIndex === null) {
        clearConnectionEditor();
        return;
    }

    const conn = LabState.genome.connections[selectedIndex];
    if (!conn) {
        clearConnectionEditor();
        return;
    }

    populateConnectionEditor(conn, selectedIndex);
}

function handleConnectionSelection(conn, connectionIndex) {
    LabState.selectedConnectionIndex = connectionIndex;

    if (!conn || connectionIndex === null) {
        clearConnectionEditor();
        return;
    }

    populateConnectionEditor(conn, connectionIndex);
}

function handleConnectionWeightChange(conn, connectionIndex) {
    if (connectionIndex !== LabState.selectedConnectionIndex || !conn) return;
    populateConnectionEditor(conn, connectionIndex);
}

function populateConnectionEditor(conn, connectionIndex) {
    LabState.selectedConnectionIndex = connectionIndex;
    const placeholder = document.getElementById('connection-placeholder');
    const controls = document.getElementById('connection-controls');
    const nameEl = document.getElementById('connection-name');
    const valueInput = document.getElementById('connection-value-input');
    const valueSlider = document.getElementById('connection-value-slider');
    const bounds = getWeightBounds();

    const fromNode = LabState.genome.nodes.get(conn.fromId);
    const toNode = LabState.genome.nodes.get(conn.toId);
    const fromLabel = formatNodeLabel(fromNode);
    const toLabel = formatNodeLabel(toNode);

    placeholder.classList.add('hidden');
    controls.classList.remove('hidden');
    nameEl.textContent = `${fromLabel} -> ${toLabel} (#${connectionIndex})`;

    valueInput.min = String(bounds.min);
    valueInput.max = String(bounds.max);
    valueInput.value = conn.weight.toFixed(3);
    valueSlider.min = String(bounds.min);
    valueSlider.max = String(bounds.max);
    valueSlider.value = String(conn.weight);
    updateResetConnectionButtonState(connectionIndex);
    updateConnectionPickerSelection();
}

function clearConnectionEditor() {
    LabState.selectedConnectionIndex = null;
    document.getElementById('connection-placeholder').classList.remove('hidden');
    document.getElementById('connection-controls').classList.add('hidden');
    updateResetConnectionButtonState(null);
    updateConnectionPickerSelection();
}

function formatNodeLabel(node) {
    if (!node) return 'unknown';
    if (window.CPPN && typeof window.CPPN.getDisplayNodeLabel === 'function') {
        const displayLabel = window.CPPN.getDisplayNodeLabel(node);
        if (displayLabel) return displayLabel;
    }
    if (node.label) return node.label;
    return `${node.type}-${node.id}`;
}

function getWeightBounds() {
    return { ...LAB_WEIGHT_BOUNDS };
}

function enforceLabWeightBounds() {
    if (!window.NEAT || !window.NEAT.CONFIG) return;
    window.NEAT.CONFIG.weightMin = LAB_WEIGHT_BOUNDS.min;
    window.NEAT.CONFIG.weightMax = LAB_WEIGHT_BOUNDS.max;
}

function nudgeSelectedConnection(delta) {
    const conn = LabState.visualizer.nudgeSelectedConnection(delta);
    if (!conn) return;

    const selectedIndex = LabState.visualizer.selectedConnectionIndex;
    if (selectedIndex !== null) {
        populateConnectionEditor(conn, selectedIndex);
    }

    queuePreviewRender();
}

function setSelectedConnectionValue(nextValue) {
    const selectedIndex = LabState.visualizer.selectedConnectionIndex;
    if (selectedIndex === null) return;

    const conn = LabState.visualizer.setConnectionWeight(selectedIndex, nextValue);
    if (!conn) return;

    populateConnectionEditor(conn, selectedIndex);
    queuePreviewRender();
}

function handleGenomeUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const raw = typeof reader.result === 'string' ? reader.result : '';
            const parsed = JSON.parse(raw);
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

    if (Array.isArray(payload.genomes) && payload.genomes.length > 0) {
        const first = payload.genomes[0] && payload.genomes[0].genome
            ? payload.genomes[0].genome
            : payload.genomes[0];
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

        const genome = NEAT.Genome.deserialize(serialized);
        return {
            genome,
            label: payload.genome.id ? `Genome ${payload.genome.id}` : 'Loaded genome'
        };
    }

    if (Array.isArray(payload.nodes) && Array.isArray(payload.connections)) {
        return {
            genome: NEAT.Genome.deserialize(payload),
            label: payload.id ? `Genome ${payload.id}` : 'Loaded genome'
        };
    }

    throw new Error('no genome found (expected genome.nodes + genome.connections)');
}

function queuePreviewRender() {
    if (!LabState.genome) return;
    if (LabState.renderPending) return;

    LabState.renderPending = true;
    requestAnimationFrame(() => {
        LabState.renderPending = false;
        renderPreviewImage();
    });
}

function renderPreviewImage() {
    if (!LabState.previewCtx || !LabState.genome) return;
    renderCPPNPreview();
}

function renderCPPNPreview() {
    if (!LabState.renderer || !LabState.previewCanvas || !LabState.genome) return;
    LabState.renderer.renderProgressive(LabState.genome, LabState.previewCanvas);
}

async function downloadPreviewImage(resolution = LAB_DOWNLOAD_GIF_RESOLUTION) {
    if (!LabState.genome) return;

    const button = document.getElementById('download-preview-btn');
    const originalText = button ? button.textContent : '';
    const exportResolution = LAB_DOWNLOAD_RESOLUTION_OPTIONS.includes(resolution)
        ? resolution
        : LAB_DOWNLOAD_GIF_RESOLUTION;

    LabState.exportInProgress = true;
    setLabActionsEnabled(true);
    closeDownloadResolutionMenu();
    if (button) {
        button.textContent = `Encoding GIF (${exportResolution})...`;
    }

    try {
        const serializedGenome = serializeGenomeForLab(LabState.genome);
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
            blob = await createGifBlobViaWorker(
                serializedGenome,
                {
                    resolution: exportResolution,
                    frameCount,
                    frameDurationMs,
                    outputColorMode: outputModeManager ? outputModeManager.getMode() : 'hsv'
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
            blob = LabState.renderer.createGifBlob(LabState.genome, {
                resolution: exportResolution
            });
        }

        const url = URL.createObjectURL(blob);
        const genomeId = typeof LabState.genome.id === 'string' && LabState.genome.id
            ? LabState.genome.id
            : 'output';
        const a = document.createElement('a');
        a.href = url;
        a.download = `activation-lab-output-${genomeId}.gif`;
        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 0);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown GIF export error';
        setPreviewStatus(`Could not export GIF: ${message}`);
    } finally {
        LabState.exportInProgress = false;
        setLabActionsEnabled(Boolean(LabState.genome));
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
            worker = new Worker(LAB_GIF_EXPORT_WORKER_PATH);
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

function downloadLabGenomeJson() {
    if (!LabState.genome) return;

    const serialized = serializeGenomeForLab(LabState.genome);
    if (!serialized) return;

    const payload = {
        format: 'cppn-activation-lab-genome-v1',
        savedAt: new Date().toISOString(),
        label: LabState.loadedGenomeName || `Genome ${LabState.genome.id}`,
        genome: serialized
    };

    const genomeId = typeof LabState.genome.id === 'string' && LabState.genome.id
        ? LabState.genome.id
        : 'edited';
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activation-lab-genome-${genomeId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 0);
}

function setPreviewStatus(text) {
    const container = document.getElementById('preview-status');
    container.innerHTML = '';

    const p = document.createElement('p');
    p.textContent = text;
    container.appendChild(p);
}

function refreshPreviewStatus() {
    const genomeText = LabState.loadedGenomeName || 'No genome loaded';
    setPreviewStatus(`${genomeText} | Preview mode: direct CPPN output`);
}

function handleConnectionPickerClick(event) {
    const button = event.target.closest('button[data-conn-index]');
    if (!button || !LabState.visualizer) return;

    const connectionIndex = Number.parseInt(button.dataset.connIndex, 10);
    if (!Number.isInteger(connectionIndex)) return;
    LabState.visualizer.selectConnection(connectionIndex);
}

function renderConnectionPicker() {
    const picker = document.getElementById('connection-picker');
    if (!picker || !LabState.genome) return;

    picker.innerHTML = '';
    const connections = LabState.genome.connections
        .map((conn, index) => ({ conn, index }))
        .filter(({ conn }) => conn && conn.enabled);

    if (connections.length === 0) {
        const message = document.createElement('p');
        message.className = 'placeholder';
        message.textContent = 'No enabled connections';
        picker.appendChild(message);
        return;
    }

    connections.forEach(({ conn, index }, order) => {
        const fromNode = LabState.genome.nodes.get(conn.fromId);
        const toNode = LabState.genome.nodes.get(conn.toId);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'connection-chip';
        button.dataset.connIndex = String(index);
        button.textContent = String(order + 1);
        button.title = `${formatNodeLabel(fromNode)} -> ${formatNodeLabel(toNode)} (#${index})`;
        picker.appendChild(button);
    });

    updateConnectionPickerSelection();
}

function updateConnectionPickerSelection() {
    const picker = document.getElementById('connection-picker');
    if (!picker) return;

    picker.querySelectorAll('button[data-conn-index]').forEach((button) => {
        const connectionIndex = Number.parseInt(button.dataset.connIndex, 10);
        const isActive = Number.isInteger(connectionIndex) && connectionIndex === LabState.selectedConnectionIndex;
        button.classList.toggle('is-active', isActive);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initActivationLab);
} else {
    initActivationLab();
}
