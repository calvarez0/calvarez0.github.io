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
    cells: []
};
const GRID_SIZE = 20;
const EVOLUTION_STATE_STORAGE_KEY = 'cppn-evolution-state-v1';
const LAB_SEED_STORAGE_KEY = 'cppn-activation-seed-v1';

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

function saveAppStateToSession() {
    if (!AppState.population) return;

    try {
        const genomes = AppState.population.getGenomes();
        const payload = {
            format: 'cppn-evolution-state-v1',
            savedAt: new Date().toISOString(),
            panelMode: AppState.panelMode,
            viewingGenomeId: AppState.viewingGenome ? AppState.viewingGenome.id : null,
            selectedGenomeIds: Array.from(AppState.selectedGenomes)
                .map((genome) => genome.id)
                .filter((id) => typeof id === 'string'),
            population: AppState.population.exportState()
        };

        if (!Array.isArray(genomes) || genomes.length === 0) return;
        sessionStorage.setItem(EVOLUTION_STATE_STORAGE_KEY, JSON.stringify(payload));
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
        AppState.panelMode = parsed.panelMode === 'phylogeny' ? 'phylogeny' : 'network';

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
            genome: genome.serialize()
        };
        sessionStorage.setItem(LAB_SEED_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        // Ignore session persistence issues.
    }
}

function initApp() {
    AppState.renderer = new CPPN.CPPNRenderer();
    AppState.visualizer = new CPPN.NetworkVisualizer(document.getElementById('network-svg'));
    AppState.phylogenyVisualizer = new CPPN.PhylogenyVisualizer(document.getElementById('phylogeny-svg'));

    AppState.population = new NEAT.Population(GRID_SIZE);

    setupImageGrid();
    setupEventListeners();

    const restored = restoreAppStateFromSession();
    if (!restored) {
        AppState.population.initialize();
    }

    renderPopulation({ preserveState: restored, persist: false });
    setPanelMode(AppState.panelMode, { persist: false });
    saveAppStateToSession();
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
    document.getElementById('reset-btn').addEventListener('click', handleReset);
    document.getElementById('network-view-btn').addEventListener('click', () => setPanelMode('network'));
    document.getElementById('phylogeny-view-btn').addEventListener('click', () => setPanelMode('phylogeny'));
    document.getElementById('save-genome-btn').addEventListener('click', handleSaveGenome);
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
    AppState.population.initialize();
    renderPopulation();
    updateInspectorVisualization(null);
    saveAppStateToSession();
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
