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
    selectedConnectionIndex: null,
    renderPending: false,
    loadedGenomeName: 'No genome loaded'
};
const LAB_SEED_STORAGE_KEY = 'cppn-activation-seed-v1';
const LAB_ARCHIVE_DIR = 'archive';
const LAB_ARCHIVE_MANIFEST_PATH = `${LAB_ARCHIVE_DIR}/manifest.json`;

function initActivationLab() {
    const networkSvg = document.getElementById('editor-network-svg');
    const previewCanvas = document.getElementById('preview-canvas');
    if (!networkSvg || !previewCanvas) return;

    LabState.previewCanvas = previewCanvas;
    LabState.previewCtx = previewCanvas.getContext('2d', { willReadFrequently: true });

    LabState.visualizer = new CPPN.NetworkVisualizer(networkSvg, {
        interactive: true,
        onConnectionSelected: handleConnectionSelection,
        onConnectionWeightChanged: handleConnectionWeightChange
    });
    LabState.renderer = new CPPN.CPPNRenderer();

    setupActivationLabEvents();
    if (!loadSeedGenomeFromSession()) {
        randomizeNetwork();
    }
}

function setupActivationLabEvents() {
    document.getElementById('genome-upload-input').addEventListener('change', handleGenomeUpload);
    document.getElementById('randomize-network-btn').addEventListener('click', randomizeNetwork);
    document.getElementById('network-zoom-in-btn').addEventListener('click', () => LabState.visualizer.zoomIn());
    document.getElementById('network-zoom-out-btn').addEventListener('click', () => LabState.visualizer.zoomOut());
    document.getElementById('network-reset-view-btn').addEventListener('click', () => LabState.visualizer.resetView());
    document.getElementById('download-preview-btn').addEventListener('click', downloadPreviewImage);
    document.getElementById('connection-picker').addEventListener('click', handleConnectionPickerClick);

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
}

async function randomizeNetwork() {
    const randomizeButton = document.getElementById('randomize-network-btn');
    if (randomizeButton) randomizeButton.disabled = true;

    try {
        const archiveFiles = await getArchiveGenomeFiles();
        if (archiveFiles.length === 0) {
            throw new Error('no JSON files found in archive/');
        }

        const randomPath = archiveFiles[Math.floor(Math.random() * archiveFiles.length)];
        const response = await fetch(toFetchUrl(randomPath), { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`failed to load ${randomPath} (${response.status})`);
        }

        const payload = await response.json();
        const loadResult = parseGenomePayload(payload);
        const fileName = randomPath.split('/').pop() || randomPath;
        const label = loadResult.label && loadResult.label !== 'Loaded genome'
            ? loadResult.label
            : fileName;

        applyLoadedGenome(loadResult.genome, label);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown archive load error';
        setPreviewStatus(`Could not load random archive genome: ${message}`);
    } finally {
        if (randomizeButton) randomizeButton.disabled = false;
    }
}

function applyLoadedGenome(genome, label) {
    LabState.genome = genome;
    LabState.loadedGenomeName = label || `Genome ${genome.id}`;
    renderNetwork();
    clearConnectionEditor();
    document.getElementById('download-preview-btn').disabled = false;
    refreshPreviewStatus();
    queuePreviewRender();
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
    updateConnectionPickerSelection();
}

function clearConnectionEditor() {
    LabState.selectedConnectionIndex = null;
    document.getElementById('connection-placeholder').classList.remove('hidden');
    document.getElementById('connection-controls').classList.add('hidden');
    updateConnectionPickerSelection();
}

function formatNodeLabel(node) {
    if (!node) return 'unknown';
    if (node.label) return node.label;
    return `${node.type}-${node.id}`;
}

function getWeightBounds() {
    if (window.NEAT && window.NEAT.CONFIG) {
        const min = Number.isFinite(window.NEAT.CONFIG.weightMin) ? window.NEAT.CONFIG.weightMin : -3;
        const max = Number.isFinite(window.NEAT.CONFIG.weightMax) ? window.NEAT.CONFIG.weightMax : 3;
        return { min, max };
    }

    return { min: -3, max: 3 };
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

    const renderSize = 360;
    LabState.renderer.render(LabState.genome, LabState.previewCanvas, renderSize);
}

function downloadPreviewImage() {
    if (!LabState.genome) return;

    const a = document.createElement('a');
    a.href = LabState.previewCanvas.toDataURL('image/png');
    a.download = 'activation-lab-output.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
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
