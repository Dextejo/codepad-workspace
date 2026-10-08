import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import io from 'socket.io-client';

const SOCKET_URL = 'http://localhost:4000';

export default function App() {
  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [passcode, setPasscode] = useState('');
  const [code, setCode] = useState('// Loading workspace...');
  const [participants, setParticipants] = useState([]);
  const [audits, setAudits] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [rateWarning, setRateWarning] = useState('');
  const [peerStatuses, setPeerStatuses] = useState({}); // socketId -> { typing: bool }

  const socketRef = useRef(null);
  const isRemoteUpdate = useRef(false);
  const syncTimeoutRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const warningTimerRef = useRef(null);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL);

    socketRef.current.on('presence:update', (data) => {
      setParticipants(data.participants || []);
      if (data.audit) {
        setAudits((prev) => [...prev.slice(-49), data.audit]);
      }
    });

    socketRef.current.on('editor:sync', ({ code: newCode }) => {
      isRemoteUpdate.current = true;
      setCode(newCode);
    });

    socketRef.current.on('peer:status', (data) => {
      setPeerStatuses((prev) => ({
        ...prev,
        [data.socketId]: { typing: data.typing }
      }));
    });

    socketRef.current.on('audit:warning', (msg) => {
      setRateWarning(msg);
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = setTimeout(() => {
        setRateWarning('');
      }, 3000);
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const handleJoin = (e) => {
    e.preventDefault();
    if (!roomId.trim() || !username.trim()) return;

    socketRef.current.emit('room:join', { roomId, username, passcode }, (res) => {
      if (res.error) {
        setErrorMsg(res.error);
      } else {
        setErrorMsg('');
        setCode(res.roomState.content);
        setParticipants(res.roomState.participants);
        setAudits(res.roomState.auditFeed);
        setJoined(true);
      }
    });
  };

  const handleEditorChange = (value) => {
    if (isRemoteUpdate.current) {
      isRemoteUpdate.current = false;
      return;
    }
    setCode(value);

    // Notify peers user is typing
    socketRef.current.emit('peer:status', { typing: true });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current.emit('peer:status', { typing: false });
    }, 1000);

    // Throttled sync: batches fast typing within 250ms (< 4 updates/sec) to avoid backend throttle
    clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      socketRef.current.emit('editor:sync', { code: value });
    }, 250);
  };

  if (!joined) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#1e1e1e', color: '#fff' }}>
        <form onSubmit={handleJoin} style={{ background: '#252526', padding: '24px', borderRadius: '8px', width: '320px', display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid #3c3c3c' }}>
          <h2 style={{ margin: '0 0 10px 0' }}>Join Code Pad</h2>
          {errorMsg && <div style={{ color: '#f87171', fontSize: '13px' }}>{errorMsg}</div>}
          <input
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            style={{ padding: '8px', background: '#3c3c3c', border: '1px solid #555', color: '#fff', borderRadius: '4px' }}
            required
          />
          <input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ padding: '8px', background: '#3c3c3c', border: '1px solid #555', color: '#fff', borderRadius: '4px' }}
            required
          />
          <input
            placeholder="Passcode (Optional)"
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            style={{ padding: '8px', background: '#3c3c3c', border: '1px solid #555', color: '#fff', borderRadius: '4px' }}
          />
          <button type="submit" style={{ padding: '10px', background: '#007acc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            Enter Workspace
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', background: '#1e1e1e' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: '#2d2d2d', color: '#fff', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #3c3c3c' }}>
          <div><strong>Room:</strong> {roomId}</div>
          {rateWarning && <div style={{ color: '#fbbf24', fontSize: '12px' }}>{rateWarning}</div>}
          <div><strong>Active Peers:</strong> {participants.length}</div>
        </div>
        <div style={{ flex: 1 }}>
          <Editor
            height="100%"
            theme="vs-dark"
            defaultLanguage="python"
            value={code}
            onChange={handleEditorChange}
            options={{ minimap: { enabled: false }, fontSize: 14 }}
          />
        </div>
      </div>
      <div style={{ width: '300px', background: '#252526', color: '#ccc', display: 'flex', flexDirection: 'column', borderLeft: '1px solid #3c3c3c' }}>
        <div style={{ padding: '12px', borderBottom: '1px solid #3c3c3c', fontWeight: 'bold' }}>Participants</div>
        <div style={{ padding: '10px', flex: '0 0 auto', maxHeight: '200px', overflowY: 'auto' }}>
          {participants.map((p) => {
            const isTyping = peerStatuses[p.socketId]?.typing;
            return (
              <div key={p.socketId} style={{ padding: '6px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{p.username}</span>
                  {isTyping && <span style={{ fontSize: '10px', background: '#0284c7', color: '#fff', padding: '1px 5px', borderRadius: '4px' }}>typing...</span>}
                </span>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', color: p.role === 'host' ? '#fbbf24' : '#9ca3af', fontWeight: '600' }}>
                  {p.role}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '12px', borderBottom: '1px solid #3c3c3c', borderTop: '1px solid #3c3c3c', fontWeight: 'bold' }}>Audit Feed</div>
        <div style={{ padding: '10px', flex: 1, overflowY: 'auto', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {audits.map((a) => (
            <div key={a.id} style={{ color: '#aaa', lineHeight: '1.4' }}>
              <span style={{ color: '#666' }}>[{a.timestamp}]</span> {a.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}