const express = require('express');
const http = require('http');
const path = require('path');
const TokenManager = require('./TokenManager')
const units = require('./units.mjs');
const injectAppLocals = require('./applocals');
const multer = require('multer');
const ScanStore = require("./ScanStore");

const IN_PROD = process.env.NODE_ENV === 'production'
const PORT = IN_PROD ? 80 : 8080

// Configure multer to store files in memory (as a Buffer)
const uploadScan = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: units.MB(30) },
  fileFilter: (req, file, cb) => {
    const isZipMime = file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed';
    const isZipExt = file.originalname.toLowerCase().endsWith('.zip');

    if (isZipMime || isZipExt) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are allowed.'));
    }
  }
});


const scanCachePolicy  = `public, max-age=${units.HOURS(2)}, immutable`
const app = express();
const server = http.createServer(app);

injectAppLocals(app)

const scanStore = new ScanStore({
  scandir: "data/scans",
  scandata: "data/meta.json",
  ttl: units.HOURS(1),
  maxscans: 20
});

const tokenManager = new TokenManager({tokenLifespan: units.HOURS(6) });

app.use((require("cors"))());
app.use((require("cookie-parser"))());

if (IN_PROD) {
  app.enable('view cache')
} else {
  console.log('[EJS] view cache disabled')
  app.disable('view cache')
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());

app.use(express.static(
    'public',
    {
      maxAge: '1d',
      etag: true
    }
));

app.use(express.urlencoded({ extended: true }));


const cookieOptions = {
  httpOnly: true,
  secure: IN_PROD,
  sameSite: IN_PROD ? 'none' : 'lax',
  path: '/'
}

// UTIL FUNCTIONS

function replaceURLRoot(url, newRoot) {
  const query_idx = url.indexOf('?')
  const root_idx = url.indexOf('/', 1)
  if (root_idx === -1) {
    return newRoot;
  }
  return newRoot + url.substring(root_idx, query_idx === -1 ? url.length : query_idx)
}

function trimURLQuery(url) {
  const query_idx = url.indexOf('?')
  if (query_idx === -1) {
    return url
  }
  return url.substring(0, query_idx)
}

function verifyLogin(req) {
  const {username, password} = req.body
  if (username && password === process.env.ADMIN_PASSWORD) {
    return {
      valid: true,
      token:tokenManager.generateToken(username),
      username: username
    }
  }
  return {valid: false}
}

function loggedIn(req) {
  return tokenManager.isValid(req.cookies?._token)
}

function verifyScanRequest({type, onerror}) {
  return (req, res, next) => {
    const {id} = req.params;
    if (type) {
      res.type(type)
    }
    if (!scanStore.scanExists(id)) {
      onerror(res)
    } else {
      next()
    }
  }
}

async function serveScanResource(id, res, resource){
  try {
    const buffer = await scanStore.getResource(id, resource)
    res.set('Cache-Control', scanCachePolicy).send(buffer);
  } catch (err) {
    res.status(500).end()
    console.error(err);
  }
}


function loginGetEndpoint (req, res)  {
  const destinationURL = replaceURLRoot(req.originalUrl, "/manage")
  if (loggedIn(req)) {
    res.redirect(destinationURL)
  } else {
    const destination = !destinationURL.length ||
    destinationURL.length > 100 ?
        null :
        destinationURL.split(/\/+/);

    res.render('login', {
      failed: req.query.failed,
      destItems: destination,
      destURL: trimURLQuery(req.originalUrl),
    })
  }
}


const loginPostEndpoint = (req, res) =>  {
  const verification = verifyLogin(req)

  if (verification.valid) {
    res.cookie('_token', verification.token, cookieOptions)
    res.redirect(replaceURLRoot(req.originalUrl, "/manage"))
  } else {

    res.redirect(req.originalUrl + "?failed=1")
  }
}

////////////////////////////////////////////////////////////////////////////

app.get('/', (req, res) => {
  const username = tokenManager.getUserByToken(req.cookies?._token)

  res.render('index', {
    username: username,
    isAdmin: !!username,
    scans: scanStore
  })
  // main page, display scans as cards
});

