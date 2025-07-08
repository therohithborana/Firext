
"use client";

import { useState, useRef, useEffect } from 'react';
import Peer from 'simple-peer';
import type { Instance as PeerInstance } from 'simple-peer';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Copy, ClipboardPaste, Loader2, Wifi, WifiOff } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { Input } from './ui/input';

type ConnectionStatus = 'Disconnected' | 'Connecting...' | 'Connected' | 'Error' | 'Waiting...';

export function ClipboardCard() {
  const [inputText, setInputText] = useState('');
  const { toast } = useToast();

  const peerRef = useRef<PeerInstance | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isManuallyDisconnecting = useRef(false);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Disconnected');
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  
  const [roomCode, setRoomCode] = useState('');
  const [inputRoomCode, setInputRoomCode] = useState('');
  const [isInitiator, setIsInitiator] = useState(false);

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  useEffect(() => {
    // Cleanup peer connection and polling on component unmount
    return () => {
      stopPolling();
      peerRef.current?.destroy();
    };
  }, []);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setInputText(text);
    if (peerRef.current?.connected) {
      peerRef.current.send(text);
    }
  };

  const resetConnectionState = (keepSheetOpen = false) => {
    peerRef.current?.destroy();
    peerRef.current = null;
    stopPolling();
    setRoomCode('');
    setInputRoomCode('');
    setConnectionStatus('Disconnected');
    setIsInitiator(false);
    if (!keepSheetOpen) {
      setIsSheetOpen(false);
    }
  }

  const setupPeer = (initiator: boolean, currentRoomCode: string) => {
    if (peerRef.current) {
      peerRef.current.destroy();
    }
    
    setIsInitiator(initiator);

    const newPeer = new Peer({ initiator, trickle: false });
    peerRef.current = newPeer;

    newPeer.on('signal', async (signal) => {
      // Initiator sends the offer to the server
      if (initiator && signal.type === 'offer') {
        try {
          await fetch('/api/webrtc/signal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: currentRoomCode, signal }),
          });
          startPollingForAnswer(currentRoomCode);
        } catch (err) {
            console.error(err);
            toast({ variant: 'destructive', title: 'Signaling Error', description: 'Could not contact signaling server.' });
            resetConnectionState(true);
            setConnectionStatus('Error');
        }
      }
      // Joiner sends the answer to the server
      else if (!initiator && signal.type === 'answer') {
         try {
            await fetch('/api/webrtc/signal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room: currentRoomCode, signal }),
            });
        } catch(err) {
            console.error(err);
            toast({ variant: 'destructive', title: 'Signaling Error', description: 'Could not contact signaling server.' });
            resetConnectionState(true);
            setConnectionStatus('Error');
        }
      }
    });

    newPeer.on('connect', () => {
      stopPolling();
      setConnectionStatus('Connected');
      toast({ title: 'Connection established!', description: 'Clipboard is now synced.' });
      setIsSheetOpen(false);
    });

    newPeer.on('data', (data) => {
      const receivedText = data.toString();
      setInputText(receivedText);
    });

    newPeer.on('close', () => {
      // Case 1: User manually clicks a disconnect/cancel button.
      if (isManuallyDisconnecting.current) {
        isManuallyDisconnecting.current = false; // Reset flag
        const wasConnected = connectionStatus === 'Connected';
        resetConnectionState(!wasConnected); // Keep sheet open if we were just waiting/connecting
        
        if (wasConnected) {
          toast({ variant: 'destructive', title: 'Connection closed', description: 'You have left the room.' });
        }
        return;
      }
    
      // Case 2: Host's peer disconnects because participant left.
      if (isInitiator) {
        toast({ title: 'Peer disconnected', description: 'The room is still open. Waiting for a new peer...' });
        setConnectionStatus('Waiting...');
        // Manually clear the ref to the closed peer before re-initializing.
        peerRef.current = null;
        // Re-create the peer to wait for a new connection.
        setupPeer(true, roomCode);
      } else {
        // Case 3: Participant's peer disconnects because host left.
        toast({ variant: 'destructive', title: 'Host disconnected', description: 'The room has been closed.' });
        resetConnectionState();
      }
    });

    newPeer.on('error', (err) => {
      console.error('WebRTC Peer Error:', err);
      // Avoid showing generic error toast if we are already handling a manual disconnect
      if (!isManuallyDisconnecting.current) {
        toast({ variant: 'destructive', title: 'Connection Error', description: 'Something went wrong.' });
      }
      resetConnectionState(true);
      setConnectionStatus('Error');
    });
  };

  const handleCreateRoom = () => {
    const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomCode(newRoomCode);
    setConnectionStatus('Waiting...');
    setupPeer(true, newRoomCode);
  };

  const startPollingForAnswer = (currentRoomCode: string) => {
    stopPolling();
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/webrtc/signal?room=${currentRoomCode}`);
        if (!res.ok) throw new Error("Failed to poll");
        
        const data = await res.json();
        
        if (data?.answer) {
          stopPolling();
          if (peerRef.current && !peerRef.current.destroyed) {
            peerRef.current.signal(data.answer);
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
        stopPolling();
        resetConnectionState(true);
        setConnectionStatus('Error');
        toast({ variant: 'destructive', title: 'Connection Failed', description: 'Could not get response from peer.' });
      }
    }, 2000); // Poll every 2 seconds
  };
  
  const handleJoinRoom = async () => {
    const code = inputRoomCode.trim().toUpperCase();
    if (!code) {
      toast({ variant: 'destructive', title: 'Please enter a room code.' });
      return;
    }
    setRoomCode(code);
    setConnectionStatus('Connecting...');
    try {
        const res = await fetch(`/api/webrtc/signal?room=${code}`);
        if (!res.ok) throw new Error("Room not found or server error");
        const data = await res.json();

        if (data?.offer) {
            setupPeer(false, code);
            if (peerRef.current && !peerRef.current.destroyed) {
                peerRef.current.signal(data.offer);
            }
        } else {
            toast({ variant: 'destructive', title: 'Room not found', description: 'Please check the code and try again.' });
            resetConnectionState(true);
            setConnectionStatus('Error');
        }
    } catch (err) {
        console.error("Join room error:", err);
        toast({ variant: 'destructive', title: 'Error Joining Room', description: 'Could not connect to the signaling server.' });
        resetConnectionState(true);
        setConnectionStatus('Error');
    }
  };

  const handleDisconnect = () => {
    isManuallyDisconnecting.current = true;
    peerRef.current?.destroy();
  };

  const handleCopyToClipboard = async (text: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard!' });
  };
  
  const getStatusBadgeVariant = () => {
    switch(connectionStatus) {
      case 'Connected': return 'default';
      case 'Connecting...': return 'secondary';
      case 'Waiting...': return 'secondary';
      case 'Disconnected': return 'outline';
      case 'Error': return 'destructive';
      default: return 'outline';
    }
  }

  // Reset connection state if the sheet is closed, but only if we're not
  // in the middle of connecting or already connected. This allows the user
  // to close the sheet without aborting the connection attempt.
  useEffect(() => {
    if (!isSheetOpen) {
      if (connectionStatus !== 'Connected' && connectionStatus !== 'Connecting...' && connectionStatus !== 'Waiting...') {
          resetConnectionState();
      }
    }
  }, [isSheetOpen, connectionStatus]);


  return (
    <>
      <Card className="w-full max-w-2xl shadow-2xl animate-in fade-in zoom-in-95 border-primary/20 bg-background/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
              <div className='flex items-center gap-3'>
                  <div className="p-3 rounded-lg bg-primary/10">
                      <ClipboardPaste className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                      <CardTitle className="text-2xl font-bold font-headline flex items-center gap-2">
                        Firext
                        <Badge variant={getStatusBadgeVariant()} className="text-xs">{connectionStatus}</Badge>
                         {connectionStatus === 'Connected' && roomCode && (
                            <Badge variant="outline" className="text-xs font-mono tracking-widest">{roomCode}</Badge>
                         )}
                      </CardTitle>
                      <CardDescription>Cross-device clipboard powered by WebRTC.</CardDescription>
                  </div>
              </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="clipboard-textarea">Your Clipboard</Label>
            <Textarea
              id="clipboard-textarea"
              value={inputText}
              onChange={handleTextChange}
              placeholder="Your synced clipboard content will appear here..."
              rows={8}
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row gap-2 justify-between bg-muted/30 py-4 px-6">
          <div className="flex gap-2">
            <Button onClick={() => handleCopyToClipboard(inputText)} disabled={!inputText}>
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
          </div>
          
           {connectionStatus === 'Connected' ? (
                isInitiator ? (
                    <Button onClick={handleDisconnect} variant="destructive" className="gap-2">
                        <WifiOff />
                        Close Room
                    </Button>
                ) : (
                    <Button onClick={handleDisconnect} variant="outline" className="gap-2">
                        <WifiOff />
                        Leave Room
                    </Button>
                )
            ) : (
              <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetTrigger asChild>
                  <Button>
                    <Wifi className="mr-2 h-4 w-4" />
                    Connect to Peer
                  </Button>
                </SheetTrigger>
                <SheetContent className="w-full sm:max-w-lg">
                  <SheetHeader>
                    <SheetTitle>Connect via Room Code</SheetTitle>
                    <SheetDescription>
                      Create a room and share the code, or join an existing room.
                       <br/>
                       <span className='font-semibold'>Status: {connectionStatus}</span>
                    </SheetDescription>
                  </SheetHeader>
                    <div className="py-6 space-y-6">
                        {connectionStatus === 'Waiting...' && roomCode ? (
                            <div className="text-center space-y-4 animate-in fade-in">
                                <Label className="text-base">Share this code with your peer:</Label>
                                <div className="relative">
                                    <div className="text-4xl font-bold tracking-widest bg-muted p-4 rounded-lg text-primary">{roomCode}</div>
                                    <Button variant="ghost" size="icon" className="absolute top-1/2 right-2 -translate-y-1/2" onClick={() => handleCopyToClipboard(roomCode)}>
                                        <Copy className="w-6 h-6"/>
                                    </Button>
                                </div>
                                <div className='flex items-center justify-center text-muted-foreground pt-2'>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    <span>Waiting for peer to join...</span>
                                </div>
                                <Button variant="outline" onClick={handleDisconnect} className="w-full mt-4">
                                  Cancel
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-6 animate-in fade-in">
                                <div className="space-y-3">
                                    <Label htmlFor="join-code" className="font-bold text-base">Join a Room</Label>
                                    <div className="flex gap-2">
                                        <Input 
                                            id="join-code" 
                                            value={inputRoomCode} 
                                            onChange={(e) => setInputRoomCode(e.target.value.toUpperCase())} 
                                            placeholder="Enter Room Code" 
                                            onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
                                            disabled={connectionStatus === 'Connecting...'}
                                        />
                                        <Button onClick={handleJoinRoom} disabled={connectionStatus === 'Connecting...' || !inputRoomCode}>
                                            {connectionStatus === 'Connecting...' && !roomCode ? <Loader2 className="h-4 w-4 animate-spin"/> : "Join"}
                                        </Button>
                                    </div>
                                </div>
                                
                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-background px-2 text-muted-foreground">Or</span>
                                    </div>
                                </div>

                                <Button onClick={handleCreateRoom} className="w-full" disabled={connectionStatus === 'Connecting...' || connectionStatus === 'Waiting...'}>
                                    Create a New Room
                                </Button>
                            </div>
                        )}
                         {connectionStatus === 'Error' && (
                          <Button onClick={() => resetConnectionState(true)} variant="outline" className="w-full">
                            Try Again
                          </Button>
                        )}
                    </div>
                </SheetContent>
              </Sheet>
            )}
        </CardFooter>
      </Card>
    </>
  );
}
