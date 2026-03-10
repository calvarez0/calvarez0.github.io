/**
 * Main Application - PicBreeder-style CPPN Evolution
 */

const AppState = {
    population: null,
    selectedGenomes: new Set(),
    viewingGenome: null,
    renderer: null,
    visualizer: null,
    phylogenyVisualizer: null,
    panelMode: 'network',
    cells: [],
    sessionSaveMode: 'full',
    mutationProfile: 'steppingStone'
};
const GRID_SIZE = 20;
const MOBILE_LAYOUT_BREAKPOINT = 900;
const EVOLUTION_STATE_STORAGE_KEY = 'cppn-evolution-state-v1';
const LAB_SEED_STORAGE_KEY = 'cppn-activation-seed-v1';
const ARCHIVE_DIR = 'archive';
const ARCHIVE_MANIFEST_PATH = `${ARCHIVE_DIR}/manifest.json`;
const MUTATION_PROFILES = {
    steppingStone: {
        weightMutationRate: 0.1,
        weightPerturbRate: 0.1,
        weightPerturbPower: 0.1,
        addNodeRate: 0.2,
        addConnectionRate: 0.2,
        weightMin: -5,
        weightMax: 5
    },
    startFresh: {
        weightMutationRate: 0.8,
        weightPerturbRate: 0.8,
        weightPerturbPower: 0.5,
        addNodeRate: 0.4,
        addConnectionRate: 0.4,
        weightMin: -8,
        weightMax: 8
    }
};

function getGenomeById(genomeId) {
    if (!genomeId || !AppState.population) return null;
    return AppState.population.getGenomes().find((genome) => genome.id === genomeId) || null;
}

function updateCellClasses() {
    const genomes = AppState.population ? AppState.population.getGenomes() : [];

    AppState.cells.forEach(({ cell }, index) => {
        const genome = genomes[index];
        const isSelected = genome ? AppState.selectedGenomes.has(genome) : false;
        const isViewing = genome ? AppState.viewingGenome === genome : false;
        cell.classList.toggle('selected', isSelected);
        cell.classList.toggle('viewing', isViewing);
    });
}

function applyMutationProfile(profileName) {
    const profile = MUTATION_PROFILES[profileName] || MUTATION_PROFILES.steppingStone;
    const resolvedProfileName = MUTATION_PROFILES[profileName] ? profileName : 'steppingStone';
    if (window.NEAT && window.NEAT.CONFIG) {
        Object.assign(window.NEAT.CONFIG, profile);
    }
    AppState.mutationProfile = resolvedProfileName;
}

