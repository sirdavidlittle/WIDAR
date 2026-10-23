const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

// const ejs = require('ejs');
// const ffmpeg = require('ffmpeg');

const app = express();
const server = http.createServer(app);

app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send('Test Test');
});

const scansPath = path.join(__dirname, process.env.DATA_DIR);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const PORT = process.env.PORT;
const IN_PRODUCTION = process.env.PROD;


// Start Server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

