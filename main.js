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
        this.chunkSize = 300;       // Increased from 200
        this.chunksVisible = 5;     // Reduced since chunks are larger
        this.loadThreshold = 0.7;   // Trigger new chunk loading when 70% through current chunk

        // Add terrain generation parameters
        this.noiseScale = 0.002;    // Decreased for wider features
        this.heightScale = 500;     // Increased significantly for taller mountains
        this.lakeThreshold = 0.1; // Increased threshold = rarer lakes
        this.lakeSize = 40.0;     // Lakes will be 10x the chunk size

        // Initialize noise
        noise.seed(Math.random());

        this.minClearance = 25; // Minimum distance to maintain above terrain

        // Add tree parameters
        this.treeDensity = 0.0007;  // Adjusted for larger chunk size
        this.treeInstancedMesh = this.createTreeInstancedMesh();

        // Add chunk loading queue
        this.chunkLoadQueue = [];
        this.chunksPerFrame = 3;      // Reduced from 6
        this.lookAheadDistance = 4;

        // Add water parameters
        this.waterLevel = 40;
        this.waterMaterial = new THREE.MeshPhongMaterial({
            color: 0x0077be,      // Bright blue color
            transparent: false,    // Made solid for better visibility
            opacity: 0.8,
            shininess: 100,
            side: THREE.DoubleSide
        });

        // Add loading ring parameters
        this.loadingRings = 2;        // Reduced from 3
        this.ringPriorities = [10, 5];   // Simplified priorities

        // Add removal queue
        this.chunkRemovalQueue = [];
        this.removalsPerFrame = 2;  // Process fewer removals than additions

        // Add cloud parameters
        this.clouds = new THREE.Group();
        this.scene.add(this.clouds);
        this.cloudParticles = [];

        // Add cloud spawn parameters
        this.cloudSpawnChance = 0.02;  // 2% chance per frame to spawn new cloud
        this.maxClouds = 30;
        this.cloudSpawnDistance = 2000;

        // Add cloud texture
        this.cloudTexture = this.createCloudTexture();

        this.createInitialClouds();

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
        // Simplified tree geometry with fewer vertices
        const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.8, 4, 4); // Reduced segments
        const topGeometry = new THREE.ConeGeometry(2, 6, 6);              // Reduced segments
        const trunkMaterial = new THREE.MeshPhongMaterial({ color: 0x4d2926 });
        const topMaterial = new THREE.MeshPhongMaterial({ color: 0x1d4d1d });

        return { trunk: trunkGeometry, top: topGeometry, materials: [trunkMaterial, topMaterial] };
    }

    createTerrainChunk(x, z) {
        // Adjust geometry resolution for larger chunks
        const geometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, 40, 40); // Increased from 32,32
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
            flatShading: true
        });

        const chunk = new THREE.Mesh(geometry, material);
        chunk.position.set(x * this.chunkSize, 0, z * this.chunkSize);
        this.scene.add(chunk);

        // Add trees to all visible chunks
        const chunkArea = this.chunkSize * this.chunkSize;
        const numberOfTrees = Math.floor(chunkArea * this.treeDensity);

        for (let i = 0; i < numberOfTrees; i++) {
            // Random position within chunk
            const treeX = (Math.random() - 0.5) * this.chunkSize + x * this.chunkSize;
            const treeZ = (Math.random() - 0.5) * this.chunkSize + z * this.chunkSize;

            // Get elevation at tree position
            const treeY = this.getElevation(treeX, treeZ);

            // Simplified slope check
            const slopeCheck1 = this.getElevation(treeX + 1, treeZ);

            if (Math.abs(slopeCheck1 - treeY) < 3) {
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

                const rotation = Math.random() * Math.PI * 2;
                trunk.rotation.y = rotation;
                top.rotation.y = rotation;

                const scale = 0.9 + Math.random() * 0.2;
                trunk.scale.set(scale, scale, scale);
                top.scale.set(scale, scale, scale);

                this.scene.add(trunk);
                this.scene.add(top);

                if (!chunk.trees) chunk.trees = [];
                chunk.trees.push({ trunk, top });
            }
        }

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

        return chunk;
    }

    getElevation(x, z) {
        // Base terrain layer (large features)
        let elevation = noise.perlin2(x * this.noiseScale, z * this.noiseScale);

        // Add multiple octaves of noise with adjusted scales for more dramatic terrain
        elevation += noise.perlin2(x * this.noiseScale * 2, z * this.noiseScale * 2) * 0.5;   // Increased influence
        elevation += noise.perlin2(x * this.noiseScale * 4, z * this.noiseScale * 4) * 0.25;  // Increased influence
        elevation += noise.perlin2(x * this.noiseScale * 8, z * this.noiseScale * 8) * 0.125; // Added another layer

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
        // Calculate current position in terms of chunks, including fractional part
        const exactChunkX = this.camera.position.x / this.chunkSize;
        const exactChunkZ = this.camera.position.z / this.chunkSize;
        const currentChunkX = Math.floor(exactChunkX);
        const currentChunkZ = Math.floor(exactChunkZ);

        // Calculate progress through current chunk
        const progressX = exactChunkX - currentChunkX;
        const progressZ = exactChunkZ - currentChunkZ;

        // Get flight direction for predictive loading
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.camera.quaternion);
        const predictedX = currentChunkX + Math.round(direction.x * this.lookAheadDistance);
        const predictedZ = currentChunkZ + Math.round(direction.z * this.lookAheadDistance);

        // Queue new chunks if needed, considering progress through current chunk
        for (let x = currentChunkX - this.chunksVisible; x <= currentChunkX + this.chunksVisible; x++) {
            for (let z = currentChunkZ - this.chunksVisible; z <= currentChunkZ + this.chunksVisible; z++) {
                const key = `${x},${z}`;
                if (!this.terrainChunks.has(key) && !this.chunkLoadQueue.some(item => item.key === key)) {
                    const distanceFromCurrent = Math.max(
                        Math.abs(x - currentChunkX),
                        Math.abs(z - currentChunkZ)
                    );

                    // Higher priority when progressing through current chunk
                    let priority = 0;
                    if (direction.x > 0 && progressX > this.loadThreshold) {
                        priority += x > currentChunkX ? 5 : 0;
                    } else if (direction.x < 0 && progressX < (1 - this.loadThreshold)) {
                        priority += x < currentChunkX ? 5 : 0;
                    }
                    if (direction.z > 0 && progressZ > this.loadThreshold) {
                        priority += z > currentChunkZ ? 5 : 0;
                    } else if (direction.z < 0 && progressZ < (1 - this.loadThreshold)) {
                        priority += z < currentChunkZ ? 5 : 0;
                    }

                    // Add base priority calculations
                    const inDirectionCone = Math.abs(x - predictedX) <= 2 &&
                                          Math.abs(z - predictedZ) <= 2;
                    priority += inDirectionCone ? 10 - distanceFromCurrent : -distanceFromCurrent;

                    this.chunkLoadQueue.push({ key, x, z, priority });
                }
            }
        }

        // Queue chunks for removal instead of immediate removal
        for (const [key, chunk] of this.terrainChunks) {
            const [x, z] = key.split(',').map(Number);
            if (Math.abs(x - currentChunkX) > this.chunksVisible ||
                Math.abs(z - currentChunkZ) > this.chunksVisible) {
                if (!this.chunkRemovalQueue.some(item => item.key === key)) {
                    this.chunkRemovalQueue.push({ key, chunk });
                }
            }
        }

        // Process new chunks first
        this.chunkLoadQueue.sort((a, b) => b.priority - a.priority);
        for (let i = 0; i < this.chunksPerFrame && this.chunkLoadQueue.length > 0; i++) {
            const { x, z } = this.chunkLoadQueue.shift();
            const chunk = this.createTerrainChunk(x, z);
            this.terrainChunks.set(`${x},${z}`, chunk);
        }

        // Then process some removals
        for (let i = 0; i < this.removalsPerFrame && this.chunkRemovalQueue.length > 0; i++) {
            const { key, chunk } = this.chunkRemovalQueue.shift();
            this.scene.remove(chunk);
            if (chunk.trees) {
                chunk.trees.forEach(tree => {
                    this.scene.remove(tree.trunk);
                    this.scene.remove(tree.top);
                });
            }
            if (chunk.water) {
                this.scene.remove(chunk.water);
            }
            this.terrainChunks.delete(key);
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

        // Randomly spawn new clouds
        if (Math.random() < this.cloudSpawnChance) {
            this.spawnCloud();
        }

        // Update clouds
        this.cloudParticles.forEach((particle, index) => {
            particle.mesh.position.x += particle.speed * particle.direction.x;
            particle.mesh.position.z += particle.speed * particle.direction.y;

            // Slowly rotate the cloud group for more dynamic movement
            particle.mesh.rotation.y += 0.001;

            const distanceToCamera = new THREE.Vector2(
                particle.mesh.position.x - this.camera.position.x,
                particle.mesh.position.z - this.camera.position.z
            ).length();

            if (distanceToCamera > this.cloudSpawnDistance * 1.5) {
                this.clouds.remove(particle.mesh);
                this.cloudParticles.splice(index, 1);
            }
        });

        this.updateFlight();
        this.updateTerrain();
        this.renderer.render(this.scene, this.camera);
    }

    createInitialClouds() {
        // Create initial set of clouds
        for (let i = 0; i < 20; i++) {
            this.spawnCloud();
        }
    }

    createCloudTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext('2d');

        // Create a radial gradient
        const gradient = context.createRadialGradient(
            canvas.width / 2, canvas.height / 2, 0,
            canvas.width / 2, canvas.height / 2, canvas.width / 2
        );

        // Soft white in the center, fading to transparent
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.6)');
        gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.2)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    spawnCloud() {
        if (this.cloudParticles.length >= this.maxClouds) return;

        const cloudGeometry = new THREE.PlaneGeometry(500, 500);
        const cloudMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
            map: this.cloudTexture,
            depthWrite: false
        });

        // Create multiple layers for more volume
        const cloudGroup = new THREE.Group();
        const layers = 3;

        for (let i = 0; i < layers; i++) {
            const cloudLayer = new THREE.Mesh(cloudGeometry, cloudMaterial.clone());
            cloudLayer.position.y = i * 20; // Stack layers with slight vertical offset
            cloudLayer.rotation.x = Math.PI / 2;

            // Slightly different rotation for each layer
            cloudLayer.rotation.z = Math.random() * Math.PI * 2;

            // Slightly different scale for each layer
            const baseScale = 0.5 + Math.random() * 0.5;
            cloudLayer.scale.set(
                baseScale * (1 - i * 0.1),
                baseScale * (1 - i * 0.1),
                baseScale * (1 - i * 0.1)
            );

            cloudGroup.add(cloudLayer);
        }

        // Position the entire cloud group
        const angle = Math.random() * Math.PI * 2;
        const x = this.camera.position.x + Math.cos(angle) * this.cloudSpawnDistance;
        const z = this.camera.position.z + Math.sin(angle) * this.cloudSpawnDistance;

        cloudGroup.position.set(
            x,
            600 + Math.random() * 400,
            z
        );

        this.clouds.add(cloudGroup);
        this.cloudParticles.push({
            mesh: cloudGroup,
            speed: 0.1 + Math.random() * 0.2,
            direction: new THREE.Vector2(Math.random() - 0.5, Math.random() - 0.5).normalize()
        });
    }
}

// Start the simulation
const simulator = new FlightSimulator();