function serializeGenomeForStorage(genome, includeLineage = true) {
    if (!genome) return null;
    if (includeLineage) return genome.serialize();

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

function serializeCompactLineageRecord(record, fallbackHistoryId) {
    const historyId = record && typeof record.historyId === 'string'
        ? record.historyId
        : fallbackHistoryId;
    const generation = record && Number.isFinite(record.generation)
        ? record.generation
        : 0;
    const parentHistoryIds = record && Array.isArray(record.parentHistoryIds)
        ? record.parentHistoryIds.filter((id) => typeof id === 'string')
        : [];
    const genomeId = record && typeof record.genomeId === 'string'
        ? record.genomeId
        : null;
    const nodes = record && Array.isArray(record.nodes)
        ? record.nodes.map((node) => ({ ...node }))
        : [];
    const connections = record && Array.isArray(record.connections)
        ? record.connections.map((conn) => ({ ...conn }))
        : [];

    return {
        historyId,
        genomeId,
        generation,
        parentHistoryIds,
        nodes,
        connections
    };
}

function buildCompactLineageRecordsForPopulation(genomes) {
    const compactRecords = {};
    if (!Array.isArray(genomes)) return compactRecords;

    for (const genome of genomes) {
        const lineageRecords = genome && genome.lineageRecords && typeof genome.lineageRecords === 'object'
            ? genome.lineageRecords
            : {};
        for (const [historyId, record] of Object.entries(lineageRecords)) {
            if (!compactRecords[historyId]) {
                compactRecords[historyId] = serializeCompactLineageRecord(record, historyId);
            }
        }
    }

    return compactRecords;
}

function applyCompactLineageRecordsToPopulation(population, compactRecords) {
    if (!population || !Array.isArray(population.genomes)) return;
    if (!compactRecords || typeof compactRecords !== 'object') return;

    const normalizedRecords = {};
    for (const [historyId, record] of Object.entries(compactRecords)) {
        const normalized = serializeCompactLineageRecord(record, historyId);
        normalizedRecords[historyId] = normalized;
    }

    for (const genome of population.genomes) {
        const hydrated = {};
        for (const [historyId, record] of Object.entries(normalizedRecords)) {
            hydrated[historyId] = {
                historyId: record.historyId,
                genomeId: record.genomeId,
                generation: record.generation,
                parentHistoryIds: [...record.parentHistoryIds],
                nodes: record.nodes.map((node) => ({ ...node })),
                connections: record.connections.map((conn) => ({ ...conn }))
            };
        }
        genome.lineageRecords = hydrated;
        genome.updateLineageRecord();
    }
}

function buildPopulationStateForSession(compact = false) {
    if (!AppState.population) return null;
    if (!compact) return AppState.population.exportState();

    const genomes = AppState.population.getGenomes();

    return {
        format: 'cppn-population-v1',
        exportedAt: new Date().toISOString(),
        size: AppState.population.size,
        generation: AppState.population.generation,
        genomes: genomes.map((genome) => serializeGenomeForStorage(genome, false)),
        lineageRecords: buildCompactLineageRecordsForPopulation(genomes)
    };
}

function buildEvolutionSessionPayload(compact = false) {
    return {
        format: compact ? 'cppn-evolution-state-v1-compact' : 'cppn-evolution-state-v1',
        savedAt: new Date().toISOString(),
        panelMode: AppState.panelMode,
        mutationProfile: AppState.mutationProfile,
        viewingGenomeId: AppState.viewingGenome ? AppState.viewingGenome.id : null,
        selectedGenomeIds: Array.from(AppState.selectedGenomes)
            .map((genome) => genome.id)
            .filter((id) => typeof id === 'string'),
        compact,
        population: buildPopulationStateForSession(compact)
    };
}

function saveAppStateToSession() {
    if (!AppState.population) return;

    try {
        const genomes = AppState.population.getGenomes();
        if (!Array.isArray(genomes) || genomes.length === 0) return;

        if (AppState.sessionSaveMode !== 'compact') {
            const fullPayload = buildEvolutionSessionPayload(false);
            sessionStorage.setItem(EVOLUTION_STATE_STORAGE_KEY, JSON.stringify(fullPayload));
            AppState.sessionSaveMode = 'full';
            return;
        }
    } catch (error) {
        AppState.sessionSaveMode = 'compact';
    }

    try {
        const compactPayload = buildEvolutionSessionPayload(true);
        sessionStorage.setItem(EVOLUTION_STATE_STORAGE_KEY, JSON.stringify(compactPayload));
    } catch (error) {
        // Ignore session persistence issues (private mode/quota, etc.).
    }
}

function restoreAppStateFromSession() {
    try {
        const raw = sessionStorage.getItem(EVOLUTION_STATE_STORAGE_KEY);
        if (!raw) return false;

        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.population) return false;

        AppState.population = NEAT.Population.fromState(parsed.population);
        if (parsed.compact && parsed.population && typeof parsed.population.lineageRecords === 'object') {
            applyCompactLineageRecordsToPopulation(AppState.population, parsed.population.lineageRecords);
        }
        AppState.sessionSaveMode = parsed.compact ? 'compact' : 'full';
        AppState.panelMode = parsed.panelMode === 'phylogeny' ? 'phylogeny' : 'network';
        AppState.mutationProfile = typeof parsed.mutationProfile === 'string'
            ? parsed.mutationProfile
            : 'steppingStone';
        applyMutationProfile(AppState.mutationProfile);

        const viewingGenome = getGenomeById(parsed.viewingGenomeId);
        AppState.viewingGenome = viewingGenome;

        AppState.selectedGenomes = new Set();
        if (Array.isArray(parsed.selectedGenomeIds)) {
            for (const genomeId of parsed.selectedGenomeIds) {
                const genome = getGenomeById(genomeId);
                if (genome) AppState.selectedGenomes.add(genome);
            }
        }

        return true;
    } catch (error) {
        return false;
    }
}

