const RelativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const AbsoluteTimeFormatter =  new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
})


const _functions = {
// EJS functions

    formatTimeAbsolute (dateMS) {
        return AbsoluteTimeFormatter.format(dateMS)
    },

    previewImage(id) {
        return `/scan/${id}/preview.png`
    },
    formatTimeRelative(dateMS) {
        const now = Date.now()
        const daysAgo = Math.floor((dateMS - now) / 86400000)
        return RelativeTimeFormatter.format(daysAgo, 'day')
    }
}

// injectAppLocals
module.exports = (app) => {
    Object.assign(app.locals, _functions)
}
