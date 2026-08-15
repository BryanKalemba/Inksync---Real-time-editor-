const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');

const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

const {
  loadDocState,
  saveDocState,
  listDocuments,
  getDocMeta,
  createDocument,
} = require('./docPersistence');

const PORT = process.env.PORT || 4000;
const SAVE_DEBOUNCE_MS = 2000;

// message type tags, matching the convention used by y-websocket
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const app = express();
app.use(cors());
app.use(express.json());

// --- REST: document list / create -----------------------------------------

app.get('/api/documents', (req, res) => {
  res.json(listDocuments());
});

app.post('/api/documents', (req, res) => {
  const id = nanoid(10);
  const title = (req.body && req.body.title) || 'Untitled document';
  createDocument(id, title);
  res.json({ id, title });
});

app.get('/api/documents/:id', (req, res) => {
  const meta = getDocMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Document not found' });
  res.json(meta);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e7, // 10MB, generous for large paste operations
});

// --- In-memory room state ---------------------------------------------------
// Each room holds the authoritative Y.Doc, its Awareness instance (cursors/
// presence), the set of connected socket ids, and a pending-save timer.
const rooms = new Map();

function getRoom(docId) {
  if (rooms.has(docId)) return rooms.get(docId);

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);

  const persisted = loadDocState(docId);
  if (persisted) {
    Y.applyUpdate(doc, persisted);
  }

  const room = {
    doc,
    awareness,
    sockets: new Set(),
    saveTimer: null,
    socketToAwarenessIds: new Map(),
  };

  // Any change to the doc (from any client) gets broadcast to the room and
  // scheduled for persistence. Yjs updates are the CRDT's source of truth;
  // applying them in any order on any replica converges to the same state.
  doc.on('update', (update, origin) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    broadcast(docId, message, origin);
    scheduleSave(docId);
  });

  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changedClients = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
    );
    broadcast(docId, encoding.toUint8Array(encoder), origin);

    // origin is the socket.id that sent the update (see yjs-message handler
    // below). Track which awareness client ids each socket owns so we can
    // clear them out cleanly on disconnect.
    if (typeof origin === 'string') {
      if (!room.socketToAwarenessIds.has(origin)) {
        room.socketToAwarenessIds.set(origin, new Set());
      }
      const owned = room.socketToAwarenessIds.get(origin);
      added.forEach((id) => owned.add(id));
      updated.forEach((id) => owned.add(id));
      removed.forEach((id) => owned.delete(id));
    }
  });

  rooms.set(docId, room);
  return room;
}

function broadcast(docId, message, originSocketId) {
  const room = rooms.get(docId);
  if (!room) return;
  for (const socketId of room.sockets) {
    if (socketId === originSocketId) continue;
    io.to(socketId).emit('yjs-message', message);
  }
}

function scheduleSave(docId) {
  const room = rooms.get(docId);
  if (!room) return;
  clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(() => {
    const state = Y.encodeStateAsUpdate(room.doc);
    saveDocState(docId, Buffer.from(state));
  }, SAVE_DEBOUNCE_MS);
}

function cleanupRoomIfEmpty(docId) {
  const room = rooms.get(docId);
  if (!room || room.sockets.size > 0) return;

  // Flush final state immediately, then drop the doc from memory.
  clearTimeout(room.saveTimer);
  const state = Y.encodeStateAsUpdate(room.doc);
  saveDocState(docId, Buffer.from(state));
  room.doc.destroy();
  rooms.delete(docId);
}

// --- Socket.io wiring ---------------------------------------------------

io.on('connection', (socket) => {
  let currentDocId = null;

  socket.on('join-document', ({ docId, user }) => {
    if (!docId) return;
    currentDocId = docId;
    socket.join(docId);

    const room = getRoom(docId);
    room.sockets.add(socket.id);
    socket.data.user = user;

    // Step 1 of the sync handshake: tell the new client what we have, and
    // ask it to tell us what it has, so both sides can exchange only the
    // missing updates rather than the whole document.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    socket.emit('yjs-message', encoding.toUint8Array(encoder));

    // Send current awareness states (who else is here, their cursors) to
    // the newly joined client.
    const awarenessStates = room.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awEncoder = encoding.createEncoder();
      encoding.writeVarUint(awEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awEncoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys()))
      );
      socket.emit('yjs-message', encoding.toUint8Array(awEncoder));
    }
  });

  socket.on('yjs-message', (message) => {
    if (!currentDocId) return;
    const room = rooms.get(currentDocId);
    if (!room) return;

    const decoder = decoding.createDecoder(new Uint8Array(message));
    const messageType = decoding.readVarUint(decoder);

    if (messageType === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      // readSyncMessage applies incoming updates to room.doc, which fires
      // the doc.on('update') listener above and handles broadcasting.
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, socket.id);
      // readSyncMessage may have written a reply (e.g. sync step 2); only
      // send it back if there's actually a payload beyond the message tag.
      if (encoding.length(encoder) > 1) {
        socket.emit('yjs-message', encoding.toUint8Array(encoder));
      }
    } else if (messageType === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        room.awareness,
        decoding.readVarUint8Array(decoder),
        socket.id
      );
    }
  });

  socket.on('disconnect', () => {
    if (!currentDocId) return;
    const room = rooms.get(currentDocId);
    if (!room) return;

    room.sockets.delete(socket.id);

    // Remove any awareness states (cursor/presence) owned by this socket's
    // connection, so other clients immediately see the collaborator vanish.
    const owned = room.socketToAwarenessIds.get(socket.id);
    if (owned && owned.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(owned), socket.id);
    }
    room.socketToAwarenessIds.delete(socket.id);

    cleanupRoomIfEmpty(currentDocId);
  });
});

server.listen(PORT, () => {
  console.log(`Real-time editor server listening on port ${PORT}`);
});
