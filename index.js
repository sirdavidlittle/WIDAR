const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const TokenManager = require('./TokenManager')
const units = require('./units.mjs');
const injectAppLocals = require('./applocals');
const multer = require('multer');

const ScanStore = require("./ScanStore");
const { LRUCache } = require('lru-cache');
const asyncfs = fs.promises

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

const imageCache = new LRUCache({
  max: 500,
  ttl: units.MINUTES(50)
});

const scanCachePolicy  = `public, max-age=${units.HOURS(2)}, immutable`

const app = express();
const server = http.createServer(app);

injectAppLocals(app)

const scanStore = new ScanStore({
  scandir: "data/scans",
  scandata: "data/meta.json",
  ttl: units.HOURS(2),
});

const tokenManager = new TokenManager({tokenLifespan: units.HOURS(6) });

app.use((require("cors"))());
app.use((require("cookie-parser"))());



// app.enable('view cache')
app.disable('view cache')

app.use(express.json());

app.use(express.static('public', {
  maxAge: '1d',
  etag: true
}));

app.use(express.static('data/scans', {
  maxAge: '1d', // Cache in browser for 1 day
  etag: true    // Enable ETag validation
}));

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
  const {username, password} = req.body
  // TODO ACTUAL AUTH
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

app.get('/', (req, res) => {
  const username = tokenManager.getUserByToken(req.cookies?._token)

  res.render('index', {
    username: username,
    isAdmin: !!username,
    scans: scanStore
  })
  // main page, display scans as cards
});

// data/file APIs
app.get('/scan/:id', (req, res, next) => {
  const id = req.params.id;

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

app.get('/scan/:id/*resource', (req, res, next) => {
  const id = req.params.id;
  if (!scanStore.scanExists(id)) {
   res.status(404).send()
  } else {
    next()
  }
})

async function imageHandler(id, resource, res) {
  let buffer;
  res.type('image/png');

  if (imageCache.has(id)) {
    console.log(`[cacher] from cache #${id}`)
    buffer = imageCache.get(id);
  } else {
    try {
      const scanPath = scanStore.scanPath(id, resource);
      buffer = await asyncfs.readFile(scanPath);
      imageCache.set(id, buffer);
      console.log(`[cacher] from disk #${id}`)
    } catch (err) {
      console.error(err);
      return res.status(500).send(err)
    }
  }
  res.set('Cache-Control', scanCachePolicy)
  res.send(buffer)
}

app.get('/scan/:id/preview.png',
    async (req, res)=>
        await imageHandler(
            req.params.id,
            "preview.png",
            res
        )
)

app.get('/scan/:id/map.png',
    async (req, res)=>
        await imageHandler(
            req.params.id,
            "map.png",
            res
        )
)

app.get('/scan/:id/data', async (req, res) => {
  const id = req.params.id;

  const data = await scanStore.getScanData(id)

  if (data==null) {
    return res.status(404).send()
  }

  res.set('Cache-Control', scanCachePolicy)
  res.type('application/json').send(data)
});

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

const loginGetEndpoint = (req, res) =>  {
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

app.get('/about', (req, res) => {
  res.render('about')
})

app.get('/login', loginGetEndpoint)
app.get('/login/*a', loginGetEndpoint)

app.post('/login/*a', loginPostEndpoint);
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
    res.status(401).send()
  }
});


app.get('/manage/upload', (req, res) => {
  const username = tokenManager.getUserByToken(req.cookies?._token)
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


app.get('/manage/:id', (req, res) => {
  const {id} = req.params
  if (scanStore.scanExists(id)) {
    const scan = scanStore.getScanInfo(id)
    res.render('edit', {id, scan})
  } else {
    res.redirect('/')
  }
});

app.post('/manage/:id/delete', async(req, res) => {
  const {id} = req.params
  if (scanStore.scanExists(id)) {
    await scanStore.deleteScan(id)
    res.redirect('/')
  } else {
    res.status(404).send(`No such scan named ${id}`)
  }
})

app.post('/manage/:id', async (req, res) => {
  const {id} = req.params
  const {title, description} = req.body
  if (scanStore.scanExists(id)) {
    await scanStore.modifyScan(id, {title, description})
    res.redirect('/')
  } else {
    res.status(404).send(`No such scan named ${id}`)
  }
});

app.get('*a', (req, res) => {
  res.redirect('/')
});


// Start Server
server.listen(process.env.PORT, () => {
  console.log(`Server running on http://localhost:${process.env.PORT}`);
});
