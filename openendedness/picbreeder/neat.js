/**
 * NEAT Implementation - Based on nbenko1's PicBreeder
 */

const NEAT_CONFIG = {
    populationSize: 20,

    // Initial random structure
    initialHiddenNodesMax: 8,

    // Weight mutation
    weightMutationRate: 0.8,
    weightPerturbRate: 0.9,
    weightPerturbPower: 0.5,

    // Structural mutation - PicBreeder uses 50% rates!
    addNodeRate: 0.5,
    addConnectionRate: 0.5,

    // Weight range
    weightMin: -8,
    weightMax: 8,

    // PicBreeder activation functions
    activationFunctions: ['sigmoid', 'tanh', 'gaussian', 'sin', 'cos', 'abs', 'relu', 'identity']
};

let NEXT_HISTORY_ID = 1;

function getNextHistoryId() {
    return `h${NEXT_HISTORY_ID++}`;
}

function parseHistoryId(historyId) {
    if (typeof historyId !== 'string') return null;
    const match = /^h(\d+)$/.exec(historyId);
    if (!match) return null;
    return Number.parseInt(match[1], 10);
}

function syncNextHistoryIdFromGenome(genome) {
    if (!genome) return;

    const historyCandidates = new Set();
    if (typeof genome.historyId === 'string') historyCandidates.add(genome.historyId);
    for (const parentId of genome.parentHistoryIds || []) {
        if (typeof parentId === 'string') historyCandidates.add(parentId);
    }

    const lineageRecords = genome.lineageRecords || {};
    for (const [recordKey, record] of Object.entries(lineageRecords)) {
        if (typeof recordKey === 'string') historyCandidates.add(recordKey);
        if (record && typeof record.historyId === 'string') historyCandidates.add(record.historyId);
        for (const parentId of record && Array.isArray(record.parentHistoryIds) ? record.parentHistoryIds : []) {
            if (typeof parentId === 'string') historyCandidates.add(parentId);
        }
    }

    let maxSeen = 0;
    for (const historyId of historyCandidates) {
        const parsed = parseHistoryId(historyId);
        if (Number.isInteger(parsed) && parsed > maxSeen) {
            maxSeen = parsed;
        }
    }

    if (maxSeen > 0) {
        NEXT_HISTORY_ID = Math.max(NEXT_HISTORY_ID, maxSeen + 1);
    }
}

class NodeGene {
    constructor(id, type, activation = 'sigmoid') {
        this.id = id;
        this.type = type;
        this.activation = activation;
        this.label = null;
    }

    clone() {
        const n = new NodeGene(this.id, this.type, this.activation);
        n.label = this.label;
        return n;
    }
}

class ConnectionGene {
    constructor(fromId, toId, weight, enabled = true) {
        this.fromId = fromId;
        this.toId = toId;
        this.weight = weight;
        this.enabled = enabled;
    }

    clone() {
        return new ConnectionGene(this.fromId, this.toId, this.weight, this.enabled);
    }
}

class Genome {
    constructor() {
        this.nodes = new Map();
        this.connections = [];
        this.nextNodeId = 0;
        this.id = Math.random().toString(36).substr(2, 9);
        this.historyId = getNextHistoryId();
        this.generation = 1;
        this.parentHistoryIds = [];
        this.lineageRecords = {};
    }

    getNextNodeId() {
        return this.nextNodeId++;
    }