function shuffleInPlace(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function normalizeArchivePath(path) {
    if (typeof path !== 'string') return null;
    const trimmed = path.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;

    const withoutLeadingDot = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
    if (withoutLeadingDot.startsWith(`${ARCHIVE_DIR}/`)) {
        return withoutLeadingDot;
    }

    return `${ARCHIVE_DIR}/${withoutLeadingDot}`;
}

function toFetchUrl(path) {
    if (typeof path !== 'string') return path;
    if (/^https?:\/\//i.test(path)) return path;
    return encodeURI(path);
}

function isArchiveGenomePath(path) {
    if (typeof path !== 'string') return false;
    const lowered = path.toLowerCase();
    if (!lowered.endsWith('.json')) return false;
    return !lowered.endsWith('/manifest.json') && lowered !== 'manifest.json';
}

function parseArchiveGenomePayload(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('invalid genome payload');
    }

    if (payload.genome && typeof payload.genome === 'object') {
        const serialized = { ...payload.genome };
        if (payload.lineage && payload.lineage.records && typeof payload.lineage.records === 'object') {
            serialized.lineageRecords = payload.lineage.records;
        }
        return NEAT.Genome.deserialize(serialized);
    }

    if (Array.isArray(payload.nodes) && Array.isArray(payload.connections)) {
        return NEAT.Genome.deserialize(payload);
    }

    if (Array.isArray(payload.genomes) && payload.genomes.length > 0) {
        const firstEntry = payload.genomes[0];
        if (firstEntry && typeof firstEntry === 'object' && firstEntry.genome && typeof firstEntry.genome === 'object') {
            const serialized = { ...firstEntry.genome };
            if (firstEntry.lineage && firstEntry.lineage.records && typeof firstEntry.lineage.records === 'object') {
                serialized.lineageRecords = firstEntry.lineage.records;
            }
            return NEAT.Genome.deserialize(serialized);
        }

        return NEAT.Genome.deserialize(firstEntry);
    }

    throw new Error('no genome found in archive JSON');
}

async function loadArchiveManifestFiles() {
    try {
        const response = await fetch(ARCHIVE_MANIFEST_PATH, { cache: 'no-store' });
        if (!response.ok) return [];

        const manifest = await response.json();
        if (!manifest || !Array.isArray(manifest.files)) return [];

        return Array.from(new Set(
            manifest.files
                .map((name) => normalizeArchivePath(name))
                .filter((path) => isArchiveGenomePath(path))
        ));
    } catch (error) {
        return [];
    }
}

async function loadArchiveFilesFromDirectoryListing() {
    try {
        const response = await fetch(`${ARCHIVE_DIR}/`, { cache: 'no-store' });
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
            if (isArchiveGenomePath(normalized)) files.push(normalized);
        }

        return Array.from(new Set(files));
    } catch (error) {
        return [];
    }
}

async function getArchiveGenomeFiles() {
    const manifestFiles = await loadArchiveManifestFiles();
    if (manifestFiles.length > 0) return manifestFiles;
    return loadArchiveFilesFromDirectoryListing();
}

