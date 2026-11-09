const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const TokenManager = require('./TokenManager.js')
const ejs = require('ejs');
const ffmpeg = require('ffmpeg');
const timeunits = require('./timeunits.mjs');
const ScanStore = require("./ScanStore");


const app = express();
const server = http.createServer(app);

const RelativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const AbsoluteTimeFormatter =  new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
})

// EJS functions
app.locals.formatTimeAbsolute = (dateMS) => {
  return AbsoluteTimeFormatter.format(dateMS)
}

app.locals.formatTimeRelative = (dateMS) => {
  const now = Date.now()
  const daysAgo = Math.floor((dateMS - now) / (1000 * 60 * 60 * 24));
  return RelativeTimeFormatter.format(daysAgo, 'day')
}

const scanStore = new ScanStore({
  scandir: "./data/scans",
  scandata: "./data/meta.json"
});

const tokenManager = new TokenManager({tokenLifespan: timeunits.HOURS(6) });

app.use((require("cors"))());
app.use((require("cookie-parser"))());

// const scansPath = path.join(__dirname, process.env.DATA_DIR);

// app.enable('view cache')
app.disable('view cache')
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.set('views', path.join(__dirname, 'views'));


const cookieOptions = {
  httpOnly: true,
  secure: process.env.PROD,
  sameSite: process.env.PROD ? 'none' : 'lax',
  path: '/'
}

function verifyLogin(req) {
  const username = req.body?.username
  const password = req.body?.password
  if (username && password === process.env.ADMIN_PASSWORD) {
    return {valid: true, token:tokenManager.generateToken(username), username: username}
  }
  return {valid: false}
}

function loggedIn(req) {
  return tokenManager.isValid(req.cookies?._token)
}

app.get('/', (req, res) => {
  username = tokenManager.getUserByToken(req.cookies?._token)
  res.render('index', {
    username: username,
    isAdmin: !!username,
    scans: scanStore
  })
  // main page, display scans as cards
});

// data/file APIs
app.get('/scan/:id', (req, res, next) => {
  const id = parseInt(req.params.id);

  if (!id) {
    next()
  }

  const scan = scanStore.getScanInfo(id)

  if (!scan) {
    res.status(404).send(`No such scan ${id}`)
  } else {
    res.render('scan', {
      scan: scan
    });
  }
});

app.get('/scan/:id/data', (req, res) => {
  // const id = req.params.id;
  // const data = scanStore.getScanData(id)
  // TODO
  res.status(501).send('???')
});

app.get('/scan/:id/img', (req, res) => {
  // TODO
  res.status(501).send('???')

  // if (assetName) {
  //   res.sendFile(path.join(scansPath, path.basename(req.params.id), assetName),
  //   (err) => {
  //     res.status(404).send()
  //   });
  // } else {
  //   res.status(400).send()
  // }
});

const loginEndpoint = (req, res) =>  {
  const destinationURL = req.originalUrl.slice('/login'.length)
  if (loggedIn(req)) {
    res.redirect(`/manage${destinationURL}`)
  } else {
    const destination = !destinationURL.length || destinationURL.length > 100 ?
                                 null :
                                 destinationURL.split(/\/+/);

    res.render('login', {
        failed: req.query?.failed,
        destination: destination,
      })
  }
}

app.get('/login', loginEndpoint)
app.get('/login/*mgm', loginEndpoint)

app.post('/login', (req, res) =>  {
  verification = verifyLogin(req)

  if (verification.valid) {
    res.cookie('_token', verification.token, cookieOptions)
    .redirect(`/manage${req.originalUrl.slice('/login'.length)}`)
  } else {
    res.redirect('login?failed=1')
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('_token').redirect("/")
});

app.get('/manage/*src', (req, res, next) => {
  if (loggedIn(req)) {
    next()
  } else {
    res.redirect(`/login${req.originalUrl.slice('/manage'.length)}`);
  }
});

app.all('/manage/*src', (req, res, next) => {
  if (loggedIn(req)) {
    next()
  } else {
    res.status(401).send()
  }
});

function __scan_log(message, req) {
  console.log(`${message} ${req.params.id} [${req.ip}]`)
}

app.post('/manage/:id', (req, res) => {
  __scan_log("Create", req)
  res.status(201).send('created')
  // create a new upload
});

app.get('/manage/:id', (req, res) => {
  __scan_log("fetch", req)
  res.status(200).send('data')
});

app.patch('/manage/:id', (req, res) => {
  // no implement
  __scan_log("Modify", req)
  res.status(200).send('modified')
  // create a new upload
});

app.delete('/manage/:id', (req, res) => {
  __scan_log("(Unimplemented) Delete", req)
  res.status(501).send('modified')
  // delete a scan
})


app.get('/manage/*any', (req, res) =>  {
  res.redirect('/?from=manage');
  // redirect to index
});

app.get('*any', (req, res) => {
  res.redirect('/')
});


// Start Server
server.listen(process.env.PORT, () => {
  console.log(`Server running on http://localhost:${process.env.PORT}`);
});
