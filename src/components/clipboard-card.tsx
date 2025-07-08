
"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import Peer from 'simple-peer';
import type { Instance as PeerInstance, PeerError } from 'simple-peer';
import QRCode from 'react-qr-code';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Copy, Users, Wifi, WifiOff, Loader2, Trash2, ClipboardPaste, QrCode, Link2 } from 'lucide-react';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

type ConnectionStatus = 'Connecting...' | 'Connected' | 'Disconnected';
type ClipboardContent = { type: 'text' | 'image'; data: string };

export function ClipboardCard({ roomCode }: { roomCode: string }) {
  const [clipboardContent, setClipboardContent] = useState<ClipboardContent>({ type: 'text', data: '' });
  const clipboardContentRef = useRef(clipboardContent);
  const { toast } = useToast();

  const peerId = useRef<string>('');
  const peersRef = useRef(new Map<string, PeerInstance>());
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Connecting...');
  const [peerCount, setPeerCount] = useState(0);
  const [currentUrl, setCurrentUrl] = useState('');
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    peerId.current = Math.random().toString(36).substring(2);
    setCurrentUrl(window.location.href);
    setIsMounted(true);
  }, []);

  useEffect(() => {
    clipboardContentRef.current = clipboardContent;
  }, [clipboardContent]);
  
  const broadcastContent = useCallback((content: ClipboardContent) => {
    const message = JSON.stringify(content);
    peersRef.current.forEach(peer => {
      if (peer.connected) {
        peer.send(message);
      }
    });
  }, []);

  const connectToPeer = useCallback((remotePeerId: string, isInitiator: boolean, offer?: any) => {
    if (peersRef.current.has(remotePeerId)) {
      const existingPeer = peersRef.current.get(remotePeerId);
      if (existingPeer && !existingPeer.destroyed) {
        return;
      }
    }

    const newPeer = new Peer({ 
      initiator: isInitiator, 
      trickle: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ]
      }
    });
    peersRef.current.set(remotePeerId, newPeer);

    newPeer.on('signal', async (data) => {
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
      newPeer.send(JSON.stringify(clipboardContentRef.current));
    });

    newPeer.on('data', (data) => {
      const receivedText = data.toString();
       try {
        const receivedContent = JSON.parse(receivedText);
        if ((receivedContent.type === 'text' || receivedContent.type === 'image') && typeof receivedContent.data === 'string') {
            setClipboardContent(receivedContent);
        } else {
             console.warn("Received malformed content object:", receivedContent);
        }
      } catch (error) {
        console.warn("Received non-JSON data, treating as text:", receivedText);
        setClipboardContent({ type: 'text', data: receivedText });
      }
    });

    newPeer.on('close', () => {
      peersRef.current.delete(remotePeerId);
    });

    newPeer.on('error', (err: PeerError) => {
      console.error(`Peer error with ${remotePeerId}:`, err);
       if (err.code === 'ERR_CONNECTION_FAILURE') {
         toast({ variant: 'destructive', title: 'Connection Failed', description: 'Could not connect to a peer. Please check your network.' });
       }
      if (peersRef.current.has(remotePeerId)) {
        peersRef.current.get(remotePeerId)?.destroy();
        peersRef.current.delete(remotePeerId);
      }
    });

    if (offer) {
      newPeer.signal(offer);
    }
  }, [roomCode, toast]);


  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    const newContent: ClipboardContent = { type: 'text', data: text };
    setClipboardContent(newContent);
    broadcastContent(newContent);
  };
  
  const handleClearClipboard = () => {
    const newContent: ClipboardContent = { type: 'text', data: '' };
    setClipboardContent(newContent);
    broadcastContent(newContent);
  };

  const handleCopyToClipboard = async (text: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard!' });
  };
  
  const handleCopyUrl = async () => {
    if (!currentUrl) return;
    await navigator.clipboard.writeText(currentUrl);
    toast({ title: 'Room URL copied!' });
  };
  
  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
            e.preventDefault();
            const blob = items[i].getAsFile();
            if (!blob) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUri = event.target?.result as string;
                if(dataUri) {
                    const newContent: ClipboardContent = { type: 'image', data: dataUri };
                    setClipboardContent(newContent);
                    broadcastContent(newContent);
                }
            };
            reader.readAsDataURL(blob);
            return;
        }
    }
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

        const currentPeers = Array.from(peersRef.current.keys());
        const peersToConnect = newPeerIds.filter((p: string) => p !== peerId.current && !currentPeers.includes(p));
        peersToConnect.forEach((remotePeerId: string) => {
            if(peerId.current > remotePeerId) {
                connectToPeer(remotePeerId, true);
            }
        });

        for (const { from, to, signal, type } of signals) {
           if (signal && to === peerId.current) {
                const peer = peersRef.current.get(from);
                if (peer && !peer.destroyed) {
                    peer.signal(signal);
                } else if (!peer) {
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
  }, [roomCode, connectToPeer, toast]);
  
  useEffect(() => {
    if (!isMounted) return;
    
    startPolling();
    
    return () => {
        disconnect();
    };
  }, [isMounted, startPolling]);


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
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className='flex items-center gap-3'>
                <div className="p-3 rounded-lg bg-primary/10">
                    <ClipboardPaste className="w-6 h-6 text-primary" />
                </div>
                <div>
                    <CardTitle className="text-2xl font-bold font-headline flex items-center gap-2">
                      Firext
                       <Badge variant="outline" className="text-xs font-mono tracking-widest">{roomCode}</Badge>
                       {isMounted ? (
                         <Popover>
                              <PopoverTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6">
                                      <QrCode className="h-4 w-4" />
                                      <span className="sr-only">Show QR Code</span>
                                  </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-2 bg-white">
                                  {currentUrl && <QRCode value={currentUrl} size={128} />}
                              </PopoverContent>
                          </Popover>
                        ) : (
                          <div className="h-6 w-6 rounded-sm bg-muted/50 animate-pulse" />
                        )}
                    </CardTitle>
                    <CardDescription>Cross-device clipboard powered by WebRTC.</CardDescription>
                </div>
            </div>
             <div className="text-right w-full sm:w-auto">
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
        <div className="mt-4 flex items-center gap-2 rounded-md bg-muted/50 p-2 text-sm">
            <Link2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
             {isMounted ? (
                <>
                    <input
                        type="text"
                        readOnly
                        value={currentUrl}
                        className="flex-1 truncate bg-transparent font-mono text-muted-foreground outline-none"
                        aria-label="Room URL"
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={handleCopyUrl}>
                        <span className="sr-only">Copy URL</span>
                        <Copy className="h-4 w-4" />
                    </Button>
                </>
            ) : (
                <>
                    <div className="flex-1 h-5 rounded-sm bg-muted/50 animate-pulse" />
                    <div className="h-7 w-7 rounded-sm bg-muted/50 animate-pulse" />
                </>
            )}
        </div>
      </CardHeader>
      <CardContent onPaste={handlePaste}>
         <div className="space-y-2">
            <Label htmlFor="clipboard-textarea">Synced Clipboard</Label>
            {clipboardContent.type === 'image' && clipboardContent.data ? (
                <div className="mb-2 relative p-2 border rounded-md min-h-[220px] flex items-center justify-center bg-muted/20">
                    <img
                        src={clipboardContent.data}
                        alt="Pasted clipboard content"
                        className="max-w-full max-h-full object-contain rounded-md"
                        style={{ maxHeight: '220px' }}
                    />
                </div>
            ) : null}
            <Textarea
                id="clipboard-textarea"
                value={clipboardContent.type === 'text' ? clipboardContent.data : ''}
                onChange={handleTextChange}
                placeholder={connectionStatus === 'Connecting...' ? 'Connecting to room...' : 'Type or paste content here...'}
                rows={clipboardContent.type === 'image' && clipboardContent.data ? 4 : 10}
                disabled={connectionStatus !== 'Connected' && peerCount === 0}
            />
        </div>
      </CardContent>
      <CardFooter className="flex flex-col sm:flex-row items-stretch gap-2 justify-start bg-muted/30 py-4 px-6">
        <Button onClick={() => handleCopyToClipboard(clipboardContent.data)} disabled={clipboardContent.type !== 'text' || !clipboardContent.data}>
            <Copy className="mr-2 h-4 w-4" />
            Copy Text
        </Button>
        <Button variant="outline" onClick={handleClearClipboard} disabled={!clipboardContent.data}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clear
        </Button>
      </CardFooter>
    </Card>
  );
}

    