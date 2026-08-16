const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'documents.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Untitled document',
    state BLOB,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

/**
 * Loads a document's persisted Yjs state (a binary update) by id.
 * Returns null if the document has never been saved before.
 */
function loadDocState(docId) {
  const row = db.prepare('SELECT state FROM documents WHERE id = ?').get(docId);
  return row && row.state ? row.state : null;
}

/**
 * Persists (or creates) a document's Yjs state as a binary blob.
 * We store the *merged* state (Y.encodeStateAsUpdate(doc)) rather than
 * an append-only update log, so the table never grows unbounded.
 */
function saveDocState(docId, stateBuffer, title) {
  const now = Date.now();
  const existing = db.prepare('SELECT id FROM documents WHERE id = ?').get(docId);

  if (existing) {
    db.prepare(
      `UPDATE documents SET state = ?, updated_at = ? ${title ? ', title = ?' : ''} WHERE id = ?`
    ).run(...(title ? [stateBuffer, now, title, docId] : [stateBuffer, now, docId]));
  } else {
    db.prepare(
      'INSERT INTO documents (id, title, state, updated_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(docId, title || 'Untitled document', stateBuffer, now, now);
  }
}

function listDocuments() {
  return db
    .prepare('SELECT id, title, updated_at, created_at FROM documents ORDER BY updated_at DESC')
    .all();
}

function getDocMeta(docId) {
  return db.prepare('SELECT id, title, updated_at, created_at FROM documents WHERE id = ?').get(docId);
}

function createDocument(docId, title) {
  const now = Date.now();
  db.prepare(
    'INSERT INTO documents (id, title, state, updated_at, created_at) VALUES (?, ?, NULL, ?, ?)'
  ).run(docId, title || 'Untitled document', now, now);
}

/**
 * Renames an existing document. Returns true if a row was actually updated,
 * false if no document with that id exists.
 */
function renameDocument(docId, title) {
  const now = Date.now();
  const result = db
    .prepare('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?')
    .run(title, now, docId);
  return result.changes > 0;
}

module.exports = {
  loadDocState,
  saveDocState,
  listDocuments,
  getDocMeta,
  createDocument,
  renameDocument,
};