    // PicBreeder-style mapping with explicit bias: x, y, d, bias -> R, G, B
    static createMinimal() {
        const genome = new Genome();

        // Input nodes (bias node is a constant 1.0 input)
        const inputLabels = ['x', 'y', 'd', 'bias'];
        const inputIds = [];
        for (const label of inputLabels) {
            const id = genome.getNextNodeId();
            const node = new NodeGene(id, 'input', 'identity');
            node.label = label;
            genome.nodes.set(id, node);
            inputIds.push(id);
        }

        // Output nodes: R, G, B (identity activation, sigmoid applied later)
        const outputLabels = ['R', 'G', 'B'];
        const outputIds = [];
        for (const label of outputLabels) {
            const id = genome.getNextNodeId();
            const node = new NodeGene(id, 'output', 'identity');
            node.label = label;
            genome.nodes.set(id, node);
            outputIds.push(id);
        }

        // Connect each input to each output
        for (const inId of inputIds) {
            for (const outId of outputIds) {
                const weight = (Math.random() * 2 - 1) * 2;
                genome.connections.push(new ConnectionGene(inId, outId, weight));
            }
        }

        genome.setAsInitial(1);
        return genome;
    }

    // Randomly initialize with hidden node count uniformly sampled from [0, maxInitialHidden].
    static createRandomizedInitial(maxInitialHidden = NEAT_CONFIG.initialHiddenNodesMax) {
        const genome = Genome.createMinimal();
        const maxHidden = Math.max(0, Math.floor(maxInitialHidden));
        const targetHidden = Math.floor(Math.random() * (maxHidden + 1));

        for (let i = 0; i < targetHidden; i++) {
            genome.addRandomNode();
        }

        // Add a few random extra links so higher-node starts are structurally diverse.
        const extraConnections = Math.floor(Math.random() * (targetHidden + 2));
        for (let i = 0; i < extraConnections; i++) {
            genome.addRandomConnection();
        }

        genome.mutateWeights();
        genome.setAsInitial(1);
        return genome;
    }

    serialize() {
        this.updateLineageRecord();

        const lineageRecords = {};
        for (const [historyId, record] of Object.entries(this.lineageRecords || {})) {
            lineageRecords[historyId] = Genome.cloneLineageRecord(record);
        }

        return {
            id: this.id,
            historyId: this.historyId,
            generation: this.generation,
            parentHistoryIds: [...this.parentHistoryIds],
            nextNodeId: this.nextNodeId,
            nodes: this.serializeNodes(),
            connections: this.serializeConnections(),
            lineageRecords
        };
    }

    static deserialize(serializedGenome) {
        if (!serializedGenome || !Array.isArray(serializedGenome.nodes) || !Array.isArray(serializedGenome.connections)) {
            throw new Error('invalid genome serialization');
        }

        const genome = new Genome();
        genome.nodes = new Map();
        genome.connections = [];

        let maxNodeId = -1;
        for (const nodeData of serializedGenome.nodes) {
            if (!Number.isInteger(nodeData.id) || !nodeData.type) continue;
            const activation = typeof nodeData.activation === 'string' ? nodeData.activation : 'sigmoid';
            const node = new NodeGene(nodeData.id, nodeData.type, activation);
            node.label = nodeData.label || null;
            genome.nodes.set(node.id, node);
            if (node.id > maxNodeId) maxNodeId = node.id;
        }

        for (const connData of serializedGenome.connections) {
            if (!Number.isInteger(connData.fromId) || !Number.isInteger(connData.toId)) continue;
            const weight = Number.isFinite(connData.weight) ? connData.weight : 0;
            const enabled = connData.enabled !== false;
            genome.connections.push(new ConnectionGene(connData.fromId, connData.toId, weight, enabled));
        }

        if (genome.nodes.size === 0 || genome.connections.length === 0) {
            throw new Error('genome has no usable nodes/connections');
        }

        genome.nextNodeId = Number.isInteger(serializedGenome.nextNodeId)
            ? serializedGenome.nextNodeId
            : (maxNodeId + 1);
        genome.id = typeof serializedGenome.id === 'string' ? serializedGenome.id : genome.id;
        genome.historyId = typeof serializedGenome.historyId === 'string' ? serializedGenome.historyId : genome.historyId;
        genome.generation = Number.isFinite(serializedGenome.generation) ? serializedGenome.generation : genome.generation;
        genome.parentHistoryIds = Array.isArray(serializedGenome.parentHistoryIds)
            ? serializedGenome.parentHistoryIds.filter((id) => typeof id === 'string')
            : [];

        genome.lineageRecords = {};
        if (serializedGenome.lineageRecords && typeof serializedGenome.lineageRecords === 'object') {
            for (const [historyId, record] of Object.entries(serializedGenome.lineageRecords)) {
                if (!record || typeof record !== 'object') continue;
                const normalizedRecord = {
                    ...record,
                    historyId: typeof record.historyId === 'string' ? record.historyId : historyId
                };
                genome.lineageRecords[historyId] = Genome.cloneLineageRecord(normalizedRecord);
            }
        }

        if (!genome.lineageRecords[genome.historyId]) {
            genome.updateLineageRecord();
        }

        syncNextHistoryIdFromGenome(genome);
        return genome;
    }

