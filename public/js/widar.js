import {
    Text,
    BlurFilter,
    Application,
    Assets,
    Graphics,
    Container,
    Sprite,
    Texture,
    CanvasTextMetrics,
    TextStyle,
} from 'https://cdn.jsdelivr.net/npm/pixi.js@8.23.0/dist/pixi.min.mjs';

const erorrBanner = document.getElementById('sim_error');
const overlay = document.getElementById('sim_overlay');
const viewport = document.getElementById('sim_wrapper');

const {PI, sin, cos, floor, max, sqrt, min} = Math

const clamp = (lbound, value, hbound) => {
    return min(max(value, lbound), hbound);
}

///

const config = {
    maxOpacity: .65,
    showLabels: true,
    mapSize: 2048,
    originX: 1024,           // center point of SLAM map
    originY: 1024,           // points are relative to center
    pixelsPerMeter: 40,      // from SLAM scan 
    invertY: true,           // SLAM inverts y-axis
    invertX: false,
    smallscreenWidth:800,
    smallscreenHeight:600,
    rssiMin: -95,            // dBm floor
    rssiMax: -30,            // dBm ceiling
    rssiRadiusMax: 45,
    rssiGradient: [
        0xFF0000, // Very bad - Red
        0xFF4500, // Bad - Orange red
        0xFFA500, // Weak - Orange
        0xFFFF00, // Fair - Yellow
        0x7CFC00, // Good - Lime
        0x049804, // Excellent - Green
    ],
    rssiRadiusMin: 20,
    mapBlurEnabled: true,
    mapBlurPasses: 4,
    mapBlurStrength: .5,
    heatBlur: 0.6,           // blur of heatmap
    background: '#7A7A7A',   // background of texture
    rssiStyle: new TextStyle({
        fontFamily: 'arial',
        fontWeight: 'bold',
        fontSize: 16,
        wordWrap: false,
        fill: '#f87171'
    }),
}

const controls = {
    moveSpeed: 4,
    moveSpeedMultiplier: 2.5,
    rotateSpeed: Math.PI / 70,
    zoomSensitivity: .94,
    zoomMax: 10,
    zoomMin: 0.1,
}

const camera = {
    x: 0,
    y: 0,
    rotation: 0,
    scale: 1
}

config.rssiGradient = config.rssiGradient.map(c =>
{ return {
    r: (c & 0xFF0000) >> 16,
    g: (c & 0xFF00) >> 8,
    b: (c & 0xFF),
    value: c
}})

viewport.style.width = config.smallscreenWidth+'px'
viewport.style.height = config.smallscreenHeight+'px'

const wifi = {}     // assigned after init


// control WiDAR map with keyboard
const keyNavigator = {
    get speedMultiplier() {
        return 1 + this.boosted * controls.moveSpeedMultiplier
    },

    updateCamera() {
        const boost = this.speedMultiplier
        const moveSpeed = controls.moveSpeed * boost
        const rotationSpeed = controls.rotateSpeed * boost
        const zoomSpeed = controls.zoomSensitivity
        camera.x += (this.left - this.right) * moveSpeed;
        camera.y += (this.up - this.down) * moveSpeed;
        const zoomDirection = this.zoomin - this.zoomout
        if (zoomDirection) {
            camera.scale *= zoomDirection > 0 ? 1 / controls.zoomSensitivity : controls.zoomSensitivity
            camera.scale = clamp(controls.zoomMin, camera.scale, controls.zoomMax);
        }
        const rotation= camera.rotation + (this.clockwise - this.counterclockwise) * rotationSpeed;
        set_rotation(rotation)
        window.sim_set_rotation_controls((rotation * 180 / PI) % 360)
    },

    get moving() {
        return  this.counterclockwise || this.clockwise ||
            this.up || this.down ||
            this.left || this.right || this.zoomin || this.zoomout
    },

    animationMutex: false,

    startAnimationCycle(overrideMutex) {
        if (!overrideMutex && this.animationMutex) return;

        if (this.moving) {
            this.updateCamera()
            this.animationMutex = true;
            render()
            requestAnimationFrame(() => this.startAnimationCycle(true));
        } else {
            this.animationMutex = false;
        }
    },

    clearMovement() {
        this.up = false
        this.down = false
        this.left = false
        this.right = false
        this.boosted = false
        this.clockwise = false
        this.counterclockwise = false
        this.zoomin = false
        this.zoomout = false
    },


    update(key, val) {
        switch (key.toLowerCase()) {
            case 'shift':
                this.boosted = val; return true;
            case 'z':
                this.zoomin = val; return true;
            case 'x':
                this.zoomout = val; return true;
            case 'w': case 'Arrowup':
                this.up = val; return true;
            case 's': case 'arrowdown':
                this.down = val; return true;
            case 'a': case 'arrowleft':
                this.left = val; return true;
            case 'd': case 'arrowright':
                this.right = val; return true;
            case 'q':
                this.clockwise = val; return true;
            case 'e':
                this.counterclockwise = val; return true;
            case 'r':
                reset(true);
            default: return false;
        }
    }
}

