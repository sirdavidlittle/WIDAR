const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const TokenManager = require('./TokenManager.js')
const ScanAssets = require('./ScanAssets.js')
const ejs = require('ejs');
//const ffmpeg = require('ffmpeg');

const HOURS =(hours)=> {
  return 1000 * 60 * 60 * hours;
}

const app = express();
const server = http.createServer(app);
const tokenManager = new TokenManager({
          tokenLifespan: HOURS(24),
          purgeInterval: HOURS(12)
        });

app.use((require("cors"))());
app.use((require("cookie-parser"))());

const scansPath = path.join(__dirname, process.env.DATA_DIR);

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
  if (username && password == process.env.ADMIN_PASSWORD) {
    return {valid: true, token:tokenManager.generateToken(username), username: username}
  }
  return {valid: false}
}

function loggedIn(req) {
  return tokenManager.isValid(req.cookies?._token)
}

app.get('/', (req, res) => {
  username = tokenManager.getUserByToken(req.cookies?._token)
  res.render('index', {username: username})
  // main page, display scans as cards
});

// data/file APIs
app.get('/scan/:id', (req, res, next) => {
  if (!req.params.id) {
    next()
  }
  res.render('scan', {scan_id:req.params.id});
});

app.get('/scan/:id/:asset', (req, res) => {
  assetName = ScanAssets[req.params.asset]
  if (assetName) {
    res.sendFile(path.join(scansPath, path.basename(req.params.id), assetName),
    (err) => {
      res.status(404).send()
    });
  } else {
    res.status(400).send()
  }
});

const loginEndpoint = (req, res) =>  {
  if (loggedIn(req)) {
    res.redirect(`/manage${req.originalUrl.slice('/login'.length)}`)
  } else {
    res.render('login', {failed:req.query?.failed})
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

app.get('/manage', (req, res) =>  {
  res.render('dashboard', {username: tokenManager.getUserByToken(req.cookies._token)})
});

app.post('/manage/:id', (req, res) => {
  // no implement
  console.log(`SUBMIT ${req.params.id}`)
});

app.post('/manage/:id/upload', (req, res) => {
  // no implement
  console.log(`UPLOAD ASSET ${req.params.id}`)
});

app.delete('/manage/:id', (req, res) => {
  // no implement
  console.log(`DELETE ${req.params.id}`)
});

app.get('/manage/*any', (req, res) =>  {
  res.redirect('/manage ')
});


app.get('*any', (req, res) => {
  res.redirect('/')
});

//|| admin ||//


// Start Server
server.listen(process.env.PORT, () => {
  console.log(`Server running on http://localhost:${process.env.PORT}`);
});
