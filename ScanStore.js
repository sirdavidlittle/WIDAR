const TimedMapCache = require('./TimedMapCache');
const fs = require("node:fs");
const path = require("node:path");
const converter = require("./file_converters");
const asyncfs = fs.promises
const AdmZip = require('adm-zip');
const units = require("./units.mjs");

class ScanStore {
    constructor({scandir, scandata, ttl}) {
        this.scandir = scandir;
        this.scandata = scandata;
        this.ttl = ttl
        let scan_meta;

        try {
            scan_meta = JSON.parse(fs.readFileSync(scandata, 'utf-8'));
            this.scanIDs = new Set(fs.readdirSync(scandir));
        } catch (e) {
            console.error("Failed to load scans data aborting")
            throw e
        }

        this._scanID = scan_meta.sid

        this.scanMeta = new Map()
        for (const scan of scan_meta.scans) {
            this.scanMeta.set(scan.id, scan)
        }
        this.dataCache = new TimedMapCache( ttl )
    }

    static MAX_SAVE_RETRY = 10;
    static SAVE_RETRY_DURATION = units.SECONDS(20);

    async saveData(retries) {
        retries = retries || 0;
        try {
            const scans = [...this.scanMeta.values()]
            const scan_meta = {sid: this._scanID, scans}
            await asyncfs.writeFile(this.scandata, JSON.stringify(scan_meta));
        } catch (e) {
            console.error('[CRITICAL] failed to save scans')
            if (retries < ScanStore.MAX_SAVE_RETRY) {
                console.error('Retrying save in 10 seconds')
                setTimeout(
                    () => this.saveData(retries + 1),
                    ScanStore.SAVE_RETRY_DURATION
                )
            }
        }
    }

    static SCAN_READINGS_PATH = 'readings.json'

    generateNextID() {
        const nextID = (++this._scanID).toString()
        if (this.scanExists(nextID)) {
            throw new Error(`Scan '${nextID}' already exists`)
        }
        this.scanIDs.add(nextID);
        return nextID;
    }

    [Symbol.iterator]() {
        return this.scanMeta.values()
    }

    static EXPECTED_SCAN_FILES = ['map.pgm', 'map.yaml', 'wifi_readings.csv', 'session.json']

    static RETAINED_SCAN_FILES = ['preview.png', 'map.png', 'map.yaml', 'session.json', 'readings.json']

    async processScan({archive, title, description}) {
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

            this.addScanUnsafe({id:scanID, title, description});

        } catch (e) {
            // del failed file
            await this.removeScanFromDisk(scanID);
            throw e;
        }
        await this.saveData()
        return scanID;
    }

    delScanUnsafe(id) {
        this.scanIDs.delete(id);
        this.scanMeta.delete(id);
    }

    addScanUnsafe({id, title, description}) {
        const newScanMeta = {
            id,
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
            void this.dataCache.remove(id)
            this.delScanUnsafe(id)
            await this.saveData()
            return true
        } catch (e) {
            console.error(`Failed to delete scan ${id}`)
            console.error(e)
            return false                    // failed to remove, but don't halt server
        }
    }

    scanExists(id) {
        return id && this.scanIDs.has(id)
    }

    async removeScanFromDisk(id) {
        await asyncfs.rm(this.scanPath(id), { recursive: true, force: true })              // UNSAFE: never call directly w/o validation
    }

    scanPath(id, resource) {
        if (!id) {
            throw Error("[CRITICAL ERROR] attempt to remove scans dir")
        }
        return path.join(this.scandir, id, resource || '')              // UNSAFE: never call directly w/o validation
    }

    async loadScanFromDisk(id) {
        return await asyncfs.readFile(this.scanPath(id, ScanStore.SCAN_READINGS_PATH), "utf8")
    }

    async getScanData(id) {             // possibility to load from disk
        if (this.scanExists(id)) {
            let data = this.dataCache.get(id)
            if (!data) {
                try {
                    data = await this.loadScanFromDisk(id)
                } catch (e) {
                    console.error(`Failed to load scan ${id}`)
                    console.error(e)
                    return null
                }
                this.dataCache.insert(id, data, this.ttl)
                return data
            }
        }

        return null

    }

    getScanInfo(id) {
        const data = this.scanMeta.get(id)
        if (!data) return null
        return data
    }
}


module.exports = ScanStore