    static cloneLineageRecord(record) {
        return {
            historyId: record.historyId,
            genomeId: record.genomeId,
            generation: record.generation,
            parentHistoryIds: Array.isArray(record.parentHistoryIds) ? [...record.parentHistoryIds] : [],
            nodes: Array.isArray(record.nodes) ? record.nodes.map(node => ({ ...node })) : [],
            connections: Array.isArray(record.connections) ? record.connections.map(conn => ({ ...conn })) : []
        };
    }

    static mergeLineageRecordsFromParents(parents) {
        const merged = {};
        for (const parent of parents) {
            if (!parent || !parent.lineageRecords) continue;
            for (const [historyId, record] of Object.entries(parent.lineageRecords)) {
                if (!merged[historyId]) {
                    merged[historyId] = Genome.cloneLineageRecord(record);
                }
            }
        }
        return merged;
    }

    clone() {
        const g = new Genome();
        g.nextNodeId = this.nextNodeId;
        g.id = this.id;
        g.historyId = this.historyId;
        g.generation = this.generation;
        g.parentHistoryIds = [...this.parentHistoryIds];

        for (const [id, node] of this.nodes) {
            g.nodes.set(id, node.clone());
        }

        for (const conn of this.connections) {
            g.connections.push(conn.clone());
        }

        g.lineageRecords = {};
        for (const [historyId, record] of Object.entries(this.lineageRecords)) {
            g.lineageRecords[historyId] = Genome.cloneLineageRecord(record);
        }

        return g;
    }

    serializeNodes() {
        return Array.from(this.nodes.values())
            .map(node => ({
                id: node.id,
                type: node.type,
                activation: node.activation,
                label: node.label
            }))
            .sort((a, b) => a.id - b.id);
    }

    serializeConnections() {
        return this.connections
            .map(conn => ({
                fromId: conn.fromId,
                toId: conn.toId,
                weight: conn.weight,
                enabled: conn.enabled
            }))
            .sort((a, b) => {
                if (a.fromId !== b.fromId) return a.fromId - b.fromId;
                return a.toId - b.toId;
            });
    }

    updateLineageRecord() {
        this.lineageRecords[this.historyId] = {
            historyId: this.historyId,
            genomeId: this.id,
            generation: this.generation,
            parentHistoryIds: [...this.parentHistoryIds],
            nodes: this.serializeNodes(),
            connections: this.serializeConnections()
        };
    }

    setAsInitial(generation = 1) {
        this.generation = generation;
        this.parentHistoryIds = [];
        this.lineageRecords = {};
        this.updateLineageRecord();
    }

    setChildLineage(parents, generation) {
        const uniqueParents = [];
        const seen = new Set();

        for (const parent of parents) {
            if (!parent || !parent.historyId || seen.has(parent.historyId)) continue;
            seen.add(parent.historyId);
            uniqueParents.push(parent);
        }

        this.historyId = getNextHistoryId();
        this.generation = generation;
        this.parentHistoryIds = uniqueParents.map(parent => parent.historyId);
        this.lineageRecords = Genome.mergeLineageRecordsFromParents(uniqueParents);
        this.updateLineageRecord();
    }

