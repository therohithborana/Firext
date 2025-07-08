
import {NextRequest, NextResponse} from 'next/server';

// In-memory store for signaling data.
// NOTE: This is not suitable for production with multiple server instances.
// For production, a shared store like Redis or a database should be used.
const rooms = new Map<string, { peers: Set<string>, signals: any[] }>();
const PEER_TIMEOUT_MS = 30000; // 30 seconds
const peerLastSeen = new Map<string, number>();


function getRoom(roomCode: string) {
    if (!rooms.has(roomCode)) {
        rooms.set(roomCode, { peers: new Set(), signals: [] });
    }
    return rooms.get(roomCode)!;
}

// Cleanup inactive peers
function cleanupInactivePeers(roomCode: string) {
    const room = getRoom(roomCode);
    const now = Date.now();
    const inactivePeers: string[] = [];

    for (const peerId of room.peers) {
        if (!peerLastSeen.has(peerId) || (now - peerLastSeen.get(peerId)!) > PEER_TIMEOUT_MS) {
            inactivePeers.push(peerId);
        }
    }

    if (inactivePeers.length > 0) {
        for (const peerId of inactivePeers) {
            room.peers.delete(peerId);
            peerLastSeen.delete(peerId);
            // Add a "leave" signal so other clients know to disconnect from this peer
            room.signals.push({ type: 'leave', from: peerId });
        }
    }

    // Also cleanup room if empty
    if(room.peers.size === 0 && room.signals.filter(s => s.type !== 'leave').length === 0) {
        rooms.delete(roomCode);
    }
}


export async function POST(req: NextRequest) {
    try {
        const { room, from, to, signal, type } = await req.json();

        if (!room || !from) {
            return NextResponse.json({ error: 'Missing room or from peerId' }, { status: 400 });
        }

        const roomData = getRoom(room);
        
        if (type === 'signal' && to && signal) {
            roomData.signals.push({ from, to, signal });
        } else {
             return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Signaling POST error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}


export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const room = searchParams.get('room');
    const peerId = searchParams.get('peerId');

    if (!room || !peerId) {
        return NextResponse.json({ error: 'Missing room or peerId parameter' }, { status: 400 });
    }

    // Cleanup before processing
    cleanupInactivePeers(room);

    const roomData = getRoom(room);

    // Register peer presence or update last seen timestamp
    if (!roomData.peers.has(peerId)) {
        roomData.peers.add(peerId);
        // Add a join signal for other peers to see
        roomData.signals.push({type: 'join', from: peerId});
    }
    peerLastSeen.set(peerId, Date.now());


    const signalsForPeer = roomData.signals.filter(s => s.to === peerId || (s.from !== peerId && ['join', 'leave'].includes(s.type)));
    
    // Filter out signals that have already been sent to this peer by adding a sentTo map
    const newSignalsForPeer = [];
    for(const signal of signalsForPeer) {
        if(!signal.sentTo) signal.sentTo = new Set();
        if(!signal.sentTo.has(peerId)) {
            newSignalsForPeer.push(signal);
            signal.sentTo.add(peerId);
        }
    }

    // When all peers have seen a join/leave message, it can be removed
    roomData.signals = roomData.signals.filter(s => {
       if(['join', 'leave'].includes(s.type)) {
           // check if all current peers have seen it
           const allPeers = new Set(roomData.peers);
           if (s.from && allPeers.has(s.from)) {
               allPeers.delete(s.from);
           }
           if (!s.sentTo || s.sentTo.size < allPeers.size) {
               return true; // keep it
           }
           return false; // remove it
       }
       // keep signal until recipient has seen it
       return !s.sentTo?.has(s.to);
    });

    return NextResponse.json({
        peers: Array.from(roomData.peers).filter(p => p !== peerId),
        signals: newSignalsForPeer,
    });
}
