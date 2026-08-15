import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { io } from 'socket.io-client';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/**
 * Bridges a Y.Doc + Awareness instance to the backend over Socket.io.
 * This is a from-scratch reimplementation of the y-websocket sync
 * protocol, swapped onto Socket.io as the transport (per the project's
 * chosen stack) instead of a raw WebSocket.
 */
export class SocketIOProvider {
  constructor(serverUrl, docId, ydoc, { user } = {}) {
    this.doc = ydoc;
    this.docId = docId;
    this.awareness = new awarenessProtocol.Awareness(ydoc);
    this.connected = false;
    this.synced = false;
    this._listeners = new Set();

    this.socket = io(serverUrl, { transports: ['websocket'] });

    this.socket.on('connect', () => {
      this.connected = true;
      this._emitStatus();
      this.socket.emit('join-document', { docId, user });

      // Send our own syncStep1 (our state vector). Without this, the server
      // only ever learns what WE have that IT is missing (nothing, for a
      // fresh doc) — it never sends back what IT has that we're missing.
      // This step is what actually pulls the document's existing content
      // down to a newly joined (or reconnecting) client.
      const syncEncoder = encoding.createEncoder();
      encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(syncEncoder, this.doc);
      this.socket.emit('yjs-message', encoding.toUint8Array(syncEncoder));

      // Re-announce local awareness state (name, color, cursor) explicitly.
      // On a reconnect the value hasn't "changed" from the local doc's point
      // of view, so relying on the awareness 'update' event alone would
      // silently skip sending it — other clients would never learn we're
      // back.
      const localState = this.awareness.getLocalState();
      if (localState !== null) {
        const awEncoder = encoding.createEncoder();
        encoding.writeVarUint(awEncoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          awEncoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [ydoc.clientID])
        );
        this.socket.emit('yjs-message', encoding.toUint8Array(awEncoder));
      }
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      this.synced = false;
      this._emitStatus();
      // Mark all remote collaborators offline locally until we resync.
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        Array.from(this.awareness.getStates().keys()).filter((id) => id !== ydoc.clientID),
        'disconnect'
      );
    });

    this.socket.on('yjs-message', (message) => {
      const decoder = decoding.createDecoder(new Uint8Array(message));
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
        if (encoding.length(encoder) > 1) {
          this.socket.emit('yjs-message', encoding.toUint8Array(encoder));
        }
        if (!this.synced) {
          this.synced = true;
          this._emitStatus();
        }
      } else if (messageType === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          this
        );
      }
    });

    // Local doc changes -> send to server (skip changes that originated
    // from the server itself, to avoid echoing updates back).
    ydoc.on('update', (update, origin) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.socket.emit('yjs-message', encoding.toUint8Array(encoder));
    });

    // Local awareness changes (cursor moved, user info set) -> send.
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin === this) return;
      const changedClients = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      );
      this.socket.emit('yjs-message', encoding.toUint8Array(encoder));
    });

    window.addEventListener('beforeunload', () => {
      awarenessProtocol.removeAwarenessStates(this.awareness, [ydoc.clientID], 'window-unload');
    });
  }

  onStatusChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emitStatus() {
    this._listeners.forEach((fn) => fn({ connected: this.connected, synced: this.synced }));
  }

  setLocalUser(user) {
    this.awareness.setLocalStateField('user', user);
  }

  destroy() {
    this.socket.disconnect();
    this.awareness.destroy();
  }
}
