
"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import Peer from 'simple-peer';
import type { Instance as PeerInstance, PeerError } from 'simple-peer';
import QRCode from 'react-qr-code';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Copy, Users, Wifi, WifiOff, Loader2, Trash2, ClipboardPaste, QrCode } from 'lucide-react';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

type ConnectionStatus = 'Connecting...' | 'Connected' | 'Disconnected';

export function ClipboardCard({ roomCode }: { roomCode: string }) {
  const [inputText, setInputText] = useState('');
  const inputTextRef = useRef(inputText);
  const { toast } = useToast();

  const peerId = useRef(Math.random().toString(36).substring(2));
  const peersRef = useRef(new Map<string, PeerInstance>());
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Connecting...');
  const [peerCount, setPeerCount] = useState(0);
  const [currentUrl, setCurrentUrl] = useState('');

  useEffect(() => {
    setCurrentUrl(window.location.href);
  }, []);

  useEffect(() => {
    inputTextRef.current = inputText;
  }, [inputText]);
  
  const connectToPeer = useCallback((remotePeerId: string, isInitiator: boolean, offer?: any) => {
    if (peersRef.current.has(remotePeerId)) {
      const existingPeer = peersRef.current.get(remotePeerId);
      if (existingPeer && !existingPeer.destroyed) {
        return; // Already have a live connection
      }
    }

    const newPeer = new Peer({ 
      initiator: isInitiator, 
      trickle: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });
    peersRef.current.set(remotePeerId, newPeer);

    newPeer.on('signal', async (data) => {
      // Send signal to the remote peer via the signaling server
      try {
        await fetch('/api/webrtc/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room: roomCode, from: peerId.current, to: remotePeerId, signal: data, type: 'signal' }),
        });
      } catch (err) {
        console.error("Failed to send signal", err);
      }
    });

    newPeer.on('connect', () => {
      // When a new peer connects, send them the current clipboard content
      newPeer.send(inputTextRef.current);
    });

    newPeer.on('data', (data) => {
      const receivedText = data.toString();
      setInputText(receivedText);
    });

    newPeer.on('close', () => {
      peersRef.current.delete(remotePeerId);
    });

    newPeer.on('error', (err: PeerError) => {
      console.error(`Peer error with ${remotePeerId}:`, err);
      if (peersRef.current.has(remotePeerId)) {
        peersRef.current.get(remotePeerId)?.destroy();
        peersRef.current.delete(remotePeerId);
      }
    });

    if (offer) {
      newPeer.signal(offer);
    }
  }, [roomCode]);


  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setInputText(text);
    // Broadcast text to all connected peers
    peersRef.current.forEach(peer => {
      if (peer.connected) {
        peer.send(text);
      }
    });
  };
  
  const handleClearClipboard = () => {
    const text = '';
    setInputText(text);
    peersRef.current.forEach(peer => {
      if (peer.connected) {
        peer.send(text);
      }
    });
  };


  const handleCopyToClipboard = async (text: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard!' });
  };
  
  const disconnect = () => {
    stopPolling();
    peersRef.current.forEach(peer => peer.destroy());
    peersRef.current.clear();
    setConnectionStatus('Disconnected');
    setPeerCount(0);
  };

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
    }
  }

  const startPolling = useCallback(() => {
    stopPolling();
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/webrtc/signal?room=${roomCode}&peerId=${peerId.current}`);
        if (!res.ok) {
            throw new Error(`Signaling server returned ${res.status}`);
        }
        const { peers: newPeerIds, signals } = await res.json();

        setConnectionStatus('Connected');
        setPeerCount(newPeerIds.length);

        // --- Handle new peers joining ---
        const currentPeers = Array.from(peersRef.current.keys());
        const peersToConnect = newPeerIds.filter((p: string) => p !== peerId.current && !currentPeers.includes(p));
        peersToConnect.forEach((remotePeerId: string) => {
            // we are the "initiator" if our ID is alphabetically smaller
            if(peerId.current > remotePeerId) {
                connectToPeer(remotePeerId, true);
            }
        });

        // --- Handle incoming signals ---
        for (const { from, to, signal, type } of signals) {
           if (signal && to === peerId.current) {
                const peer = peersRef.current.get(from);
                if (peer && !peer.destroyed) {
                    peer.signal(signal);
                } else if (!peer) {
                    // This is an offer from a new peer
                    connectToPeer(from, false, signal);
                }
            } else if (type === 'leave' && from !== peerId.current) {
                if (peersRef.current.has(from)) {
                    peersRef.current.get(from)?.destroy();
                    peersRef.current.delete(from);
                }
            }
        }
      } catch (err) {
        console.error("Polling error:", err);
        toast({ variant: 'destructive', title: 'Connection Error', description: 'Lost connection to signaling server.' });
        disconnect();
      }
    }, 2000);
  }, [roomCode, connectToPeer]);
  
  useEffect(() => {
    startPolling();
    
    // Cleanup on component unmount
    return () => {
        disconnect();
    };
  }, [startPolling]);


  const getStatusBadgeVariant = () => {
    switch(connectionStatus) {
      case 'Connected': return 'default';
      case 'Connecting...': return 'secondary';
      case 'Disconnected': return 'destructive';
      default: return 'outline';
    }
  }
  
  const getStatusIcon = () => {
      switch(connectionStatus) {
        case 'Connecting...': return <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
        case 'Connected': return <Wifi className="mr-2 h-4 w-4" />;
        case 'Disconnected': return <WifiOff className="mr-2 h-4 w-4" />;
        default: return null;
      }
  }

  return (
    <Card className="w-full max-w-2xl shadow-2xl animate-in fade-in zoom-in-95 border-primary/20 bg-card/80 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
            <div className='flex items-center gap-3'>
                <div className="p-3 rounded-lg bg-primary/10">
                    <ClipboardPaste className="w-6 h-6 text-primary" />
                </div>
                <div>
                    <CardTitle className="text-2xl font-bold font-headline flex items-center gap-2">
                      Firext
                       <Badge variant="outline" className="text-xs font-mono tracking-widest">{roomCode}</Badge>
                       <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={!currentUrl}>
                                    <QrCode className="h-4 w-4" />
                                    <span className="sr-only">Show QR Code</span>
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-2 bg-white">
                                {currentUrl && <QRCode value={currentUrl} size={128} />}
                            </PopoverContent>
                        </Popover>
                    </CardTitle>
                    <CardDescription>Cross-device clipboard powered by WebRTC.</CardDescription>
                </div>
            </div>
             <div className="text-right">
                <Badge variant={getStatusBadgeVariant()} className="text-sm">
                    {getStatusIcon()}
                    {connectionStatus}
                </Badge>
                {connectionStatus === 'Connected' && (
                    <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground mt-1">
                        <Users className="h-3 w-3" />
                        <span>{peerCount} {peerCount === 1 ? 'peer' : 'peers'} connected</span>
                    </div>
                )}
            </div>
        </div>
      </CardHeader>
      <CardContent>
         <div className="space-y-2">
            <Label htmlFor="clipboard-textarea">Synced Clipboard</Label>
            <Textarea
                id="clipboard-textarea"
                value={inputText}
                onChange={handleTextChange}
                placeholder={connectionStatus === 'Connecting...' ? 'Connecting to room...' : 'Your synced clipboard content will appear here...'}
                rows={10}
                disabled={connectionStatus !== 'Connected' && peerCount === 0}
            />
        </div>
      </CardContent>
      <CardFooter className="flex flex-row gap-2 justify-start bg-muted/30 py-4 px-6">
        <Button onClick={() => handleCopyToClipboard(inputText)} disabled={!inputText}>
            <Copy className="mr-2 h-4 w-4" />
            Copy
        </Button>
        <Button variant="outline" onClick={handleClearClipboard} disabled={!inputText}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clear
        </Button>
      </CardFooter>
    </Card>
  );
}
