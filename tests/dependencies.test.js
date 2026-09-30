const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const request = require('request');
const bcrypt = require('bcrypt');
const bcryptjs = require('bcryptjs');
const jp = require('../functions/jsonpath');
const express = require('express');
const multer = require('multer');

test('JSONPath preserves traversal used by server and plugin views', () => {
  assert.deepEqual(jp.query({ serverName: 'local' }, '$.serverName'), ['local']);
  assert.deepEqual(jp.query([{ settingId: 'a' }, { child: { settingId: 'b' } }], '$..settingId'), ['a', 'b']);
  assert.deepEqual(jp.query({ a: { name: 'one' }, b: { name: 'two' } }, '$.*.name'), ['one', 'two']);
});

test('plugin GUIDs are literal values and expressions cannot execute', () => {
  const plugins = [{ guid: 'abc', name: 'Test' }];
  assert.deepEqual(jp.queryByGuid(plugins, 'abc', 'name'), ['Test']);
  assert.deepEqual(jp.queryByGuid(plugins, '" || true || "', 'name'), []);
  assert.throws(() => jp.query(plugins, '$[?(@.guid=="abc")]'));
});

test('bcrypt remains compatible with existing bcryptjs password hashes', async () => {
  const hash = bcryptjs.hashSync('local smoke fixture', 4);
  assert.equal(await bcrypt.compare('local smoke fixture', hash), true);
  assert.equal(await bcrypt.compare('incorrect', hash), false);
});

test('Multer accepts multipart files and enforces upload size limits', async () => {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 } });
  app.post('/upload', upload.single('file'), (req, res) => res.json({
    name: req.file.originalname, content: req.file.buffer.toString(),
  }));
  app.use((error, req, res, next) => res.status(413).json({ code: error.code }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const send = (content) => new Promise((resolve, reject) => request.post({
      url: `http://127.0.0.1:${server.address().port}/upload`, proxy: null, timeout: 5000,
      formData: { file: { value: Buffer.from(content), options: { filename: 'fixture.txt' } } },
    }, (error, response, body) => error ? reject(error) : resolve({ status: response.statusCode, data: JSON.parse(body) })));
    assert.deepEqual(await send('hello'), { status: 200, data: { name: 'fixture.txt', content: 'hello' } });
    assert.deepEqual(await send('too many bytes'), { status: 413, data: { code: 'LIMIT_FILE_SIZE' } });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('request replacement preserves callback GET, POST, PATCH, and DELETE behavior', async () => {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString(), authorization: req.headers.authorization }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const method of ['get', 'post', 'patch', 'delete']) {
      const result = await new Promise((resolve, reject) => request[method]({
        url: `http://127.0.0.1:${server.address().port}/api`, proxy: null,
        body: method === 'get' ? undefined : '{"value":1}',
        headers: { Authorization: 'Bearer local-fixture' }, timeout: 5000,
      }, (error, response, body) => error ? reject(error) : resolve({ status: response.statusCode, data: JSON.parse(body) })));
      assert.equal(result.status, 200);
      assert.equal(result.data.method, method.toUpperCase());
      assert.equal(result.data.authorization, 'Bearer local-fixture');
      if (method !== 'get') assert.equal(result.data.body, '{"value":1}');
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
