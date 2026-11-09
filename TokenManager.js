const crypto = require('crypto');
const TimedMapCache = require('./TimedMapCache')

class TokenManager {
  constructor({tokenLifespan}) {
    this._cache = new TimedMapCache(tokenLifespan);
  }

  [Symbol.iterator]() {
    return this._cache[Symbol.iterator]
  }

  getUserByToken(token) {
    return this._cache.get(token)
  }

  generateToken(user) {
    const uuid = crypto.randomUUID({disableEntropyCache:true})
    const encoded_uuid = Buffer.from(uuid, "utf8").toString("base64");

    this._cache.insert(
        encoded_uuid,
        user,
        this._cache.purgeInterval
    );

    return encoded_uuid;
  }


  isValid(token) {
    return this._cache.has(token);
  }
}

module.exports = TokenManager