async function loadPopulationFromArchive(targetSize = GRID_SIZE) {
    const archiveFiles = await getArchiveGenomeFiles();
    if (archiveFiles.length === 0) {
        throw new Error('archive has no readable genome JSON files');
    }

    const shuffledPaths = [...archiveFiles];
    shuffleInPlace(shuffledPaths);

    const genomes = [];
    const seenSignatures = new Set();
    for (const path of shuffledPaths) {
        try {
            const response = await fetch(toFetchUrl(path), { cache: 'no-store' });
            if (!response.ok) continue;

            const payload = await response.json();
            const genome = parseArchiveGenomePayload(payload);
            const signature = genome.getStructureSignature();
            if (seenSignatures.has(signature)) continue;
            genome.id = Math.random().toString(36).substr(2, 9);
            genome.updateLineageRecord();
            seenSignatures.add(signature);
            genomes.push(genome);
        } catch (error) {
            continue;
        }

        if (genomes.length >= targetSize) break;
    }

    if (genomes.length === 0) {
        throw new Error('unable to parse genomes from archive');
    }

    while (genomes.length < targetSize) {
        const source = genomes[Math.floor(Math.random() * genomes.length)];
        const clone = source.clone();
        clone.id = Math.random().toString(36).substr(2, 9);
        clone.updateLineageRecord();
        genomes.push(clone);
    }

    const population = new NEAT.Population(targetSize);
    population.genomes = genomes.slice(0, targetSize);
    population.generation = population.genomes.reduce((maxGeneration, genome) => {
        return Number.isFinite(genome.generation)
            ? Math.max(maxGeneration, Math.floor(genome.generation))
            : maxGeneration;
    }, 1);
    population.ensureUniqueGenomeStructures();
    return population;
}

function createPopulationFromSeedGenome(seedGenome, targetSize = GRID_SIZE) {
    const size = Number.isInteger(targetSize) && targetSize > 0 ? targetSize : GRID_SIZE;
    const base = seedGenome.clone();
    const baseGeneration = Number.isFinite(base.generation) ? Math.max(1, Math.floor(base.generation)) : 1;

    base.id = Math.random().toString(36).substr(2, 9);
    base.updateLineageRecord();

    const genomes = [base];
    while (genomes.length < size) {
        const child = base.clone();
        child.id = Math.random().toString(36).substr(2, 9);

        // Keep variants close to the uploaded source while still offering diversity.
        child.mutateWeights();
        if (Math.random() < 0.3) child.addRandomConnection();
        if (Math.random() < 0.15) child.addRandomNode();

        child.setChildLineage([base], baseGeneration + 1);
        genomes.push(child);
    }

    const population = new NEAT.Population(size);
    population.genomes = genomes;
    population.generation = genomes.reduce((maxGeneration, genome) => {
        return Number.isFinite(genome.generation)
            ? Math.max(maxGeneration, Math.floor(genome.generation))
            : maxGeneration;
    }, baseGeneration);
    population.ensureUniqueGenomeStructures();
    return population;
}

