
import {NextRequest, NextResponse} from 'next/server';

// In-memory store for signaling data.
// NOTE: This is not suitable for production with multiple server instances.
// For production, a shared store like Redis or a database should be used.
const rooms = new Map<string, { offer?: any; answer?: any; timeoutId?: NodeJS.Timeout }>();

export async function POST(req: NextRequest) {
  try {
    const { room, signal } = await req.json();

    if (!room || !signal) {
      return NextResponse.json({ error: 'Missing room or signal' }, { status: 400 });
    }

    if (!rooms.has(room)) {
      rooms.set(room, {});
    }

    const roomData = rooms.get(room)!;

    // Clear any existing cleanup timeout to prevent premature deletion
    if (roomData.timeoutId) {
        clearTimeout(roomData.timeoutId);
    }

    if (signal.type === 'offer') {
      // A new room is created with an offer
      roomData.offer = signal;
      // If a user re-creates a room, clear any old answer
      roomData.answer = undefined; 
    } else if (signal.type === 'answer') {
      // A user joins and provides an answer
      roomData.answer = signal;
    } else {
        return NextResponse.json({ error: 'Invalid signal type' }, { status: 400 });
    }
    
    // Set a new timeout to clean up the room after 5 minutes of inactivity
    roomData.timeoutId = setTimeout(() => {
        if (rooms.has(room)) {
            rooms.delete(room);
        }
    }, 1000 * 60 * 5);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Signaling error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const room = searchParams.get('room');

  if (!room) {
    return NextResponse.json({ error: 'Missing room parameter' }, { status: 400 });
  }

  const roomData = rooms.get(room);
  
  if (!roomData) {
    return NextResponse.json(null);
  }
  
  // Exclude the timeoutId from the response
  const { timeoutId, ...dataToSend } = roomData;

  return NextResponse.json(dataToSend);
}
