const fs = require("node:fs");
const path = require("node:path");
const converter = require("./file_converters");
const asyncfs = fs.promises
const AdmZip = require('adm-zip');
const units = require("./units.mjs");
const {LRUCache} = require('lru-cache');


const MAX_SAVE_RETRY = 10;
const SAVE_RETRY_DURATION = units.SECONDS(20);


class ScanStore {
    constructor({scandir, scandata, ttl, maxscans}) {
        this.scandir = scandir;
        this.scandata = scandata;

        try {
            const rawScanMeta = JSON.parse(fs.readFileSync(scandata, 'utf-8'));
            this._scanID = rawScanMeta.sid

            this.scanMeta = new Map()
            for (const scan of rawScanMeta.scans) {
                this.scanMeta.set(scan.id, scan)
            }
            for (const scanID of fs.readdirSync(scandir)) {
                if (!(this.scanMeta.has(scanID))) {
                    const scan_path = this.scanPath(scanID, '')
                    const scanEntries = fs.readdirSync(scan_path)
                    if (scanEntries.length === 0) {
                        fs.rmSync(this.scanPath(scanID, ''))
                    }
                    throw Error(`scan #${scanID} found in FS, but not registered meta`);
                }
            }

        } catch (e) {
            console.error("Failed to load scans, please resolve before booting server!")
            throw e
        }

        this.dataCache = new LRUCache({
            max: maxscans,
            ttl: ttl,
            allowStale: false,
            dispose: (buffer) => {
                buffer.dispose?.()
            },
        });
    }

    async saveData(retries) {
        retries = retries || 0;
        try {
            const scans = [...this.scanMeta.values()]
            const scan_meta = {sid: this._scanID, scans}
            await asyncfs.writeFile(this.scandata, JSON.stringify(scan_meta));
        } catch (e) {
            console.error('[CRITICAL] failed to save scans')
            if (retries < MAX_SAVE_RETRY) {
                console.error('Retrying save in 10 seconds')
                setTimeout(
                    () => this.saveData(retries + 1),
                    SAVE_RETRY_DURATION
                )
            }
        }
    }

    generateNextID() {
        const nextID = (++this._scanID).toString()
        if (this.scanExists(nextID)) {
            throw new Error(`Scan '${nextID}' already exists`)
        }
        return nextID;
    }

    [Symbol.iterator]() {
        return this.scanMeta.values()
    }

    static EXPECTED_SCAN_FILES = ['map.pgm', 'map.yaml', 'wifi_readings.csv', 'session.json']

    static RETAINED_SCAN_FILES = ['preview.png', 'map.png', 'map.yaml', 'session.json', 'readings.json']

    async processScan({archive, title, description, username}) {
        const files = new AdmZip(archive).getEntries();

        const scanFileBuffers = new Map();

        files.forEach((entry) => {
            if (!entry.isDirectory) {
                scanFileBuffers.set(entry.entryName, entry.getData());
            }
        });

        for (const expectedFile of ScanStore.EXPECTED_SCAN_FILES) {
            if (!scanFileBuffers.has(expectedFile)) {
                throw new Error(`missing required file '${expectedFile}'`)
            }
        }

        const scanID = this.generateNextID()

        const currentScanDir = path.join(this.scandir, scanID)
        await asyncfs.mkdir(currentScanDir);

        try {
            // convert to PNG and save buffer

            const PGMBuffer = scanFileBuffers.get('map.pgm');
            const PNGBuffer = await converter.PGMtoPNG(PGMBuffer)
            const PNGPreviewBuffer = await converter.PNGtoPreview(
                PNGBuffer,
                {ratio: 0.45, size: 360}
            )
            scanFileBuffers.set('map.png', PNGBuffer)
            scanFileBuffers.set('preview.png', PNGPreviewBuffer)

            // convert CSV to JSON

            const CSVReadings = scanFileBuffers.get('wifi_readings.csv')
            const JSONReadings = await converter.CSVtoObjectArray(CSVReadings);
            scanFileBuffers.set('readings.json', JSON.stringify(JSONReadings));


            // save new files


            for (const retainedFile of ScanStore.RETAINED_SCAN_FILES) {
                const filePath = path.join(currentScanDir, retainedFile);
                const fileData = scanFileBuffers.get(retainedFile);
                await asyncfs.writeFile(filePath, fileData);
            }


            this.addScanSession({id:scanID, uploader:username, title, description});

        } catch (e) {
            // del failed file
            await this.removeScanFromDisk(scanID);
            throw e;
        } finally {
            for (const buffer of scanFileBuffers.values()) {
                buffer.dispose?.()
            }
        }
        await this.saveData()
        return scanID;
    }


    addScanSession({id, title, description, uploader}) {
        const newScanMeta = {
            id,
            uploader,
            title,
            description,
            time: Date.now(),
        }

        this.scanMeta.set(id, newScanMeta);
    }

    async modifyScan(id, {title, description}) {
     const scanMeta = this.getScanInfo(id)
     title && (scanMeta.title = title);
     description && (scanMeta.description = description);
     await this.saveData();
    }

    async deleteScan(id) {
        try {

            await this.removeScanFromDisk(id)
            void this.dataCache.delete(id)
            this.scanMeta.delete(id)
            await this.saveData()
            return true
        } catch (e) {
            console.error(`Failed to delete scan ${id}`)
            console.error(e)
            return false                    // failed to remove, but don't halt server
        }
    }

    scanExists(id) {
        return id && this.scanMeta.has(id)
    }

    async removeScanFromDisk(id) {
        await asyncfs.rm(this.scanPath(id), { recursive: true, force: true })              // UNSAFE: never call directly w/o validation
    }

    scanPath(id, resource) {
        if (!id) {
            throw Error("[CRITICAL ERROR] attempt to load scan with malformed id")
        }
        return path.join(this.scandir, id, resource || '')              // UNSAFE: never call directly w/o validation
    }

    getScanInfo(id) {
        const data = this.scanMeta.get(id)
        if (!data) return null
        return data
    }

    getCacheResource(id, resource) {
        const cacheEntry = this.dataCache.get(id)
        if (!cacheEntry || !(resource in cacheEntry)) {
            return null
        }
        return cacheEntry[resource]
    }

    async loadResourceAndCache(id, resource) {
        const scanPath = this.scanPath(id, resource);
        const item = await asyncfs.readFile(scanPath);
        if (this.dataCache.has(id)) {
            this.dataCache.get(id)[resource] = item;
        } else {
            this.dataCache.set(id, {[resource]:item})
        }
        return item
    }

    async getResource(id, resource) {
        let item = this.getCacheResource(id, resource)
        if (item) {
            console.log(`[cacher] from cache #${id}/${resource}`)
            return item
        } else {
            try {
                console.log(`[cacher] from disk #${id}/${resource}`)
                item = await this.loadResourceAndCache(id, resource)
                return item
            } catch (err) {
                console.error(err);
                throw err
            }
        }
    }
}


module.exports = ScanStore