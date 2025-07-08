
import { ClipboardCard } from '@/components/clipboard-card';

export default function RoomPage({ params }: { params: { room: string } }) {
  // Ensure room code is valid format (lowercase letters, length 6)
  const isValidRoom = /^[a-z]{6}$/.test(params.room);

  if (!isValidRoom) {
      // TODO: Show a proper "Invalid Room" page
      return (
        <main className="flex min-h-full flex-col items-center justify-center p-4 sm:p-8 md:p-12 bg-background">
            <h1 className="text-2xl text-destructive">Invalid Room Code</h1>
            <p className="text-muted-foreground">Room codes must be 6 lowercase letters.</p>
        </main>
      )
  }

  return (
    <main className="flex min-h-full flex-col items-center justify-center p-4 sm:p-8 md:p-12 bg-background">
      <ClipboardCard roomCode={params.room} />
    </main>
  );
}
