import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DocumentList() {
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${SERVER_URL}/api/documents`)
      .then((res) => res.json())
      .then(setDocuments)
      .catch(() => setError('Could not reach the server. Is the backend running?'));
  }, []);

  const createDocument = async () => {
    const res = await fetch(`${SERVER_URL}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled document' }),
    });
    const doc = await res.json();
    navigate(`/doc/${doc.id}`);
  };

  return (
    <div className="catalog-page">
      <header className="catalog-header">
        <span className="brand-mark">InkSync</span>
        <p className="catalog-tagline">A shared page, written together in real time.</p>
      </header>

      <div className="catalog-actions">
        <button className="btn-primary" onClick={createDocument}>
          + New document
        </button>
      </div>

      {error && <p className="catalog-error">{error}</p>}

      {documents && documents.length === 0 && (
        <div className="catalog-empty">
          <p>Nothing on the shelf yet.</p>
          <p className="catalog-empty-sub">Start a new document — anyone with the link can join and edit live.</p>
        </div>
      )}

      <ul className="catalog-list">
        {documents?.map((doc) => (
          <li key={doc.id} className="catalog-item" onClick={() => navigate(`/doc/${doc.id}`)}>
            <span className="catalog-item-title">{doc.title}</span>
            <span className="catalog-item-meta">Edited {formatDate(doc.updated_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