app.get('/scan/:id', verifyScanRequest({
  onerror:
      (res) =>  res.redirect('/?from=unknown')
}));


app.get("/scan/:id/data/*name", verifyScanRequest( {
  type: "application/json",
  onerror:
      (res) => res.status(404).end()
}))


app.get('/manage/:id/{*action}', verifyScanRequest({
  onerror:
      (res) =>  res.redirect('/?from=unknown')
}));

app.post('/manage/:id/{*action}', verifyScanRequest({
  onerror:
      (res) =>  res.status(404).end()
}));

app.get('/scan/:id/*resource.png', verifyScanRequest({
  type: 'image/png',
  onerror:
      (res) =>  res.status(404).send('Scan not found')
}));

app.get('/scan/:id', (req, res) => {
  const {id} = req.params;
  const scan = scanStore.getScanInfo(id)
  res.render('scan', {scan})
});

function registerScanRequest({name, resource}) {
  app.get(`/scan/:id/${name}`, async (req, res) => {
    await serveScanResource(req.params.id, res, resource)
  })
}

registerScanRequest({
  name:'preview.png',
  resource: 'preview.png'
})

registerScanRequest({
  name:'map.png',
  resource: 'map.png'
})

registerScanRequest({
  name:'data/readings',
  resource: 'readings.json'
})

registerScanRequest({
  name:'data/session',
  resource: 'session.json'
})

app.get('/about', (req, res) => {
  res.render('about')
})

app.get('/login', loginGetEndpoint)
app.get('/login{/*a}', loginGetEndpoint)

app.post('/login{/*a}', loginPostEndpoint);
app.post('/login', loginPostEndpoint);

app.get('/logout', (req, res) => {
  res.clearCookie('_token').redirect("/")
});

app.get('/manage/*src', (req, res, next) => {
  if (loggedIn(req)) {
    next()
  } else {
    res.redirect(replaceURLRoot(req.originalUrl, "/login"));
  }
});


app.all('/manage/*src', (req, res, next) => {
  if (loggedIn(req)) {
    next()
  } else {
    res.status(401).end()
  }
});


app.get('/manage/upload', (req, res) => {
  const username = tokenManager.getUserByToken(req.cookies._token)
  res.render('upload', {username})
})

function verifyScanSubmission(req) {
  if (!req.file) {
    throw Error('no file uploaded')
  } if (!req.body.title) {
    throw Error("no title specified")
  } if(!req.body.description) {
    throw Error('no description specified')
  }
}

app.post('/manage/upload', uploadScan.single('file'), async (req, res) => {
  let newID;

  try {
    verifyScanSubmission(req)

    newID = await scanStore.processScan(
        {
          archive: req.file.buffer,
          username: tokenManager.getUserByToken(req.cookies._token),
          title: req.body.title,
          description: req.body.description,
        },
    )
  } catch (error) {
    console.error(error)
    return res.status(500).send(error.message)
  }

  res.status(201).redirect(`/scan/${newID}`)
});


app.get('/manage/:id/edit', (req, res) => {
  const {id} = req.params
  const scan = scanStore.getScanInfo(id)
  res.render('edit', {id, scan})
});


if (process.env.DELETION_POLICY === 'allowed') {
  app.post('/manage/:id/delete', async (req, res) => {
    const {id} = req.params
    await scanStore.deleteScan(id)
    res.redirect('/')
  })
} else {
  app.post('/manage/:id/delete', (req, res) => {
    res.status(401).send('Deletion Disallowed By Server Policy<br><a href="/">Home</a>')
  })
}

app.post('/manage/:id/edit', async (req, res) => {
  const {id} = req.params
  const {title, description} = req.body
  await scanStore.modifyScan(id, {title, description})
  res.redirect('/')
});

app.get('*a', (req, res) => {
  res.redirect('/')
});


// Start Server
server.listen(PORT, () => {
  console.log(`Server '${process.env.NODE_ENV}' running on http://localhost:${PORT}`);
});
