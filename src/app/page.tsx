"use client";

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Wifi } from 'lucide-react';
import Image from 'next/image';

export default function Home() {
  const router = useRouter();

  const handleCreateRoom = () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let newRoomCode = '';
    for (let i = 0; i < 6; i++) {
      newRoomCode += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    router.push(`/${newRoomCode}`);
  };

  return (
    <main className="flex min-h-full flex-col items-center justify-center p-4 sm:p-8 md:p-12 bg-background">
      <Card className="w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 border-primary/20 bg-card/80 backdrop-blur-sm">
        <CardHeader className="items-center text-center">
          <Image src="/logo.png" alt="FliqShare Logo" width={64} height={64} className="mb-4 rounded-md" />
          <CardTitle className="text-3xl font-bold font-headline">FliqShare</CardTitle>
          <CardDescription>
            A real-time, cross-device clipboard. <br /> Create a room and share the URL to get started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleCreateRoom} className="w-full" size="lg">
            <Wifi className="mr-2 h-5 w-5" />
            Create a New Room
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