window.set_label_visbility = function(visible) {
    config.showLabels = visible
    textContainer.visible = visible
    render()
}

window.reset = function (updateDOM) {
    camera.rotation = 0
    const fitScale = min(
        mapCanvas.width / mapCanvas.width,
        mapCanvas.height / mapCanvas.height
    );
    camera.scale = fitScale;
    camera.x = (mapCanvas.width - mapCanvas.width * fitScale) / 2;
    camera.y = (mapCanvas.height - mapCanvas.height * fitScale) / 2;

    if (updateDOM) {
        window.sim_set_rotation_controls(0)
    }
    render();
};

let mapCanvas = null
let app = null
let sceneContainer = null
let textContainer = null
let heatmap = null
let heatmapTexture = null


async function data_init() {
    //debugger
    const wifiJson= await fetch('data/readings')
    const wifiData = await wifiJson.json()
    const indexMap = wifiData.indexMap
    const readings = wifiData.data
    const select = document.getElementById('sim_wifi_selector');

    wifi.indexMap = indexMap
    wifi.readings = readings;

    const ssidGroup = document.getElementById('wifi_ssid');

    const uniqueSsids = new Set();
    const uniqueBssids = new Map(); // bssid -> { ssid, band }

    for (const row of readings) {
        const ssid = row[indexMap.ssid] || '<Hidden>';
        const bssid = row[indexMap.bssid];
        const band = row[indexMap.band];
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

    select.addEventListener('change', e => applyWifiFilter(e.target.value));
}

function events_init() {
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    overlay.addEventListener('mousedown', e => {
        if (e.button !== 0 || window.rotatorDragging) return;
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        mapCanvas.style.cursor = 'grabbing';
    });

    document.addEventListener('keydown', e => {
        const alreadyMoving = keyNavigator.moving;

        if (keyNavigator.update(e.key, true)) {
            e.preventDefault();
            if (!alreadyMoving) {
                keyNavigator.startAnimationCycle(false)
            }
        }
    })


    document.addEventListener('keyup', e => {
        if (keyNavigator.update(e.key, false)) {
            e.preventDefault();
        }
    })

    window.addEventListener('mousemove', e => {
        if (!isDragging || window.rotatorDragging) return;
        camera.x += e.clientX - lastX;
        camera.y += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        render();
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging || window.rotatorDragging) return;
        isDragging = false;
        mapCanvas.style.cursor = 'grab';
    });

    overlay.addEventListener('wheel', e => {
        if (window.rotatorDragging) return;
        e.preventDefault();

        const rect = mapCanvas.getBoundingClientRect();
        // Use app.screen dimensions so coordinates match Pixi's logical pixel space
        const mouseX = (e.clientX - rect.left) * (app.screen.width / rect.width);
        const mouseY = (e.clientY - rect.top) * (app.screen.height / rect.height);

        // Offset mouse coordinates to match camera's origin at the screen center
        const relMouseX = mouseX - app.screen.width / 2;
        const relMouseY = mouseY - app.screen.height / 2;

        const zoomFactor = e.deltaY < 0
            ? controls.zoomSensitivity
            : 1 / controls.zoomSensitivity;
        const newScale = clamp(controls.zoomMin, camera.scale * zoomFactor, controls.zoomMax);
        const ratio = newScale / camera.scale;

        camera.x = relMouseX - (relMouseX - camera.x) * ratio;
        camera.y = relMouseY - (relMouseY - camera.y) * ratio;
        camera.scale = newScale;

        render();
    }, { passive: false });

    document.addEventListener('visibilitychange', () => keyNavigator.clearMovement())
}

