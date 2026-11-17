const crypto = require('crypto');
const TimedMapCache = require('./TimedMapCache')

class TokenManager {
  constructor({ttl}) {
    this.timedCache = new TimedMapCache({ttl, onpurge: () => console.log('purged tokens')});
  }

  [Symbol.iterator]() {
    return this.timedCache[Symbol.iterator]
  }

  getUserByToken(token) {
    return this.timedCache.get(token)
  }

  generateToken(user) {
    console.log(user, 'logged in')
    const uuid = crypto.randomUUID({disableEntropyCache:true})
    const encoded_uuid = Buffer.from(uuid, "utf8").toString("base64");

    this.timedCache.set(
        encoded_uuid,
        user,
        this.timedCache.purgeInterval
    );

    return encoded_uuid;
  }


  isValid(token) {
    return this.timedCache.has(token);
  }
}

module.exports = TokenManager