    hasConnection(fromId, toId) {
        return this.connections.some(c => c.fromId === fromId && c.toId === toId);
    }

    getNodeLayer(nodeId, memo = new Map(), visiting = new Set()) {
        if (memo.has(nodeId)) return memo.get(nodeId);

        const node = this.nodes.get(nodeId);
        if (!node) {
            memo.set(nodeId, 0);
            return 0;
        }
        if (node.type === 'input') {
            memo.set(nodeId, 0);
            return 0;
        }
        if (visiting.has(nodeId)) {
            // Defensive fallback for accidental recurrent loops.
            memo.set(nodeId, 0);
            return 0;
        }

        visiting.add(nodeId);

        let maxInputLayer = 0;
        for (const conn of this.connections) {
            if (conn.toId === nodeId && conn.enabled) {
                const inputLayer = this.getNodeLayer(conn.fromId, memo, visiting);
                maxInputLayer = Math.max(maxInputLayer, inputLayer + 1);
            }
        }

        visiting.delete(nodeId);
        memo.set(nodeId, maxInputLayer);
        return maxInputLayer;
    }

    mutateWeights() {
        for (const conn of this.connections) {
            if (Math.random() < NEAT_CONFIG.weightMutationRate) {
                if (Math.random() < NEAT_CONFIG.weightPerturbRate) {
                    conn.weight += (Math.random() * 2 - 1) * NEAT_CONFIG.weightPerturbPower;
                } else {
                    conn.weight = (Math.random() * 2 - 1) * NEAT_CONFIG.weightMax;
                }
                conn.weight = Math.max(NEAT_CONFIG.weightMin, Math.min(NEAT_CONFIG.weightMax, conn.weight));
            }
        }
    }

    addRandomNode() {
        const enabledConns = this.connections.filter(c => c.enabled);
        if (enabledConns.length === 0) return;

        const conn = enabledConns[Math.floor(Math.random() * enabledConns.length)];
        conn.enabled = false;

        const newId = this.getNextNodeId();
        const activation = NEAT_CONFIG.activationFunctions[
            Math.floor(Math.random() * NEAT_CONFIG.activationFunctions.length)
        ];

        const newNode = new NodeGene(newId, 'hidden', activation);
        this.nodes.set(newId, newNode);

        this.connections.push(new ConnectionGene(conn.fromId, newId, 1.0));
        this.connections.push(new ConnectionGene(newId, conn.toId, conn.weight));
    }

    addRandomConnection() {
        const nodeList = Array.from(this.nodes.values());

        for (let attempt = 0; attempt < 30; attempt++) {
            const fromNode = nodeList[Math.floor(Math.random() * nodeList.length)];
            const toNode = nodeList[Math.floor(Math.random() * nodeList.length)];

            if (fromNode.id === toNode.id) continue;
            if (toNode.type === 'input') continue;
            if (fromNode.type === 'output') continue;

            if (this.hasConnection(fromNode.id, toNode.id)) continue;
            if (this.createsCycle(fromNode.id, toNode.id)) continue;

            const weight = (Math.random() * 2 - 1) * NEAT_CONFIG.weightMax;
            this.connections.push(new ConnectionGene(fromNode.id, toNode.id, weight));
            return;
        }
    }

    createsCycle(fromId, toId) {
        if (fromId === toId) return true;

        const stack = [toId];
        const visited = new Set();

        while (stack.length > 0) {
            const nodeId = stack.pop();
            if (nodeId === fromId) return true;
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);

            for (const conn of this.connections) {
                if (!conn.enabled) continue;
                if (conn.fromId === nodeId) {
                    stack.push(conn.toId);
                }
            }
        }

