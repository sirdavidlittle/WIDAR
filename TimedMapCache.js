class TimedMapCache {
    constructor(purgeInterval) {
        this.items = new Map()
        this.purgeInterval = purgeInterval // invoke getter
    }

    get purgeInterval() {
        return this._purgeInterval
    }

    set purgeInterval(value) {
        if (value > 0) {
            this._purgeInterval = value
            clearInterval(this._purgeIntervalHandle)
            this._purgeIntervalHandle = value
            setInterval(() => this.purge(), value)
        } else {
            throw Error("invalid purge interval")
        }
    }

    insert(id, item, lifespan) {
        if (this.items.has(id)) {
            throw Error("id already exists in cache")
        }
        this.items.set(id,
            {
                item: item,
                birth: Date.now(),
                lifespan: lifespan
            }
        )
    }

    [Symbol.iterator]() {
        return this.items.entries()
    }

    _getRemoveIfInvalid(id) {
        const item = this.items.get(id)
        if (!item) {
            return null
        }
        if (this.isExpired(item)) {
            this.items.delete(id)
            return null
        }
        return item.item
    }

    has(id) {
        return !!this._getRemoveIfInvalid(id)
    }

    get(id) {
        return this._getRemoveIfInvalid(id)
    }

    isExpired(item) {
        return (Date.now() - item.birth > item.lifespan)
    }

    remove(id) {
        return this.items.delete(id) || null
    }

    purge() {
        for (const [item,key] of this.items.entries()) {
            if (this.isExpired(item)) {
                this.items.delete(key)
            }
        }
    }

}

module.exports = TimedMapCache