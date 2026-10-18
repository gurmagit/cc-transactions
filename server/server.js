const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const port = 3010;
const app = express();

const clientDist = path.join(__dirname, '../client/dist/table2');

const server = http.createServer(app);
app.use(cors());
app.use(express.static(clientDist));
app.use(express.json());

const cardRoute = require('./routes/cards');
app.use('/cards', cardRoute);

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

server.listen(port, () => {
  console.log('server is listening on port', port);
});