async function graphics_init() {
    if (!window.h337) {
        throw new Error("heatmap.js 2.0 API (h337) not detected");
    }

    app = new Application();

    await app.init({
        resizeTo: viewport,
        backgroundColor: config.background,
        antialias: true,
    });

    viewport.appendChild(app.canvas);

    mapCanvas = app.canvas

    // 2. Load the static 2048x2048 background image onto the GPU

    const bgTexture = await Assets.load('./map.png')
    const bgSprite = new Sprite(bgTexture);

    if (config.mapBlurEnabled) {
        const blurFilter = new BlurFilter({
            strength: config.mapBlurStrength,
            quality: config.mapBlurPasses,
        });

        bgSprite.filters = [blurFilter];

    }

    // 3. Create an offscreen heatmap.js v2 instance (never added to the DOM)
    const offscreenDiv = document.createElement('div');

    offscreenDiv.classList.add('offscreen-heatmap');
    offscreenDiv.style.width = config.mapSize+'px'
    offscreenDiv.style.height = config.mapSize+'px'


    document.body.prepend(offscreenDiv);

    heatmap = h337.create({
        container: offscreenDiv,
        width: config.mapSize,   // Required since offscreenDiv is detached (offsetWidth === 0)
        height: config.mapSize,
        blur: config.heatBlur,
        maxOpacity: config.maxOpacity,
    });

    offscreenDiv.remove()

    // Grab the internal canvas created by heatmap.js and wrap it as a GPU texture
    const heatmapCanvas = offscreenDiv.querySelector('canvas');

    heatmapCanvas.width = config.mapSize
    heatmapCanvas.height = config.mapSize

    heatmapTexture = Texture.from(heatmapCanvas);
    const heatmapSprite = new Sprite(heatmapTexture);

    // 4. Group both layers into one transformable GPU container
    sceneContainer = new Container();
    textContainer = new Container();
    sceneContainer.addChild(bgSprite, heatmapSprite, textContainer);

    const basicText = new Text({
        text: 'WIDAR ® 2026',
        style: {
            fontFamily: 'Arial',
            fontSize: 20,
            fill: '#F0F0F0',
        },
    });

    // 3. Position and add to stage
    basicText.x = 14;
    sceneContainer.addChild(basicText);

    // Center the pivot so scaling and rotation happen around the middle of the 2048x2048 image
    sceneContainer.pivot.set(config.mapSize / 2, config.mapSize / 2);
    sceneContainer.position.set(app.screen.width / 2, app.screen.height / 2);

    app.stage.addChild(sceneContainer);

    // 1. Initialize PixiJS (single DOM canvas, GPU-accelerated via WebGPU/WebGL)

    viewport.style.background = config.background;
}

function displayError(message) {
    erorrBanner.textContent = message;
    erorrBanner.classList.remove('hidden');
}

async function init() {
    const try_load = async(fn, err_message)=> {
        try {
            await fn();
        } catch (err) {
            console.error(err)
            displayError(err_message);
            throw err;
        }
    }

    const start = Date.now()
    await try_load(data_init, "error preparing widar data")
    await try_load(graphics_init, "error initializing graphics")
    await try_load(events_init, "error attaching to dom")
    const end = Date.now()

    console.log(`[%cWIDAR%c] initialized in ${end - start}ms`,'color:green;','color:unset;')

    applyWifiFilter()
}

function applyHeatmapDataset(dataPoints) {
    console.log('applied heatmap')

    heatmap.setData({
        max: config.rssiMax - config.rssiMin, // shift rssi index to positive
        min: 0,
        data: dataPoints,
    });

    // Push the updated offscreen canvas pixels to the existing GPU texture
    heatmapTexture.source.update();
}

function render() {
    // Keeps (0, 0) centered in the viewport while pivoting around the middle of the 2048x2048 image
    sceneContainer.position.set(
        app.screen.width / 2 + camera.x,
        app.screen.height / 2 + camera.y
    );
    sceneContainer.rotation = camera.rotation;
    sceneContainer.scale.set(camera.scale);
}

window.set_rotation = function (rotation) {
    const dAngle = rotation - camera.rotation;

    textContainer.children.forEach(child => {
        child.rotation = -rotation;
    })

    const dx = camera.x;
    const dy = camera.y;
    const cosAngle = cos(dAngle);
    const sinAngle = sin(dAngle);

    camera.x = (dx * cosAngle - dy * sinAngle);
    camera.y = (dx * sinAngle + dy * cosAngle);
    camera.rotation = rotation;

    render();
};

function rssiRadius(rssi) {
    // rssi is non-linear, so map to non-linear radius
    // See: https://www.desmos.com/calculator/gwpsiffiex
    const prssi = rssi - config.rssiMin;
    const nrssi = sqrt(60 * prssi) - prssi * 0.25;
    return clamp(config.rssiRadiusMin, nrssi, config.rssiRadiusMax)
}

