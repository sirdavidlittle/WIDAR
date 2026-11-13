const canvas = document.getElementById('sim');
// Ensure canvas has non-zero internal resolution
if (!canvas.width || !canvas.height) {
    canvas.width = canvas.clientWidth || 800;
    canvas.height = canvas.clientHeight || 800;
}
/*
const make =(tag, klass, content)=> {
    const e = document.createElement(tag);
    klass && (e.classList = klass);
    if (content) {
        if (content instanceof HTMLElement) {
            e.appendChild(content);
        } else {
            e.textContent = content;
        }
    }
    return e;
}
*/

const sim = {
    config: {
        isMeterCoords: true,     // false if x/y are already 0..2048 pixel coordinates
        originX: 1024,           // Map X pixel corresponding to world x = 0 (center of 2048x2048)
        originY: 1024,           // Map Y pixel corresponding to world y = 0
        pixelsPerMeter: 20,      // e.g., 20 px/m = 0.05 m/px (standard ROS/SLAM map resolution)
        invertY: true,           // true if world +Y points up while canvas +Y points down
        rssiMin: -95,            // dBm floor (maps to 0.05 heat intensity)
        rssiMax: -30,            // dBm ceiling (maps to 1.0 heat intensity)
        heatRadius: 28,          // Heatmap point radius in map pixels
        heatBlur: 22,            // Heatmap blur radius in map pixels
        heatOpacity: 0.65,       // Overlay opacity over map.png
        mapBlur: 0.1,            // blur of pixelated bitmap
        canvasBackground: '#7a7a7a' // color for out-of-bounds canvas region

    },
    controls: {
        zoomSensitivity: .9,
        zoomMax: 30,
        zoomMin: 0.1,
    },

    camera: {
        x: 0,
        y: 0,
        rotation: 0,
        scale: 1
    }
}

async function sim_init_simulation() {
    if (!window.simpleheat) {
        throw Error("SimpleHeat API not detected")
    }


    const mapRes = await fetch('./map.png');
    const readingsRes = await fetch('./data/readings');

    const mapBlob = await mapRes.blob();
    const readingsJson = await readingsRes.json();

    canvas.style.background = sim.config.canvasBackground
    sim.ctx = canvas.getContext('2d');
    sim.mapBitmap = await createImageBitmap(mapBlob);
    sim.dataIndex = readingsJson.indexMap;
    sim.readings = readingsJson.data.filter(row => row[sim.dataIndex.valid]);

    // 4. Offscreen canvas for the 2048x2048 heatmap layer
    sim.heatCanvas = new OffscreenCanvas(
        sim.mapBitmap.width,
        sim.mapBitmap.height,
    );
    //heatCanvas.width = sim.mapBitmap.width;
    //heatCanvas.height = sim.mapBitmap.height;

    sim.heatInstance = window.simpleheat(sim.heatCanvas);

    sim.heatInstance.radius(sim.config.heatRadius, sim.config.heatBlur);
    sim.heatInstance.gradient({
        0.20: '#2b83ba',
        0.45: '#abdda4',
        0.65: '#ffffbf',
        0.85: '#fdae61',
        1.00: '#d7191c'
    });
}

function sim_init_settings() {
    const toolbar = document.getElementById('sim_wifi_settings')
    Object.assign(toolbar.style, {
        top: `${canvas.getBoundingClientRect().top + 12}px`,
        left: `${canvas.getBoundingClientRect().left + 12}px`,
    });

    const select = document.getElementById('sim_wifi_selector');

    const ssidGroup = document.getElementById('wifi_ssid');

    const uniqueSsids = new Set();
    const uniqueBssids = new Map(); // bssid -> { ssid, band }
    for (const row of sim.readings) {
        const ssid = row[sim.dataIndex.ssid] || '<Hidden>';
        const bssid = row[sim.dataIndex.bssid];
        const band = row[sim.dataIndex.band];
        uniqueSsids.add(ssid);
        if (!uniqueBssids.has(bssid)) {
            uniqueBssids.set(bssid, {ssid, band});
        }
    }

    [...uniqueSsids].sort().forEach(ssid => {
        ssidGroup.appendChild(new Option(`SSID: ${ssid}`, `ssid:${ssid}`));
    });

    const bssidGroup = document.getElementById('wifi_bssid');

    [...uniqueBssids.entries()]
        .sort((a, b) => a[1].ssid.localeCompare(b[1].ssid))
        .forEach(([bssid, info]) => {
            bssidGroup.appendChild(
                new Option(`${info.ssid} [${bssid}] (${info.band}GHz)`, `bssid:${bssid}`)
            );
        });

    select.addEventListener('change', e => sim_apply_wifi_filter(e.target.value));

// 8. Mouse drag (pan) & wheel (zoom to cursor) handlers
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', e => {
        if (!isDragging) return;
        sim.camera.x += e.clientX - lastX;
        sim.camera.y += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        sim_render();
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        canvas.style.cursor = 'grab';
    });

    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
        const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);

        const zoomFactor = e.deltaY < 0
            ? sim.controls.zoomSensitivity
            : 1 / sim.controls.zoomSensitivity;
        const newScale = clamp(sim.controls.zoomMin, sim.camera.scale * zoomFactor, sim.controls.zoomMax);

        // Zoom anchored at cursor position
        sim.camera.x = mouseX - (mouseX - sim.camera.x) * (newScale / sim.camera.scale);
        sim.camera.y = mouseY - (mouseY - sim.camera.y) * (newScale / sim.camera.scale);
        sim.camera.scale = newScale;
        sim_render();
    }, {passive: false});
}

