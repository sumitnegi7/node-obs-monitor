"use strict";
require('./tracer'); // Import the tracing setup
const express = require('express');
const Redis = require('ioredis');
const client = require("prom-client");
const responseTime = require("response-time");
const {createLogger,transports} = require("winston");
const LokiTransport = require("winston-loki")
const collectDefaultMetrics = client.collectDefaultMetrics;


const options = {
  labels:{
    appName:"node-express-app"
  },
  transports:[
    new LokiTransport({
      host:"http://127.0.0.1:3100"
    })
  ]
}

const logger = createLogger(options);

collectDefaultMetrics({ register: client.register });


const app = express();
const redisClient = new Redis(6379); 

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const reqResTime = new client.Histogram({
  name: 'http_express_req_res_time',
  help: 'This tells how much time is taken by req and res',
  labelNames: ["method", "route", "status_code"],
  buckets: [1, 50, 100, 200, 400, 500, 800, 1000, 2000]
});


const totalReqCounter = new client.Counter({
  name: "total_req",
  help: "Tells total req"
})
app.use(responseTime((req, res, time) => {
  totalReqCounter.inc();
  reqResTime.labels({
    method: req.method,
    route: req.url,
    status_code: res.statusCode
  }).observe(time);
}));

app.get('/', (req, res) => {
  logger.info("Req on / route")
  res.send('Hello World!');
});

app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', client.register.contentType);
  const metrics = await client.register.metrics();
  res.send(metrics);
});

const sleep = () => new Promise((resolve) => setTimeout(resolve, 5000));

app.get("/slow", async (req, res) => {
  await sleep();
  try {
    return res.json({
      status: "Success",
      message: "Heavy task"
    });
  } catch (error) {
    return res.status(500).json({
      status: "Error",
      message: "Failed to complete task"
    });
  }
});



redisClient.on('connect', () => {
  console.log('Connected to Redis');
});

redisClient.on('error', (err) => {
  console.error('Redis error:', err);
});


app.post('/items', async (req, res) => {
  const { id, name } = req.body;

  if (!id || !name) {
    return res.status(400).send('ID and Name are required');
  }

  try {
    await client.set(id, name);
    res.status(201).send('Item created successfully');
  } catch (err) {
    res.status(500).send('Error creating item');
  }
});


app.get('/items/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await redisClient.get(id);

    if (!result) {
      return res.status(404).send('Item not found');
    }

    res.status(200).json({ id, name: result });
  } catch (err) {
    res.status(500).send('Error fetching item');
  }
});


app.put('/items/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).send('Name is required');
  }

  try {
    const exists = await redisClient.exists(id);

    if (!exists) {
      return res.status(404).send('Item not found');
    }

    await redisClient.set(id, name);
    res.status(200).send('Item updated successfully');
  } catch (err) {
    res.status(500).send('Error updating item');
  }
});


app.delete('/items/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await redisClient.del(id);

    if (result === 0) {
      return res.status(404).send('Item not found');
    }

    res.status(200).send('Item deleted successfully');
  } catch (err) {
    res.status(500).send('Error deleting item');
  }
});

app.listen(8080, () => {
  console.log('Server started on port 8080');
});