        return false;
    }

    mutate() {
        this.mutateWeights();

        // PicBreeder uses 50% chance for structural mutations
        if (Math.random() < NEAT_CONFIG.addNodeRate) {
            this.addRandomNode();
        }

        if (Math.random() < NEAT_CONFIG.addConnectionRate) {
            this.addRandomConnection();
        }
    }

    static crossover(parent1, parent2) {
        const child = new Genome();
        child.nextNodeId = Math.max(parent1.nextNodeId, parent2.nextNodeId);

        for (const [id, node] of parent1.nodes) {
            child.nodes.set(id, node.clone());
        }
        for (const [id, node] of parent2.nodes) {
            if (!child.nodes.has(id)) {
                child.nodes.set(id, node.clone());
            }
        }

        const p1Conns = new Map();
        for (const conn of parent1.connections) {
            p1Conns.set(`${conn.fromId}-${conn.toId}`, conn);
        }

        const p2Conns = new Map();
        for (const conn of parent2.connections) {
            p2Conns.set(`${conn.fromId}-${conn.toId}`, conn);
        }

        const allKeys = new Set([...p1Conns.keys(), ...p2Conns.keys()]);

        for (const key of allKeys) {
            const c1 = p1Conns.get(key);
            const c2 = p2Conns.get(key);
            let chosen = null;

            if (c1 && c2) {
                chosen = Math.random() < 0.5 ? c1 : c2;
            } else if (c1) {
                chosen = c1;
            } else if (c2) {
                chosen = c2;
            }

            if (!chosen) continue;

            const candidate = chosen.clone();
            if (candidate.enabled && child.createsCycle(candidate.fromId, candidate.toId)) {
                continue;
            }

            child.connections.push(candidate);
        }

        return child;
    }

    getStats() {
        const hiddenNodes = Array.from(this.nodes.values()).filter(n => n.type === 'hidden');
        const enabledConns = this.connections.filter(c => c.enabled);
        return {
            totalNodes: this.nodes.size,
            hiddenNodes: hiddenNodes.length,
            totalConnections: this.connections.length,
            enabledConnections: enabledConns.length,
            inputNodes: Array.from(this.nodes.values()).filter(n => n.type === 'input').length,
            outputNodes: Array.from(this.nodes.values()).filter(n => n.type === 'output').length
        };
    }

    getLineageGraph() {
        const records = this.lineageRecords || {};
        const visited = new Set();
        const nodes = [];
        const edges = [];
        const stack = [this.historyId];

        while (stack.length > 0) {
            const historyId = stack.pop();
            if (!historyId || visited.has(historyId)) continue;
            visited.add(historyId);

            const record = records[historyId];
            if (!record) continue;

            nodes.push(Genome.cloneLineageRecord(record));

            for (const parentId of record.parentHistoryIds || []) {
                if (!parentId) continue;
                edges.push({ from: parentId, to: historyId });
                if (!visited.has(parentId)) {
                    stack.push(parentId);
                }
            }
        }

        return {
            currentHistoryId: this.historyId,
            nodes,
            edges
        };
    }

    getLineageStats() {
        const graph = this.getLineageGraph();
        const totalNodes = graph.nodes.length;
        const totalEdges = graph.edges.length;
        const ancestorCount = Math.max(totalNodes - 1, 0);
        const roots = graph.nodes.filter(node => (node.parentHistoryIds || []).length === 0);
        const generations = graph.nodes
            .map(node => node.generation)
            .filter(generation => Number.isFinite(generation));

        const minGeneration = generations.length > 0 ? Math.min(...generations) : this.generation;
        const maxGeneration = generations.length > 0 ? Math.max(...generations) : this.generation;
        const depth = maxGeneration - minGeneration + 1;

        return {
            totalNodes,
            totalEdges,
            ancestorCount,
            rootCount: roots.length,
            minGeneration,
            maxGeneration,
            depth
        };
    }

    exportWithLineage() {
        this.updateLineageRecord();

        const graph = this.getLineageGraph();
        const records = {};
        for (const node of graph.nodes) {
            records[node.historyId] = Genome.cloneLineageRecord(node);
        }

        return {
            format: 'cppn-lineage-v1',
            exportedAt: new Date().toISOString(),
            genome: {
                id: this.id,
                historyId: this.historyId,
                generation: this.generation,
                parentHistoryIds: [...this.parentHistoryIds],
                nextNodeId: this.nextNodeId,
                nodes: this.serializeNodes(),
                connections: this.serializeConnections()
            },
            lineage: {
                currentHistoryId: this.historyId,
                nodeCount: graph.nodes.length,
                edgeCount: graph.edges.length,
                records
            }
        };
    }

    getLayers() {
        const layerMemo = new Map();
        const layers = new Map();

        for (const node of this.nodes.values()) {
            let layer;
            if (node.type === 'input') {
                layer = 0;
            } else if (node.type === 'output') {
                layer = 1000;
            } else {
                layer = this.getNodeLayer(node.id, layerMemo);
            }

            if (!layers.has(layer)) {
                layers.set(layer, []);
            }
            layers.get(layer).push(node);
        }

        return Array.from(layers.entries())
            .sort(([a], [b]) => a - b)
            .map(([layer, nodes]) => ({ layer, nodes }));
    }
}