function seedActivationLabFromCurrentGenome() {
    if (!AppState.population) return;

    const fallback = AppState.population.getGenomes()[0] || null;
    const selected = Array.from(AppState.selectedGenomes)[0] || null;
    const genome = AppState.viewingGenome || selected || fallback;
    if (!genome) return;

    try {
        const payload = {
            format: 'cppn-activation-seed-v1',
            savedAt: new Date().toISOString(),
            label: `Genome ${genome.id}`,
            genome: serializeGenomeForStorage(genome, false)
        };
        sessionStorage.setItem(LAB_SEED_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        // Ignore session persistence issues.
    }
}

async function initApp() {
    AppState.renderer = new CPPN.CPPNRenderer();
    AppState.visualizer = new CPPN.NetworkVisualizer(document.getElementById('network-svg'));
    AppState.phylogenyVisualizer = new CPPN.PhylogenyVisualizer(document.getElementById('phylogeny-svg'));

    AppState.population = new NEAT.Population(GRID_SIZE);
    applyMutationProfile(AppState.mutationProfile);

    setupImageGrid();
    setupMobileActionPlacement();
    setupEventListeners();

    const restored = restoreAppStateFromSession();
    if (!restored) {
        try {
            AppState.population = await loadPopulationFromArchive(GRID_SIZE);
        } catch (error) {
            AppState.population.initialize();
        }
    }

    renderPopulation({ preserveState: restored, persist: false });
    setPanelMode(AppState.panelMode, { persist: false });
    saveAppStateToSession();
}

function setupMobileActionPlacement() {
    const actionRow = document.querySelector('.network-panel .panel-footer-actions');
    const controls = document.querySelector('.evolution-panel .controls');
    const evolveBtn = document.getElementById('evolve-btn');
    const evolutionPanel = document.querySelector('.evolution-panel');
    const imageGrid = document.getElementById('image-grid');
    if (!actionRow || !controls || !evolveBtn || !evolutionPanel || !imageGrid) return;

    const actionOriginalParent = actionRow.parentElement;
    const actionOriginalNextSibling = actionRow.nextElementSibling;
    const evolveOriginalParent = evolveBtn.parentElement;
    const evolveOriginalNextSibling = evolveBtn.nextElementSibling;

    const placeActionRow = () => {
        const isMobile = window.matchMedia(`(max-width: ${MOBILE_LAYOUT_BREAKPOINT}px)`).matches;

        if (isMobile) {
            if (actionRow.parentElement !== controls) {
                controls.appendChild(actionRow);
            }

            if (evolveBtn.parentElement !== evolutionPanel || evolveBtn.previousElementSibling !== imageGrid) {
                imageGrid.insertAdjacentElement('afterend', evolveBtn);
            }
            return;
        }

        if (actionRow.parentElement !== actionOriginalParent) {
            if (actionOriginalNextSibling && actionOriginalNextSibling.parentElement === actionOriginalParent) {
                actionOriginalParent.insertBefore(actionRow, actionOriginalNextSibling);
            } else {
                actionOriginalParent.appendChild(actionRow);
            }
        }

        if (evolveBtn.parentElement !== evolveOriginalParent) {
            if (evolveOriginalNextSibling && evolveOriginalNextSibling.parentElement === evolveOriginalParent) {
                evolveOriginalParent.insertBefore(evolveBtn, evolveOriginalNextSibling);
            } else {
                evolveOriginalParent.appendChild(evolveBtn);
            }
        }
    };

    placeActionRow();
    window.addEventListener('resize', placeActionRow);
}

function setupImageGrid() {
    const grid = document.getElementById('image-grid');
    grid.innerHTML = '';
    AppState.cells = [];

    for (let i = 0; i < GRID_SIZE; i++) {
        const cell = document.createElement('div');
        cell.className = 'image-cell';
        cell.dataset.index = i;

        const canvas = document.createElement('canvas');
        canvas.width = 150;
        canvas.height = 150;

        const badge = document.createElement('div');
        badge.className = 'select-badge';
        badge.innerHTML = '✓';

        cell.appendChild(canvas);
        cell.appendChild(badge);

        cell.addEventListener('click', (e) => handleCellClick(i, e));

        grid.appendChild(cell);
        AppState.cells.push({ cell, canvas });
    }
}

function setupEventListeners() {
    document.getElementById('evolve-btn').addEventListener('click', handleEvolve);
    document.getElementById('restart-btn').addEventListener('click', handleRestart);
    document.getElementById('reset-btn').addEventListener('click', handleReset);
    document.getElementById('network-view-btn').addEventListener('click', () => setPanelMode('network'));
    document.getElementById('phylogeny-view-btn').addEventListener('click', () => setPanelMode('phylogeny'));
    document.getElementById('save-genome-btn').addEventListener('click', handleSaveGenome);
    document.getElementById('upload-start-genome-input').addEventListener('change', handleStartFromUploadedGenome);
    document.getElementById('phylo-zoom-in-btn').addEventListener('click', () => AppState.phylogenyVisualizer.zoomIn());
    document.getElementById('phylo-zoom-out-btn').addEventListener('click', () => AppState.phylogenyVisualizer.zoomOut());
    document.getElementById('phylo-up-btn').addEventListener('click', () => AppState.phylogenyVisualizer.pan(0, 60));
    document.getElementById('phylo-down-btn').addEventListener('click', () => AppState.phylogenyVisualizer.pan(0, -60));
    document.getElementById('phylo-reset-btn').addEventListener('click', () => AppState.phylogenyVisualizer.resetView());

    const labLink = document.querySelector('a[href="activation-lab.html"]');
    if (labLink) {
        labLink.addEventListener('click', () => {
            seedActivationLabFromCurrentGenome();
            saveAppStateToSession();
        });
    }

    window.addEventListener('beforeunload', () => {
        saveAppStateToSession();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleEvolve();
        if (e.key === 'Escape') clearSelection();

        if (AppState.panelMode === 'phylogeny') {
            if (e.key === '=' || e.key === '+') AppState.phylogenyVisualizer.zoomIn();
            if (e.key === '-') AppState.phylogenyVisualizer.zoomOut();
            if (e.key === 'ArrowUp') AppState.phylogenyVisualizer.pan(0, 40);
            if (e.key === 'ArrowDown') AppState.phylogenyVisualizer.pan(0, -40);
        }
    });
}

function renderPopulation(options = {}) {
    const preserveState = Boolean(options.preserveState);
    const persist = options.persist !== false;
    const genomes = AppState.population.getGenomes();

    genomes.forEach((genome, index) => {
        if (index < AppState.cells.length) {
            const { canvas } = AppState.cells[index];
            AppState.renderer.renderProgressive(genome, canvas);
        }
    });

    document.getElementById('generation-count').textContent = AppState.population.generation;

    if (!preserveState) {
        AppState.viewingGenome = null;
        clearSelection({ persist: false });
        updateInspectorVisualization(null);
    } else {
        AppState.selectedGenomes = new Set(
            Array.from(AppState.selectedGenomes).filter((genome) => genomes.includes(genome))
        );
        if (AppState.viewingGenome && !genomes.includes(AppState.viewingGenome)) {
            AppState.viewingGenome = null;
        }

        updateCellClasses();
        updateSelectionInfo();
        updateInspectorVisualization(AppState.viewingGenome);
    }

    if (persist) saveAppStateToSession();
}

function setPanelMode(mode, options = {}) {
    const persist = options.persist !== false;
    const isNetwork = mode === 'network';

    AppState.panelMode = isNetwork ? 'network' : 'phylogeny';

    document.getElementById('inspector-title').textContent = isNetwork ? 'Network' : 'Phylogeny';
    document.getElementById('network-view-btn').classList.toggle('is-active', isNetwork);
    document.getElementById('phylogeny-view-btn').classList.toggle('is-active', !isNetwork);
    document.getElementById('network-svg').classList.toggle('hidden', !isNetwork);
    document.getElementById('phylogeny-svg').classList.toggle('hidden', isNetwork);
    document.getElementById('phylogeny-controls').classList.toggle('hidden', isNetwork);

    updateInspectorVisualization(AppState.viewingGenome);
    if (persist) saveAppStateToSession();
}

function updateInspectorVisualization(genome) {
    if (!genome) {
        AppState.visualizer.clear();
        AppState.phylogenyVisualizer.clear();
        document.getElementById('network-info').innerHTML =
            AppState.panelMode === 'network'
                ? '<p class="placeholder">Click an image to view its CPPN</p>'
                : '<p class="placeholder">Click an image to view its ancestor tree</p>';
        document.getElementById('network-stats').innerHTML = '';
        document.getElementById('save-genome-btn').disabled = true;
        return;
    }

    document.getElementById('save-genome-btn').disabled = false;

    if (AppState.panelMode === 'network') {
        const stats = genome.getStats();
        document.getElementById('network-info').innerHTML = `
            <strong>${stats.hiddenNodes}</strong> hidden nodes,
            <strong>${stats.enabledConnections}</strong> connections
        `;

        document.getElementById('network-stats').innerHTML = `
            <div class="stat-item">
                <div class="stat-value">${stats.inputNodes}</div>
                <div class="stat-label">In</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.hiddenNodes}</div>
                <div class="stat-label">Hidden</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.outputNodes}</div>
                <div class="stat-label">Out</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.enabledConnections}</div>
                <div class="stat-label">Conn</div>
            </div>
        `;

        AppState.phylogenyVisualizer.clear();
        AppState.visualizer.visualize(genome);
        return;
    }

    const lineageStats = genome.getLineageStats();
    document.getElementById('network-info').innerHTML = `
        <strong>${lineageStats.ancestorCount}</strong> ancestors,
        generations <strong>${lineageStats.minGeneration}</strong>-${lineageStats.maxGeneration}
    `;

    document.getElementById('network-stats').innerHTML = `
        <div class="stat-item">
            <div class="stat-value">${lineageStats.totalNodes}</div>
            <div class="stat-label">Lineage Nodes</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${lineageStats.totalEdges}</div>
            <div class="stat-label">Links</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${lineageStats.rootCount}</div>
            <div class="stat-label">Roots</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${lineageStats.depth}</div>
            <div class="stat-label">Depth</div>
        </div>
    `;

    AppState.visualizer.clear();
    AppState.phylogenyVisualizer.visualize(genome);
}

function handleCellClick(index, event) {
    const genomes = AppState.population.getGenomes();
    const genome = genomes[index];
    if (!genome) return;

    AppState.viewingGenome = genome;
    updateInspectorVisualization(genome);

    if (AppState.selectedGenomes.has(genome)) {
        AppState.selectedGenomes.delete(genome);
    } else {
        AppState.selectedGenomes.add(genome);
    }

    updateCellClasses();
    updateSelectionInfo();
    seedActivationLabFromCurrentGenome();
    saveAppStateToSession();
}

function handleEvolve() {
    if (AppState.selectedGenomes.size === 0) {
        return;
    }

    const parents = Array.from(AppState.selectedGenomes);
    AppState.population.evolve(parents);
    renderPopulation();
}

function handleReset() {
    applyMutationProfile('startFresh');
    AppState.population.initialize();
    renderPopulation();
    updateInspectorVisualization(null);
    saveAppStateToSession();
}

async function handleRestart() {
    const restartBtn = document.getElementById('restart-btn');
    const resetBtn = document.getElementById('reset-btn');
    const previousPopulation = AppState.population;
    let loadedFromArchive = false;

    if (restartBtn) restartBtn.disabled = true;
    if (resetBtn) resetBtn.disabled = true;
    applyMutationProfile('steppingStone');

    try {
        AppState.population = await loadPopulationFromArchive(GRID_SIZE);
        loadedFromArchive = true;
    } catch (error) {
        AppState.population = previousPopulation;
    } finally {
        if (restartBtn) restartBtn.disabled = false;
        if (resetBtn) resetBtn.disabled = false;
    }

    if (!loadedFromArchive) return;

    renderPopulation();
    updateInspectorVisualization(null);
    saveAppStateToSession();
}

function handleStartFromUploadedGenome(event) {
    const input = event.target;
    const file = input && input.files ? input.files[0] : null;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const raw = typeof reader.result === 'string' ? reader.result : '';
            const parsed = JSON.parse(raw);
            const seedGenome = parseArchiveGenomePayload(parsed);
            applyMutationProfile('steppingStone');
            AppState.population = createPopulationFromSeedGenome(seedGenome, GRID_SIZE);
            renderPopulation();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid JSON';
            window.alert(`Could not load uploaded genome: ${message}`);
        } finally {
            input.value = '';
        }
    };

    reader.onerror = () => {
        window.alert('Could not read that JSON file.');
        input.value = '';
    };

    reader.readAsText(file);
}

function handleSaveGenome() {
    if (!AppState.viewingGenome) return;

    const genome = AppState.viewingGenome;
    const exportData = genome.exportWithLineage();
    const fileName = `genome-${genome.id}-lineage-${genome.historyId}.json`;
    const payload = JSON.stringify(exportData, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
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

function clearSelection(options = {}) {
    const persist = options.persist !== false;
    AppState.selectedGenomes.clear();
    updateCellClasses();
    updateSelectionInfo();
    if (persist) saveAppStateToSession();
}

function updateSelectionInfo() {
    const count = AppState.selectedGenomes.size;
    document.getElementById('selected-count').textContent = count;

    const btn = document.getElementById('evolve-btn');
    btn.disabled = count === 0;
    btn.textContent = count === 0 ? 'Select At Least One' : `Evolve (${count})`;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