const clamp = (min, val, max) => {
    return Math.max(Math.min(max, val), min);
}

function worldToMapPx(x, y) {
    if (!sim.config.isMeterCoords) return [x, y];
    const px = sim.config.originX + x * sim.config.pixelsPerMeter;
    const py = sim.config.originY + (sim.config.invertY ? -y : y) * sim.config.pixelsPerMeter;
    return [px, py];
}

function normalizeRssi(rssi) {
    const clamped = clamp(sim.config.rssiMin, rssi, sim.config.rssiMax);
    return 0.05 + 0.95 * ((clamped - sim.config.rssiMin) / (sim.config.rssiMax - sim.config.rssiMin));
}

function sim_render() {
    sim.ctx.clearRect(0, 0, canvas.width, canvas.height);
    sim.ctx.save();

    // rotation is a value from a user rotation input
    // rotate the canvas relative to it's current position such that navigating the canvas is still the same
    // sim.ctx.rotate(sim.camera.rotation);

    sim.ctx.translate(sim.camera.x, sim.camera.y);
    sim.ctx.rotate(sim.camera.rotation); // Must come AFTER translate, BEFORE scale
    sim.ctx.scale(sim.camera.scale, sim.camera.scale);

    // Draw map background
    sim.ctx.drawImage(sim.mapBitmap, 0, 0);

    // Draw RSSI heatmap overlay
    sim.ctx.globalAlpha = sim.config.heatOpacity;
    sim.ctx.drawImage(sim.heatCanvas, 0, 0);

    sim.ctx.restore();
}


window.sim_rotation_callback = function (rotationRad) {
    const dAngle = rotationRad - sim.camera.rotation;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    const dx = sim.camera.x - cx;
    const dy = sim.camera.y - cy;
    const cos = Math.cos(dAngle);
    const sin = Math.sin(dAngle);

    sim.camera.x = cx + (dx * cos - dy * sin);
    sim.camera.y = cy + (dx * sin + dy * cos);
    sim.camera.rotation = rotationRad;

    sim_render();
};

window.sim_reset_callback = function () {
    const fitScale = Math.min(
        canvas.width / sim.mapBitmap.width,
        canvas.height / sim.mapBitmap.height
    );
    sim.camera.scale = fitScale;
    sim.camera.x = (canvas.width - sim.mapBitmap.width * fitScale) / 2;
    sim.camera.y = (canvas.height - sim.mapBitmap.height * fitScale) / 2;
    sim_render();
};

// 6. Build heatmap data for "ALL" or a specific BSSID/SSID
function sim_apply_wifi_filter(filterValue = 'ALL') {
    let heatPoints = [];

    if (filterValue === 'ALL') {
        // Take the strongest RSSI per scan point_id so multiple APs at the
        // same coordinate don't artificially sum into false hot spots
        const bestByPoint = new Map();
        for (const row of sim.readings) {
            const pid = row[sim.dataIndex.point_id];
            const rssi = row[sim.dataIndex.rssi_mean];
            const existing = bestByPoint.get(pid);
            if (!existing || rssi > existing.rssi) {
                bestByPoint.set(pid, {
                    x: row[sim.dataIndex.x],
                    y: row[sim.dataIndex.y],
                    rssi
                });
            }
        }
        for (const pt of bestByPoint.values()) {
            const [px, py] = worldToMapPx(pt.x, pt.y);
            heatPoints.push([px, py, normalizeRssi(pt.rssi)]);
        }
    } else {
        // Match either exact BSSID (prefixed "bssid:") or SSID (prefixed "ssid:")
        const filtered = sim.readings.filter(row => {
            if (filterValue.startsWith('bssid:')) {
                return row[sim.dataIndex.bssid] === filterValue.slice(6);
            }
            if (filterValue.startsWith('ssid:')) {
                return (row[sim.dataIndex.ssid] || '<Hidden>') === filterValue.slice(5);
            }
            return row[sim.dataIndex.bssid] === filterValue || row[sim.dataIndex.ssid] === filterValue;
        });

        heatPoints = filtered.map(row => {
            const [px, py] = worldToMapPx(row[sim.dataIndex.x], row[sim.dataIndex.y]);
            return [px, py, normalizeRssi(row[sim.dataIndex.rssi_mean])];
        });
    }

    sim.heatInstance.data(heatPoints).max(1.0).draw(0.02);
    sim_render();
}

// Expose programmatic filter helper on window if needed


sim_init_simulation().then(
    () => {
        sim_init_settings()
        sim_apply_wifi_filter('ALL');
        sim_reset_position()
    },
    (err) => {
        console.log(err);
    }
);