function addRssiLabel(rssi, x, y) {
    if (!config.showLabels) return

    const {text, color} = rssiDisplay(rssi)


    const label = new Text({
        text: text,
        style: config.rssiStyle,
        roundPixels: true
    })

    label.style.fill = color

    label.resolution = 3;

    const metrics = CanvasTextMetrics.measureText(text, config.rssiStyle)

    const container = new Container();

    container.x = x
    container.y = y - metrics.height * 2.5
    const padding = 8

    if (camera.rotation) {
        container.rotation = -camera.rotation;
    }

    const graphics = new Graphics()
        .roundRect(-padding / 2,  0, metrics.width + padding, metrics.height)
        .fill({ color: 0x000000, alpha: 0.7 })
        .stroke({ width: 2, color: 0xDEADED })

    container.pivot.set(metrics.width / 2, metrics.height / 2)

    container.addChild(graphics, label)
    textContainer.addChild(container)
}

function rssiColor(rssi, gradient = config.rssiGradient) {
    // Clamp percentage between 0 and 100

    // Handle edge cases
    if (rssi <= 0) return gradient[0].value;
    if (rssi >= 1) return gradient[gradient.length - 1].value;

    // Determine which two color stops the percentage falls between
    const value = rssi * gradient.length
    const index = floor(value);
    const intermediate = value - index; // Local percentage between the two stops (0 to 1)

    const c1 = gradient[index]
    const c2 = gradient[min(gradient.length - 1, index + 1)]

    // Linearly interpolate each RGB channel
    const r = floor(c1.r + (c2.r - c1.r) * intermediate);
    const g = floor(c1.g + (c2.g - c1.g) * intermediate);
    const b = floor(c1.b + (c2.b - c1.b) * intermediate);

    return (r << 16) | (g << 8) | b
}


function rssiDisplay(rssi) {
    let x =  (rssi - config.rssiMin) / 65
    return {
        text: Math.round(x * 100).toFixed(1),
        color : rssiColor(x)
    }
}

function normalizeCoordinate(x, y, rssi) {
    const ny = y * config.pixelsPerMeter + config.originY
    const nx = x * config.pixelsPerMeter + config.originX

    return {
        x: config.invertX ? config.mapSize - nx : nx,
        y: config.invertY ? config.mapSize - ny : ny,
        value: rssi - config.rssiMin, // (-95,-30) -> (0, 65)
        radius: rssiRadius(rssi)
    }
}

function applyWifiFilter(filterValue = 'ALL') {
    let heatPoints = [];

    textContainer.removeChildren();

    const {readings, indexMap} = wifi

    if (filterValue === 'ALL') {
        // Select strongest RSSI per scan point.
        const bestByPoint = new Map();

        for (const row of readings) {
            const pid = row[indexMap.point_id];
            const rssi = row[indexMap.rssi_mean];

            const existing = bestByPoint.get(pid);

            if (!existing || rssi > existing.rssi) {
                bestByPoint.set(pid, {
                    x: row[indexMap.x],
                    y: row[indexMap.y],
                    rssi
                });
            }
        }

        for (const pt of bestByPoint.values()) {
            const p = normalizeCoordinate(
                pt.x,
                pt.y,
                pt.rssi
            )
            heatPoints.push(p)
            addRssiLabel(pt.rssi, p.x, p.y)
        }

    } else {
        // Filter by SSID or BSSID.
        const filtered = readings.filter(row => {
            if (filterValue.startsWith('bssid:')) {
                return row[indexMap.bssid] === filterValue.slice(6);
            }

            if (filterValue.startsWith('ssid:')) {
                return (row[indexMap.ssid] || '<Hidden>') ===
                    filterValue.slice(5);
            }

            return row[indexMap.bssid] === filterValue ||
                row[indexMap.ssid] === filterValue;
        });

        heatPoints = filtered.map(row => {
            const px = row[indexMap.x]
            const py = row[indexMap.y]
            const rssi = row[indexMap.rssi_mean]
            const p = normalizeCoordinate(
                px,
                py,
                rssi
            );
            addRssiLabel(rssi, p.x, p.y)
            return p
        });
    }

    applyHeatmapDataset(heatPoints)
}

window.take_snapshot = function() {
    const canvas = viewport.querySelector('canvas')
    if (!canvas) {
        displayError('WiDAR not loaded')
        return
    }

    canvas.toBlob((blob) => {
        if (!blob) return;

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = 'widar.png';
        link.click();

        URL.revokeObjectURL(url);
    }, "image/png");
}

window.set_fullscreen = function(fullscreen) {
    if (fullscreen) {
        viewport.style.width = '100%';
        viewport.style.height = '100%';
    } else {
        viewport.style.width = config.smallscreenWidth+'px'
        viewport.style.height = config.smallscreenHeight+'px'
    }
    setTimeout(() => {
        reset(true)
        render()
    }, 150)
}


// ////////////
keyNavigator.clearMovement()
init()