class Population {
    constructor(size = NEAT_CONFIG.populationSize) {
        this.size = size;
        this.genomes = [];
        this.generation = 1;
    }

    initialize() {
        this.genomes = [];
        this.generation = 1;

        for (let i = 0; i < this.size; i++) {
            const genome = Genome.createRandomizedInitial(NEAT_CONFIG.initialHiddenNodesMax);
            genome.id = Math.random().toString(36).substr(2, 9);
            genome.setAsInitial(this.generation);
            this.genomes.push(genome);
        }
    }

    evolve(selectedParents) {
        if (selectedParents.length === 0) {
            return;
        }

        const newGenomes = [];
        const nextGeneration = this.generation + 1;

        // Elitism: keep selected parents unchanged
        for (const parent of selectedParents) {
            if (newGenomes.length >= this.size) break;
            const clone = parent.clone();
            clone.id = parent.id;
            newGenomes.push(clone);
        }

        // Fill rest with offspring
        while (newGenomes.length < this.size) {
            const p1 = selectedParents[Math.floor(Math.random() * selectedParents.length)];
            const p2 = selectedParents[Math.floor(Math.random() * selectedParents.length)];

            let child;
            if (p1 === p2 || Math.random() < 0.25) {
                child = p1.clone();
            } else {
                child = Genome.crossover(p1, p2);
            }

            child.mutate();
            child.id = Math.random().toString(36).substr(2, 9);
            child.setChildLineage([p1, p2], nextGeneration);
            newGenomes.push(child);
        }

        this.genomes = newGenomes;
        this.generation = nextGeneration;
    }

    getGenomes() {
        return this.genomes;
    }

    exportState() {
        return {
            format: 'cppn-population-v1',
            exportedAt: new Date().toISOString(),
            size: this.size,
            generation: this.generation,
            genomes: this.genomes.map((genome) => genome.serialize())
        };
    }

    importState(state) {
        const restored = Population.fromState(state);
        this.size = restored.size;
        this.generation = restored.generation;
        this.genomes = restored.genomes;
    }

    static fromState(state) {
        if (!state || !Array.isArray(state.genomes) || state.genomes.length === 0) {
            throw new Error('invalid population state');
        }

        const size = Number.isInteger(state.size) && state.size > 0
            ? state.size
            : state.genomes.length;
        const population = new Population(size);
        population.generation = Number.isInteger(state.generation) && state.generation > 0
            ? state.generation
            : 1;
        population.genomes = state.genomes.map((serializedGenome) => Genome.deserialize(serializedGenome));
        return population;
    }
}

window.NEAT = {
    NodeGene,
    ConnectionGene,
    Genome,
    Population,
    CONFIG: NEAT_CONFIG
};
