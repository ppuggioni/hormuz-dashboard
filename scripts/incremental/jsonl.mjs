import fs from 'node:fs/promises';

async function ensureParentFile(filePath) {
  const handle = await fs.open(filePath, 'a');
  await handle.close();
}

export async function appendJsonl(filePath, record) {
  if (record === undefined) {
    throw new TypeError('appendJsonl requires a record value');
  }
  await ensureParentFile(filePath);
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function writeJsonl(filePath, records) {
  const normalized = [];
  for await (const record of records) {
    normalized.push(JSON.stringify(record));
  }
  const content = normalized.length ? `${normalized.join('\n')}\n` : '';
  await fs.writeFile(filePath, content, 'utf8');
}

export async function readJsonl(filePath, { ignoreMissing = true } = {}) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (ignoreMissing && err?.code === 'ENOENT') return [];
    throw err;
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      err.message = `Invalid JSONL at line ${index + 1} in ${filePath}: ${err.message}`;
      throw err;
    }
  });
}
