const TimedMapCache = require('./TimedMapCache');
const timeunits = require('./timeunits.mjs');
const fs = require("node:fs");
const path = require("node:path");
const asyncfs = fs.promises

// const READINGS_NAME = 'wifi_readings.json'
const READINGS_NAME = 'session.json'

class ScanStore {
    constructor({scandir, scandata, ttl}) {
        this.scandir = scandir;
        this.scandata = scandata;
        this.ttl = ttl
        let scans;

        try {
            scans = JSON.parse(fs.readFileSync(scandata, 'utf-8'));
            this.scanIDs = new Set(fs.readdirSync(scandir));
        } catch (e) {
            console.error("Failed to load scans data aborting")
            throw e
        }

        this.scanMeta = new Map()
        for (const scan of scans) {
            this.scanMeta.set(scan.id, scan)
        }
        this.dataCache = new TimedMapCache( ttl )
    }

    [Symbol.iterator]() {
        return this.scanMeta.values()
    }

    async submitScan(scan, data) {

    }

    async deleteScan(id) {
        if (this.scanExists(id)) {
            try {
                await this.removeScanFromDisk(id)
                this.dataCache.remove(id)
            } catch (e) {
                console.error(`Failed to delete scan ${id}`)
                console.error(e)
                return false                    // failed to remove, but don't halt server
            }
            return true                         // sucess
        }
        return null                             // never existed
    }

    scanExists(id) {
        return id && this.scanIDs.has(id)
    }

    async removeScanFromDisk(id) {
        await asyncfs.rmdir(this.scanPath(id))              // UNSAFE: never call directly w/o validation
    }

    scanPath(id, resource) {
        return path.join(this.scandir, id, resource)              // UNSAFE: never call directly w/o validation
    }

    async loadScanFromDisk(id) {
        return await asyncfs.readFile(this.scanPath(id, READINGS_NAME), "utf8")
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