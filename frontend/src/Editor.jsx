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
  const user = useRef(getUserIdentity()).current;

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new SocketIOProvider(SERVER_URL, docId, ydoc, { user });
    provider.setLocalUser(user);

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
        <div className="doc-title">{docTitle || 'Untitled document'}</div>
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
