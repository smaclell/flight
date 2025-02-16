class FlightSimulator {
    constructor() {
        // Scene setup
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(this.renderer.domElement);

        // Add fog
        this.scene.fog = new THREE.Fog(0x87ceeb, 1, 1000);
        this.scene.background = new THREE.Color(0x87ceeb);

        // Flight parameters
        this.speed = 0;
        this.maxSpeed = 2.4;
        this.acceleration = 0.01;
        this.deceleration = 0.005;
        this.rotationSpeed = 0.02;

        // Controls state
        this.keys = {
            w: false,
            a: false,
            s: false,
            d: false,
            ' ': false
        };

        // Initial camera position and rotation
        this.camera.position.set(0, 100, 0);
        this.camera.rotation.order = 'YXZ'; // This order helps prevent gimbal lock

        // Terrain management
        this.terrainChunks = new Map();
        this.chunkSize = 200;
        this.chunksVisible = 5;

        // Add terrain generation parameters
        this.noiseScale = 0.003;  // Slightly decreased for wider features
        this.heightScale = 300;   // Increased for more elevation variation
        this.lakeThreshold = 0.1; // Increased threshold = rarer lakes
        this.lakeSize = 40.0;     // Lakes will be 10x the chunk size

        // Initialize noise
        noise.seed(Math.random());

        this.minClearance = 25; // Minimum distance to maintain above terrain

        // Add tree parameters
        this.treeDensity = 0.0025; // Trees per square unit
        this.treeInstancedMesh = this.createTreeInstancedMesh();

        // Add water parameters
        this.waterLevel = 40;
        this.waterMaterial = new THREE.MeshPhongMaterial({
            color: 0x0077be,      // Bright blue color
            transparent: false,    // Made solid for better visibility
            opacity: 0.8,
            shininess: 100,
            side: THREE.DoubleSide
        });

        this.setupEventListeners();
        this.createInitialTerrain();
        this.animate();
    }

    setupEventListeners() {
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
        window.addEventListener('resize', () => this.handleResize());
    }

    handleKeyDown(e) {
        if (e.key.toLowerCase() in this.keys) {
            this.keys[e.key.toLowerCase()] = true;
        }
    }

    handleKeyUp(e) {
        if (e.key.toLowerCase() in this.keys) {
            this.keys[e.key.toLowerCase()] = false;
        }
    }

    handleResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    createTreeInstancedMesh() {
        // Create a simple cone + cylinder for the tree
        const treeGeometry = new THREE.Group();

        // Tree trunk
        const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.8, 4, 6);
        const trunkMaterial = new THREE.MeshPhongMaterial({ color: 0x4d2926 });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = 2;

        // Tree top
        const topGeometry = new THREE.ConeGeometry(2, 6, 8);
        const topMaterial = new THREE.MeshPhongMaterial({ color: 0x1d4d1d });
        const top = new THREE.Mesh(topGeometry, topMaterial);
        top.position.y = 7;

        // Combine geometries
        const combinedGeometry = new THREE.BufferGeometry();
        const matrices = [];

        trunk.updateMatrix();
        matrices.push(trunk.matrix);
        top.updateMatrix();
        matrices.push(top.matrix);

        return { trunk: trunkGeometry, top: topGeometry, materials: [trunkMaterial, topMaterial] };
    }

    createTerrainChunk(x, z) {
        const geometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, 50, 50);  // Increased resolution
        geometry.rotateX(-Math.PI / 2);

        // Add smooth elevation using Perlin noise
        const vertices = geometry.attributes.position.array;
        const worldX = x * this.chunkSize;
        const worldZ = z * this.chunkSize;

        for (let i = 0; i < vertices.length; i += 3) {
            const vertexX = vertices[i] + worldX;
            const vertexZ = vertices[i + 2] + worldZ;

            // Use multiple layers of noise for more natural looking terrain
            const elevation = this.getElevation(vertexX, vertexZ);
            vertices[i + 1] = elevation;
        }

        // Update normals for better lighting
        geometry.computeVertexNormals();

        const material = new THREE.MeshPhongMaterial({
            color: 0x3c8f3c,
            wireframe: false,
            flatShading: false
        });

        const chunk = new THREE.Mesh(geometry, material);
        chunk.position.set(x * this.chunkSize, 0, z * this.chunkSize);
        this.scene.add(chunk);

        // Check if this chunk should contain a lake
        const chunkCenterX = x * this.chunkSize;
        const chunkCenterZ = z * this.chunkSize;
        const lakeNoise = noise.perlin2(chunkCenterX * 0.001, chunkCenterZ * 0.001);

        if (lakeNoise > this.lakeThreshold) {
            // Create larger water plane for the lake
            const waterGeometry = new THREE.PlaneGeometry(
                this.chunkSize * this.lakeSize,
                this.chunkSize * this.lakeSize,
                1, 1
            );
            waterGeometry.rotateX(-Math.PI / 2);

            const water = new THREE.Mesh(waterGeometry, this.waterMaterial);
            water.position.set(
                x * this.chunkSize,
                this.waterLevel,
                z * this.chunkSize
            );

            // Store water reference with the chunk
            chunk.water = water;
            this.scene.add(water);

            // Create deeper and wider basins for larger lakes
            const vertices = chunk.geometry.attributes.position.array;
            for (let i = 0; i < vertices.length; i += 3) {
                const vertexX = vertices[i] + chunkCenterX;
                const vertexZ = vertices[i + 2] + chunkCenterZ;

                const distanceFromCenter = Math.sqrt(
                    Math.pow((vertexX - chunkCenterX), 2) +
                    Math.pow((vertexZ - chunkCenterZ), 2)
                );

                // Create deeper basins with wider influence
                if (vertices[i + 1] < this.waterLevel + 10) {
                    const smoothFactor = 1 - Math.min(distanceFromCenter / (this.chunkSize * this.lakeSize * 0.5), 1);
                    vertices[i + 1] = Math.min(vertices[i + 1],
                        this.waterLevel - 15 + (smoothFactor * 10)); // Deeper depression
                }
            }

            chunk.geometry.attributes.position.needsUpdate = true;
            chunk.geometry.computeVertexNormals();
        }

        // Add trees to the chunk
        const chunkArea = this.chunkSize * this.chunkSize;
        const numberOfTrees = Math.floor(chunkArea * this.treeDensity);

        for (let i = 0; i < numberOfTrees; i++) {
            // Random position within chunk
            const treeX = (Math.random() - 0.5) * this.chunkSize + x * this.chunkSize;
            const treeZ = (Math.random() - 0.5) * this.chunkSize + z * this.chunkSize;

            // Get elevation at tree position
            const treeY = this.getElevation(treeX, treeZ);

            // Only place trees on relatively flat surfaces
            const slopeCheck1 = this.getElevation(treeX + 1, treeZ);
            const slopeCheck2 = this.getElevation(treeX, treeZ + 1);

            if (Math.abs(slopeCheck1 - treeY) < 2 && Math.abs(slopeCheck2 - treeY) < 2) {
                // Create tree
                const trunk = new THREE.Mesh(
                    this.treeInstancedMesh.trunk,
                    this.treeInstancedMesh.materials[0]
                );
                const top = new THREE.Mesh(
                    this.treeInstancedMesh.top,
                    this.treeInstancedMesh.materials[1]
                );

                trunk.position.set(treeX, treeY, treeZ);
                top.position.set(treeX, treeY + 4, treeZ);

                // Add random rotation around Y axis
                const rotation = Math.random() * Math.PI * 2;
                trunk.rotation.y = rotation;
                top.rotation.y = rotation;

                // Add random scale variation
                const scale = 0.8 + Math.random() * 0.4;
                trunk.scale.set(scale, scale, scale);
                top.scale.set(scale, scale, scale);

                this.scene.add(trunk);
                this.scene.add(top);

                // Store references to remove later
                if (!chunk.trees) chunk.trees = [];
                chunk.trees.push(trunk, top);
            }
        }

        return chunk;
    }

    getElevation(x, z) {
        // Base terrain layer (large features)
        let elevation = noise.perlin2(x * this.noiseScale, z * this.noiseScale);

        // Add multiple octaves of noise with adjusted scales for gentler slopes
        elevation += noise.perlin2(x * this.noiseScale * 2, z * this.noiseScale * 2) * 0.3;  // Reduced from 0.5
        elevation += noise.perlin2(x * this.noiseScale * 4, z * this.noiseScale * 4) * 0.15;  // Reduced from 0.25

        // Normalize and scale
        elevation = (elevation + 1) * 0.5 * this.heightScale;

        return elevation;
    }

    createInitialTerrain() {
        // Add lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        this.scene.add(directionalLight);

        // Create initial chunks
        for (let x = -this.chunksVisible; x <= this.chunksVisible; x++) {
            for (let z = -this.chunksVisible; z <= this.chunksVisible; z++) {
                const chunk = this.createTerrainChunk(x, z);
                this.terrainChunks.set(`${x},${z}`, chunk);
            }
        }
    }

    updateTerrain() {
        const currentChunkX = Math.floor(this.camera.position.x / this.chunkSize);
        const currentChunkZ = Math.floor(this.camera.position.z / this.chunkSize);

        // Check and create new chunks if needed
        for (let x = currentChunkX - this.chunksVisible; x <= currentChunkX + this.chunksVisible; x++) {
            for (let z = currentChunkZ - this.chunksVisible; z <= currentChunkZ + this.chunksVisible; z++) {
                const key = `${x},${z}`;
                if (!this.terrainChunks.has(key)) {
                    const chunk = this.createTerrainChunk(x, z);
                    this.terrainChunks.set(key, chunk);
                }
            }
        }

        // Remove far chunks
        for (const [key, chunk] of this.terrainChunks) {
            const [x, z] = key.split(',').map(Number);
            if (Math.abs(x - currentChunkX) > this.chunksVisible ||
                Math.abs(z - currentChunkZ) > this.chunksVisible) {
                this.scene.remove(chunk);
                if (chunk.trees) {
                    chunk.trees.forEach(tree => this.scene.remove(tree));
                }
                if (chunk.water) {
                    this.scene.remove(chunk.water);
                }
                this.terrainChunks.delete(key);
            }
        }
    }

    updateFlight() {
        // Handle acceleration
        if (this.keys[' ']) {
            this.speed = Math.min(this.speed + this.acceleration, this.maxSpeed);
        } else {
            this.speed = Math.max(this.speed - this.deceleration, 0);
        }

        // Get terrain info before handling rotation
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.camera.quaternion);
        const terrainHeight = this.getElevation(this.camera.position.x, this.camera.position.z);
        const minHeight = terrainHeight + this.minClearance;

        // Limit rotation speed when close to ground
        const heightAboveTerrain = this.camera.position.y - terrainHeight;
        const rotationLimit = Math.min(this.rotationSpeed,
            this.rotationSpeed * (heightAboveTerrain / (this.minClearance * 2)));

        // Handle rotation with limited speed near ground
        if (this.keys.a) this.camera.rotation.y += this.rotationSpeed;
        if (this.keys.d) this.camera.rotation.y -= this.rotationSpeed;
        if (this.keys.s) this.camera.rotation.x -= (heightAboveTerrain < this.minClearance * 2 ? rotationLimit : this.rotationSpeed);
        if (this.keys.w) this.camera.rotation.x += (heightAboveTerrain < this.minClearance * 2 ? rotationLimit : this.rotationSpeed);

        // Limit pitch rotation
        this.camera.rotation.x = Math.max(Math.min(this.camera.rotation.x, Math.PI / 2), -Math.PI / 2);

        // Update position based on direction and speed
        this.camera.position.add(direction.multiplyScalar(this.speed));

        // Maintain minimum height above terrain
        this.camera.position.y = Math.max(this.camera.position.y, minHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.updateFlight();
        this.updateTerrain();
        this.renderer.render(this.scene, this.camera);
    }
}

// Start the simulation
const simulator = new FlightSimulator();