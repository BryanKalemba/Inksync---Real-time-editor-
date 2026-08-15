# InkSync — Real-Time Collaborative Editor

I'm Bryan, a second-year Computer Science student at the University of
Nottingham, and this is a Google Docs–style editor I built over summer to
push my portfolio past the usual CRUD-app territory. Multiple people can type
in the same document at once, see each other's cursors moving live, and (this
was the whole point) never lose their work to someone else's edit landing at
the same time.

I picked this project specifically because I wanted to understand *why*
Google Docs doesn't just fall apart when two people type in the same spot —
turns out that's a genuinely hard distributed systems problem, and building
it from something closer to first principles taught me more than another
CRUD-with-auth tutorial would have.

## How it works

My first instinct was "just apply whichever edit arrives last" — which works
right up until it silently deletes someone's paragraph because their update
lost a race. That sent me down a rabbit hole into CRDTs (Conflict-free
Replicated Data Types), which is the actual technique behind tools like
Google Docs and Notion.

I used **Yjs** as the CRDT engine. Every keystroke becomes a small,
mathematically mergeable operation, and any two copies of the document that
have seen the same operations end up in the *exact same state* — it doesn't
matter what order the network delivered them in. No "whoever saved last
wins" logic needed. Once it clicked, it felt a bit like magic; it's not
magic, it's just very clever maths I'm still only half-way to fully
understanding.

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

The bit I'm most proud of:

- **CRDT engine:** [Yjs](https://docs.yjs.dev/) — the same library that
  actually powers JupyterLab and TipTap's collaborative modes, so I'm at
  least in good company.
- **Transport:** Socket.io. I didn't just drop in `y-websocket` (the
  "official" pairing for Yjs) — I hand-rolled the sync/awareness handshake
  myself over Socket.io, mostly because I wanted to actually understand the
  protocol rather than trust a library to do it for me. This is also where
  I found my worst bug (see below).
- **Editor UI:** Quill, wired to the CRDT via `y-quill`, with `quill-cursors`
  drawing everyone else's live cursor and selection in their own colour.
- **Presence:** Yjs's Awareness protocol handles "who's online and where's
  their cursor" completely separately from the document content itself.
- **Persistence:** each document's merged state gets snapshotted to SQLite
  (`better-sqlite3`) every couple of seconds, so a server restart doesn't
  lose anyone's work.

## Project structure

Fairly standard split — a `backend` folder for the Node/Socket.io server and
a `frontend` folder for the React app:

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

You'll need Node.js 18+. (Standard disclaimer from someone who's been
burned by version mismatches before: if something acts weird, check your
Node version first.)

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
URL in a second tab (or better, ask a housemate to open it on their laptop).
Each tab gets its own randomly generated name and colour, so even testing
solo with two tabs side by side is enough to see the live cursors and
multi-user editing actually working — which, I won't lie, I spent way too
long just typing back and forth between two windows grinning at my screen.

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

## The bug that taught me the most

Early on, my server would send new clients a `syncStep1` message on
connect and I assumed that alone would hand them the document. It didn't —
`syncStep1` only tells the *other side* what it's missing; it doesn't ask
for anything back. A brand-new client has nothing to offer in return, so the
handshake technically "succeeded" while silently sending zero actual
content. Result: opening a document that already had text in it just showed
a blank page, which is about as basic a scenario as this app has, so it was
a pretty humbling one to have missed.

The fix was realising the *client* also has to send its own `syncStep1` back
to the server — that's what actually pulls the existing content down. It's a
one-line fix once you see it, but tracing through the handshake by hand
(rather than assuming a library was doing the sane thing under the hood,
because I'd written it myself) is what actually made the CRDT sync protocol
click for me.

## Why this project

I wanted something past CRUD-app territory for my portfolio — somewhere the
interesting problem is genuinely distributed systems, not just the UI on
top. Reconciling concurrent edits correctly is hard to get right, and
building it from something close to the underlying protocol, instead of
dropping in a fully managed service, is what actually taught me anything.
