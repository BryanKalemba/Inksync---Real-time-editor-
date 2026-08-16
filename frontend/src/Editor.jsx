import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Quill from 'quill';
import QuillCursors from 'quill-cursors';
import { QuillBinding } from 'y-quill';
import * as Y from 'yjs';
import 'quill/dist/quill.snow.css';

import { SocketIOProvider } from './yjsSocketProvider';
import { getUserIdentity } from './userIdentity';

Quill.register('modules/cursors', QuillCursors);

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

const TOOLBAR_OPTIONS = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['blockquote', 'code-block'],
  ['clean'],
];

export default function Editor({ docId, docTitle }) {
  const editorRef = useRef(null);
  const [status, setStatus] = useState('connecting');
  const [synced, setSynced] = useState(false);
  const [collaborators, setCollaborators] = useState([]);
  const [wordCount, setWordCount] = useState(0);
  const [title, setTitle] = useState(docTitle || 'Untitled document');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const editingTitleRef = useRef(editingTitle);
  // Tracks whether we've already established the "real" title, from either
  // the initial fetch or a user rename — once true, a late-arriving initial
  // fetch response is stale and must not overwrite anything newer.
  const titleResolvedRef = useRef(false);
  const user = useRef(getUserIdentity()).current;

  useEffect(() => {
    editingTitleRef.current = editingTitle;
  }, [editingTitle]);

  // docTitle arrives asynchronously (EditorRoute fetches it after mount).
  // Only apply it if nothing has resolved the title yet — otherwise a slow
  // initial fetch (e.g. a cold-starting backend) could land after the user
  // has already renamed the document and silently stomp on it.
  useEffect(() => {
    if (docTitle && !titleResolvedRef.current) {
      setTitle(docTitle);
      setTitleDraft(docTitle);
      titleResolvedRef.current = true;
    }
  }, [docTitle]);

  const saveTitle = async () => {
    const trimmed = titleDraft.trim();
    setEditingTitle(false);
    if (!trimmed || trimmed === title) {
      setTitleDraft(title);
      return;
    }
    // Lock in the title as resolved right away, before the request even
    // goes out — this is what stops a slower, earlier-fired initial fetch
    // from overwriting this rename when it eventually resolves.
    titleResolvedRef.current = true;
    const previousTitle = title;
    setTitle(trimmed); // optimistic update
    try {
      const res = await fetch(`${SERVER_URL}/api/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error('Rename request failed');
    } catch (err) {
      // Revert on failure (e.g. backend unreachable) so the UI doesn't lie
      // about what's actually saved.
      setTitle(previousTitle);
      setTitleDraft(previousTitle);
    }
  };

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new SocketIOProvider(SERVER_URL, docId, ydoc, { user });
    provider.setLocalUser(user);

    const handleRenamed = ({ title: newTitle }) => {
      setTitle(newTitle);
      setTitleDraft((current) => (editingTitleRef.current ? current : newTitle));
    };
    provider.socket.on('document-renamed', handleRenamed);

    const unsubStatus = provider.onStatusChange(({ connected, synced: isSynced }) => {
      setStatus(connected ? 'connected' : 'reconnecting');
      setSynced(isSynced);
    });

    const quill = new Quill(editorRef.current, {
      theme: 'snow',
      modules: {
        toolbar: TOOLBAR_OPTIONS,
        cursors: { transformOnTextChange: true },
        history: { userOnly: true }, // undo only affects this user's own edits
      },
      placeholder: 'Start writing…',
    });

    const yText = ydoc.getText('quill-content');
    const binding = new QuillBinding(yText, quill, provider.awareness);

    const updateWordCount = () => {
      const text = quill.getText().trim();
      setWordCount(text.length === 0 ? 0 : text.split(/\s+/).length);
    };
    updateWordCount();
    quill.on('text-change', updateWordCount);

    const updatePresence = () => {
      const states = Array.from(provider.awareness.getStates().entries())
        .filter(([clientId]) => clientId !== ydoc.clientID)
        .map(([, state]) => state.user)
        .filter(Boolean);
      setCollaborators(states);
    };
    updatePresence();
    provider.awareness.on('change', updatePresence);

    return () => {
      quill.off('text-change', updateWordCount);
      provider.awareness.off('change', updatePresence);
      provider.socket.off('document-renamed', handleRenamed);
      unsubStatus();
      binding.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [docId, user]);

  return (
    <div className="editor-page">
      <header className="editor-topbar">
        <Link to="/" className="brand-mark" aria-label="Back to documents">
          InkSync
        </Link>
        <div className="doc-title">
          {editingTitle ? (
            <input
              className="doc-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setTitleDraft(title);
                  setEditingTitle(false);
                }
              }}
              maxLength={200}
              autoFocus
            />
          ) : (
            <button
              className="doc-title-button"
              onClick={() => {
                setTitleDraft(title);
                setEditingTitle(true);
              }}
              title="Click to rename"
            >
              {title}
            </button>
          )}
        </div>
        <div className="topbar-right">
          <div className="presence-stack" aria-label="Collaborators currently viewing">
            {collaborators.map((c, i) => (
              <span
                key={i}
                className="presence-avatar"
                style={{ backgroundColor: c.color }}
                title={c.name}
              >
                {c.name.charAt(0)}
              </span>
            ))}
          </div>
          {(() => {
            const phase =
              status === 'reconnecting' ? 'reconnecting' : status === 'connected' && synced ? 'connected' : 'loading';
            const label = { reconnecting: 'Reconnecting…', connected: 'Synced', loading: 'Loading…' }[phase];
            return <span className={`status-seal status-${phase}`}>{label}</span>;
          })()}
        </div>
      </header>

      <main className="sheet-wrap">
        <div className="sheet">
          {!synced && (
            <div className="sheet-loading" role="status">
              Loading document…
            </div>
          )}
          <div ref={editorRef} style={{ visibility: synced ? 'visible' : 'hidden' }} />
        </div>
      </main>

      <footer className="editor-footer">
        <span>{wordCount} word{wordCount === 1 ? '' : 's'}</span>
        <span className="footer-divider">·</span>
        <span style={{ color: user.color }}>writing as {user.name}</span>
      </footer>
    </div>
  );
}
