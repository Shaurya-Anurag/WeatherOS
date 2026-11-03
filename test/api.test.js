import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('REST API health, validation, SQLite CRUD, and exports', { timeout: 20000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'weatheros-test-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      WEATHEROS_DB_PATH: path.join(tempDir, 'test.sqlite'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';

  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });

  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  const request = async (url, options) => {
    const response = await fetch(`${base}${url}`, options);
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';

    let body = {};

    if (text && contentType.includes('application/json')) {
      body = JSON.parse(text);
    }

    return { response, body, text };
  };

  try {
    let health;

    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) {
        throw new Error(`Server exited early:\n${logs}`);
      }

      try {
        health = await request('/api/health');
        if (health.response.ok) break;
      } catch {
        /* wait for startup */
      }

      await wait(100);
    }

    assert.equal(
      health?.body?.ok,
      true,
      `health endpoint did not start:\n${logs}`
    );

    assert.equal(health.body.database, 'SQLite');

    const invalidCoords = await request('/api/weather?lat=999&lon=999');
    assert.equal(invalidCoords.response.status, 400);

    const invalidRange = await request(
      '/api/range?lat=23&lon=77&start=2026-10-20&end=2026-10-01'
    );
    assert.equal(invalidRange.response.status, 400);

    const payload = {
      location: {
        name: 'Test City',
        admin1: 'Test Region',
        country: 'Test Country',
        latitude: 23.2,
        longitude: 77.4,
      },
      startDate: '2020-01-01',
      endDate: '2020-01-02',
      temperatures: [
        {
          date: '2020-01-01',
          high: 27,
          low: 13,
          code: 1,
          precipitation: 0,
          source: 'historical',
        },
        {
          date: '2020-01-02',
          high: 28,
          low: 14,
          code: 2,
          precipitation: 0,
          source: 'historical',
        },
      ],
      summary: 'Two test weather rows',
    };

    const created = await request('/api/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(created.response.status, 201, created.text);

    const id = created.body.record.id;
    assert.equal(created.body.record.temperatures.length, 2);

    const read = await request('/api/records');
    assert.equal(read.response.status, 200);
    assert.equal(read.body.records.length, 1);
    assert.equal(read.body.records[0].id, id);

    const updated = await request(`/api/records/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        startDate: '2020-01-02',
        endDate: '2020-01-03',
        temperatures: [
          { date: '2020-01-02', high: 28, low: 14 },
        ],
        summary: 'Updated row',
      }),
    });

    assert.equal(updated.response.status, 200, updated.text);
    assert.equal(updated.body.record.startDate, '2020-01-02');
    assert.equal(updated.body.record.temperatures.length, 1);

    const jsonExport = await request('/api/export/json');
    assert.equal(jsonExport.response.status, 200);
    assert.equal(jsonExport.body.records.length, 1);

    const csvExport = await request('/api/export/csv');
    assert.equal(csvExport.response.status, 200);
    assert.match(csvExport.text, /Test City/);
    assert.match(
      csvExport.response.headers.get('content-type'),
      /text\/csv/
    );

    const deleted = await request(`/api/records/${id}`, {
      method: 'DELETE',
    });

    assert.equal(deleted.response.status, 200);

    const missing = await request(`/api/records/${id}`);
    assert.equal(missing.response.status, 404);

    const afterDelete = await request('/api/records');
    assert.equal(afterDelete.body.records.length, 0);
  } finally {
    child.kill('SIGTERM');

    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      wait(1500),
    ]);

    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }

    await rm(tempDir, { recursive: true, force: true });
  }
});