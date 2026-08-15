import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import DocumentList from './DocumentList';
import Editor from './Editor';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

function EditorRoute() {
  const { docId } = useParams();
  const [title, setTitle] = useState(null);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/documents/${docId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((meta) => setTitle(meta?.title))
      .catch(() => setTitle(null));
  }, [docId]);

  return <Editor docId={docId} docTitle={title} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DocumentList />} />
        <Route path="/doc/:docId" element={<EditorRoute />} />
      </Routes>
    </BrowserRouter>
  );
}
