import time
from datetime import datetime
import bcrypt
import socketio
import uvicorn

# Initialize Socket.IO server with CORS enabled
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = socketio.ASGIApp(sio)

# In-Memory Database Structure
rooms = {}
rate_limit_tracker = {}  # socket_id -> list of timestamps

# Helper: Sliding-window rate limiter (Max 5 updates/second)
def is_rate_limited(socket_id: str) -> bool:
    now = time.time()
    timestamps = rate_limit_tracker.get(socket_id, [])
    timestamps = [ts for ts in timestamps if now - ts < 1.0]
    
    if len(timestamps) >= 5:
        rate_limit_tracker[socket_id] = timestamps
        return True
    
    timestamps.append(now)
    rate_limit_tracker[socket_id] = timestamps
    return False


@sio.event
async def connect(sid, environ):
    pass


@sio.event
async def disconnect(sid):
    rate_limit_tracker.pop(sid, None)
    
    for room_id, room in list(rooms.items()):
        if sid in room['participants']:
            leaving_user = room['participants'].pop(sid)
            
            # Clean up empty room
            if len(room['participants']) == 0:
                del rooms[room_id]
                continue

            audit_entry = {
                "id": str(time.time()),
                "timestamp": datetime.now().strftime("%H:%M:%S"),
                "message": f"{leaving_user['username']} disconnected."
            }
            room['auditFeed'].append(audit_entry)
            
            # Dynamic Host Reassignment
            new_host = None
            if room['hostId'] == sid and len(room['participants']) > 0:
                remaining_users = sorted(room['participants'].values(), key=lambda u: u['joinedAt'])
                new_host = remaining_users[0]
                new_host['role'] = 'host'
                room['hostId'] = new_host['socketId']
                
                host_audit = {
                    "id": str(time.time() + 0.001),
                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                    "message": f"{new_host['username']} has been promoted to Host."
                }
                room['auditFeed'].append(host_audit)
            
            await sio.emit('presence:update', {
                'participants': list(room['participants'].values()),
                'audit': audit_entry,
                'newHost': new_host
            }, room=room_id)


@sio.on('room:join')
async def handle_join(sid, data):
    room_id = data.get('roomId')
    passcode = data.get('passcode')
    username = data.get('username')

    if not room_id or not username:
        return {'error': 'Room ID and Username are required.'}

    room = rooms.get(room_id)
    
    if not room:
        hashed_passcode = None
        if passcode:
            hashed_passcode = bcrypt.hashpw(passcode.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        room = {
            'id': room_id,
            'passcodeHash': hashed_passcode,
            'hasPasscode': bool(passcode),
            'hostId': sid,
            'content': '// Welcome to your synchronized Python workspace\n',
            'participants': {},
            'auditFeed': []
        }
        rooms[room_id] = room
    else:
        if room['hasPasscode']:
            if not passcode:
                return {'error': 'Passcode required'}
            if not bcrypt.checkpw(passcode.encode('utf-8'), room['passcodeHash'].encode('utf-8')):
                return {'error': 'Invalid room passcode'}

    is_host = len(room['participants']) == 0 or room['hostId'] == sid
    if is_host:
        room['hostId'] = sid

    participant = {
        'socketId': sid,
        'username': username,
        'role': 'host' if is_host else 'member',
        'joinedAt': time.time()
    }
    room['participants'][sid] = participant

    audit_entry = {
        'id': str(time.time()),
        'timestamp': datetime.now().strftime("%H:%M:%S"),
        'message': f"{username} joined the workspace."
    }
    room['auditFeed'].append(audit_entry)

    await sio.enter_room(sid, room_id)

    await sio.emit('presence:update', {
        'participants': list(room['participants'].values()),
        'audit': audit_entry
    }, room=room_id, skip_sid=sid)

    return {
        'success': True,
        'roomState': {
            'id': room['id'],
            'content': room['content'],
            'participants': list(room['participants'].values()),
            'auditFeed': room['auditFeed'],
            'currentUser': participant
        }
    }


@sio.on('editor:sync')
async def handle_editor_sync(sid, data):
    current_room_id = next((r_id for r_id, r in rooms.items() if sid in r['participants']), None)
    if not current_room_id:
        return

    if is_rate_limited(sid):
        await sio.emit('audit:warning', 'Rate limit exceeded: >5 updates/sec dropped.', to=sid)
        return

    code = data.get('code', '')
    rooms[current_room_id]['content'] = code
    await sio.emit('editor:sync', {'code': code, 'senderId': sid}, room=current_room_id, skip_sid=sid)


@sio.on('peer:status')
async def handle_peer_status(sid, data):
    if is_rate_limited(sid):
        return

    current_room_id = next((r_id for r_id, r in rooms.items() if sid in r['participants']), None)
    if current_room_id:
        data['socketId'] = sid
        await sio.emit('peer:status', data, room=current_room_id, skip_sid=sid)


if __name__ == '__main__':
    uvicorn.run("main:app", host="0.0.0.0", port=4000, reload=True)