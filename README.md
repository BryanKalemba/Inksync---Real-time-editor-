# InkSync — Real-Time Collaborative Editor

A Google Docs–style editor where multiple people can write in the same document
at once, see each other's cursors live, and never lose work to a conflicting
edit. Built to understand — and demonstrate — how real collaborative software
actually solves the hard problem: **what happens when two people edit the same
sentence at the same time?**

## How it works

Most naive real-time editors use "last write wins," which silently drops
someone's changes. InkSync uses **Yjs**, a CRDT (Conflict-free Replicated Data
Type) library. Every edit becomes a small, mathematically mergeable operation;
any two replicas that have seen the same set of operations converge to the
*same* document, regardless of the order the network delivered them in — no
central "who wins" logic required.

```
┌─────────────┐        Socket.io         ┌─────────────┐
│  Browser A   │ ───── binary updates ──► │             │
│  Quill + Yjs │ ◄──── binary updates ─── │  Node server │
└─────────────┘                           │  Y.Doc per   │
                                           │  document,   │
┌─────────────┐        Socket.io          │  SQLite      │
│  Browser B   │ ───── binary updates ──► │  persistence │
│  Quill + Yjs │ ◄──── binary updates ─── │             │
└─────────────┘                           └─────────────┘
```

- **CRDT engine:** [Yjs](https://docs.yjs.dev/) — the same library behind
  JupyterLab's and TipTap's collaborative modes.
- **Transport:** Socket.io. The server implements the same sync/awareness
  handshake as `y-websocket`, just carried over Socket.io instead of a raw
  WebSocket, so it's a from-scratch protocol implementation rather than a
  drop-in library.
- **Editor UI:** Quill, bound to the CRDT via `y-quill`, with `quill-cursors`
  rendering everyone else's live cursor and selection in their own color.
- **Presence:** Yjs Awareness protocol broadcasts who's connected and where
  their cursor is, without touching the document itself.
- **Persistence:** each document's merged CRDT state is periodically
  snapshotted to SQLite (`better-sqlite3`), so documents survive server
  restarts without keeping a full edit history.

## Project structure

```
realtime-editor/
├── backend/
│   ├── server.js            # Express + Socket.io + Yjs sync/awareness relay
│   ├── docPersistence.js    # SQLite load/save for document snapshots
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.jsx               # Routing: catalog ↔ editor
    │   ├── DocumentList.jsx      # Document catalog / "shelf" page
    │   ├── Editor.jsx            # Quill + Yjs binding, presence UI
    │   ├── yjsSocketProvider.js  # Client-side half of the sync protocol
    │   ├── userIdentity.js       # Per-tab demo identity (name + color)
    │   └── styles.css
    └── package.json
```

## Running it locally

You'll need Node.js 18+.

**1. Start the backend**

```bash
cd backend
npm install
npm start
```

This starts the API + Socket.io server on `http://localhost:4000` and creates
`documents.db` (SQLite) on first run.

**2. Start the frontend**

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Create a document, then open the same document
URL in a second tab (or a different browser) — each tab gets its own random
demo identity, so you can see live multi-cursor editing and presence updates
without needing a second person.

## What I'd build next

- **Auth & sharing permissions** — right now any tab with the link can edit;
  a real product needs owners, viewers, and editors.
- **Version history** — Yjs supports snapshotting the update log, which could
  power a "see edit history" panel like Google Docs' version timeline.
- **Offline support** — Yjs updates can be queued locally (e.g. with
  `y-indexeddb`) and replayed on reconnect, so edits made offline aren't lost.
- **Horizontal scaling** — the current server keeps each document's `Y.Doc` in
  a single process's memory; scaling past one server would mean routing a
  document's room to a consistent server (or a shared backing store like
  Redis pub/sub) so collaborators on different instances still sync.

## Why this project

I wanted to move past CRUD apps and build something where the interesting
problem is *distributed systems*, not just UI — reconciling concurrent edits
correctly is genuinely hard to get right, and building it from the underlying
protocol (rather than dropping in a hosted service) is what taught me the most.
