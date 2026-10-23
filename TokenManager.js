const crypto = require('crypto');

class TokenManager {
  constructor({tokenLifespan, purgeInterval}) {
    this.tokens = new Map()
    this.tokenLifespan = tokenLifespan
    this.purgeIntervalHandle = setInterval(() => this.purgeTokens(), purgeInterval)
  }

  purgeTokens() {
    for (const token of this.tokens.keys()) {
      session = this.tokens.get(token)
      if (this.isExpired(session)) {
        this.tokens.delete(token)
      }
    }
  }

  getUserByToken(token) {
    if (!token) {
      return null
    }

    return this.tokens.get(token)?.user
  }

  generateToken(user) {
    let uuid;
    do {
      uuid = crypto.randomUUID({disableEntropyCache:true})
    } while (this.tokens.has(uuid))
    const token = Buffer.from(uuid, "utf8").toString("base64");
    this.tokens.set(token, {date:Date.now(), user: user})
    return token;
  }

  isExpired(session) {
    return (Date.now() - session.date > this.tokenLifespan)
  }

  isValid(token) {
    if (!token) {
      return false
    }

    const session = this.tokens.get(token)
    if (!session) {
      return false;
    }

    if (this.isExpired(session)) {
      this.tokens.delete(token)
      return false;
    }

    return true;
  }
}

module.exports = TokenManager
