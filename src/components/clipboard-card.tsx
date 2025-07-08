
"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import Peer from 'simple-peer';
import type { Instance as PeerInstance, PeerError } from 'simple-peer';
import QRCode from 'react-qr-code';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Copy, Users, Wifi, WifiOff, Loader2, Trash2, ClipboardPaste, QrCode, Link2, Upload, File as FileIcon, Download } from 'lucide-react';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

type ConnectionStatus = 'Connecting...' | 'Connected' | 'Disconnected';
type ClipboardImage = { id: string; data: string };
type ClipboardFile = { id: string; name: string; type: string; size: number; data: string };

type IncomingItem = {
    chunks: string[];
    received: number;
    total: number;
    contentType: 'image' | 'file';
    itemId: string;
    fileInfo?: { name: string; type: string; size: number };
};

const CHUNK_SIZE = 64 * 1024; // 64KB

function formatBytes(bytes: number, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}


export function ClipboardCard({ roomCode }: { roomCode: string }) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<ClipboardImage[]>([]);
  const [files, setFiles] = useState<ClipboardFile[]>([]);
  const { toast } = useToast();

  const textRef = useRef(text);
  const imagesRef = useRef(images);
  const filesRef = useRef(files);
  useEffect(() => { textRef.current = text; }, [text]);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => { filesRef.current = files; }, [files]);

  const peerId = useRef<string>('');
  const peersRef = useRef(new Map<string, PeerInstance>());
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const incomingFilesRef = useRef(new Map<string, IncomingItem>());
  const fileInputRef = useRef<HTMLInputElement>(null);


  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Connecting...');
  const [peerCount, setPeerCount] = useState(0);
  const [currentUrl, setCurrentUrl] = useState('');
  const [isMounted, setIsMounted] = useState(false);

  const sendChunkedData = useCallback((peer: PeerInstance, item: ClipboardImage | ClipboardFile, contentType: 'image' | 'file') => {
    const fileId = Math.random().toString(36).substring(2);
    const data = item.data;
    const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
    let chunkIndex = 0;

    const startMessage = JSON.stringify({
        protocol: 'firext-chunking',
        type: 'start',
        fileId,
        totalChunks,
        contentType,
        itemId: item.id,
        ...(contentType === 'file' && {
            fileName: (item as ClipboardFile).name,
            fileType: (item as ClipboardFile).type,
            fileSize: (item as ClipboardFile).size,
        }),
    });
    peer.send(startMessage);

    const sendNextChunk = () => {
        if (chunkIndex >= totalChunks) return;

        const channel = (peer as any)._channel;
        const bufferThreshold = 256 * 1024;

        if (channel && channel.bufferedAmount > bufferThreshold) {
            setTimeout(sendNextChunk, 50);
            return;
        }

        const chunk = data.slice(chunkIndex * CHUNK_SIZE, (chunkIndex + 1) * CHUNK_SIZE);
        const chunkMessage = JSON.stringify({
            protocol: 'firext-chunking',
            type: 'chunk',
            fileId,
            index: chunkIndex,
            data: chunk,
        });

        try {
            peer.send(chunkMessage);
            chunkIndex++;
            setTimeout(sendNextChunk, 0);
        } catch (error) {
            console.error("Failed to send chunk, aborting transfer.", error);
        }
    };
    sendNextChunk();
  }, []);

  const broadcastRaw = useCallback((message: string) => {
    peersRef.current.forEach(peer => {
        if (peer.connected) {
            try {
              peer.send(message);
            } catch(err) {
              console.error("Failed to send content:", err);
            }
        }
    });
  }, []);

  const broadcastChunked = useCallback((item: ClipboardImage | ClipboardFile, type: 'image' | 'file') => {
      peersRef.current.forEach(peer => {
          if (peer.connected) {
              sendChunkedData(peer, item, type);
          }
      });
  }, [sendChunkedData]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      peerId.current = Math.random().toString(36).substring(2);
      setCurrentUrl(window.location.href);
      setIsMounted(true);
    }
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
      // When we connect, we request the full state from the other peer.
      newPeer.send(JSON.stringify({ type: 'syncRequest' }));
    });

    newPeer.on('data', (data) => {
      const messageStr = data.toString();
      try {
          const message = JSON.parse(messageStr);

          if (message.protocol === 'firext-chunking') {
              const { type, fileId, totalChunks, index, data: chunkData, contentType, itemId, fileName, fileType, fileSize } = message;

              if (type === 'start') {
                  incomingFilesRef.current.set(fileId, {
                      chunks: new Array(totalChunks),
                      received: 0,
                      total: totalChunks,
                      contentType,
                      itemId,
                      fileInfo: contentType === 'file' ? { name: fileName, type: fileType, size: fileSize } : undefined,
                  });
                  return;
              }

              if (type === 'chunk') {
                  const fileData = incomingFilesRef.current.get(fileId);
                  if (fileData && !fileData.chunks[index]) {
                      fileData.chunks[index] = chunkData;
                      fileData.received++;
                      
                      if(fileData.received === fileData.total) {
                          const fullDataUri = fileData.chunks.join('');
                          if (fileData.contentType === 'image') {
                            setImages(current => {
                              if (current.some(img => img.id === fileData.itemId)) return current;
                              return [...current, { id: fileData.itemId, data: fullDataUri }];
                            });
                          } else if (fileData.contentType === 'file') {
                            setFiles(current => {
                                if (current.some(f => f.id === fileData.itemId)) return current;
                                return [...current, { id: fileData.itemId, ...fileData.fileInfo!, data: fullDataUri }];
                            });
                          }
                          incomingFilesRef.current.delete(fileId);
                      }
                  }
                  return;
              }
          }
          
          switch(message.type) {
            case 'syncRequest':
              // The other peer is requesting our state, so we send it.
              newPeer.send(JSON.stringify({
                type: 'fullSync',
                data: { text: textRef.current, images: imagesRef.current, files: filesRef.current }
              }));
              break;
            case 'fullSync':
              // We've received the full state from another peer.
              setText(message.data.text);
              setImages(message.data.images);
              setFiles(message.data.files || []);
              break;
            case 'textUpdate':
              setText(message.data);
              break;
            case 'imageRemove':
              setImages(current => current.filter(img => img.id !== message.data));
              break;
            case 'fileRemove':
              setFiles(current => current.filter(f => f.id !== message.data));
              break;
            case 'clear':
              setText('');
              setImages([]);
              setFiles([]);
              break;
            default:
              if (typeof message === 'string') {
                  setText(message);
              } else {
                  console.warn("Received malformed or unhandled message:", message);
              }
          }
        } catch (error) {
          // Fallback for legacy plain text data
          setText(messageStr);
        }
    });

    newPeer.on('close', () => {
      peersRef.current.get(remotePeerId)?.destroy();
      peersRef.current.delete(remotePeerId);
    });

    newPeer.on('error', (err: PeerError) => {
      if (err.code === 'ERR_CONNECTION_FAILURE') {
        toast({ variant: 'destructive', title: 'Connection Failed', description: 'Could not connect to a peer. Please check your network.' });
      } else if (err.message !== 'User-Initiated Abort, reason=Close called') {
         console.log(`Peer event (error) with ${remotePeerId}: ${err.message}`);
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
    const newText = e.target.value;
    setText(newText);
    broadcastRaw(JSON.stringify({ type: 'textUpdate', data: newText }));
  };
  
  const handleClearClipboard = () => {
    setText('');
    setImages([]);
    setFiles([]);
    broadcastRaw(JSON.stringify({ type: 'clear' }));
  };

  const handleCopyText = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast({ title: 'Copied text to clipboard!' });
  };
  
  const handleCopyUrl = async () => {
    if (!currentUrl) return;
    await navigator.clipboard.writeText(currentUrl);
    toast({ title: 'Room URL copied!' });
  };
  
  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData.items;
    let imageFound = false;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
            imageFound = true;
            const blob = items[i].getAsFile();
            if (!blob) continue;

            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUri = event.target?.result as string;
                if(dataUri) {
                    const newImage: ClipboardImage = { id: Math.random().toString(36).substring(2), data: dataUri };
                    setImages(current => [...current, newImage]);
                    broadcastChunked(newImage, 'image');
                }
            };
            reader.readAsDataURL(blob);
        }
    }
    if (imageFound) {
      e.preventDefault();
    }
  };

  const handleRemoveImage = (imageId: string) => {
    setImages(current => current.filter(img => img.id !== imageId));
    broadcastRaw(JSON.stringify({ type: 'imageRemove', data: imageId }));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (!selectedFiles) return;

      for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          const reader = new FileReader();
          reader.onload = (event) => {
              const dataUri = event.target?.result as string;
              if (dataUri) {
                  const newFile: ClipboardFile = {
                      id: Math.random().toString(36).substring(2),
                      name: file.name,
                      type: file.type,
                      size: file.size,
                      data: dataUri,
                  };
                  setFiles(current => [...current, newFile]);
                  broadcastChunked(newFile, 'file');
              }
          };
          reader.readAsDataURL(file);
      }
      // Reset file input
      if(fileInputRef.current) fileInputRef.current.value = '';
  }

  const handleRemoveFile = (fileId: string) => {
      setFiles(current => current.filter(f => f.id !== fileId));
      broadcastRaw(JSON.stringify({ type: 'fileRemove', data: fileId }));
  };

  const handleDownloadFile = (file: ClipboardFile) => {
      if (!file.data) return;
      const link = document.createElement('a');
      link.href = file.data;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  }

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
                       {isMounted && (
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
        {isMounted && (
            <div className="mt-4 flex items-center gap-2 rounded-md bg-muted/50 p-2 text-sm">
                <Link2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
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
            </div>
        )}
      </CardHeader>
      <CardContent onPaste={handlePaste}>
         <div className="space-y-4">
            <div>
              <Label htmlFor="clipboard-textarea">Synced Clipboard Text</Label>
              <Textarea
                  id="clipboard-textarea"
                  value={text}
                  onChange={handleTextChange}
                  placeholder={connectionStatus === 'Connecting...' ? 'Connecting to room...' : 'Type or paste content here...'}
                  rows={8}
                  disabled={connectionStatus !== 'Connected' && peerCount === 0 && text === ''}
                  className="mt-2"
              />
            </div>

            {images.length > 0 && (
              <div>
                <Label>Synced Images</Label>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-2 border rounded-md min-h-[120px] bg-muted/20">
                    {images.map(image => (
                        <div key={image.id} className="relative group aspect-square">
                            <img
                                src={image.data}
                                alt="Pasted clipboard content"
                                className="w-full h-full object-cover rounded-md"
                            />
                             <Button
                                variant="destructive"
                                size="icon"
                                className="absolute top-1 right-1 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                onClick={() => handleRemoveImage(image.id)}
                            >
                                <Trash2 className="h-4 w-4" />
                                <span className="sr-only">Remove image</span>
                            </Button>
                        </div>
                    ))}
                </div>
              </div>
            )}

            {files.length > 0 && (
              <div>
                <Label>Synced Files</Label>
                <div className="mt-2 space-y-2 p-2 border rounded-md bg-muted/20">
                    {files.map(file => (
                        <div key={file.id} className="flex items-center justify-between gap-3 p-2 rounded-md bg-background/50">
                            <div className='flex items-center gap-3 min-w-0'>
                                <FileIcon className="h-6 w-6 flex-shrink-0 text-primary"/>
                                <div className='min-w-0'>
                                    <p className="text-sm font-medium truncate">{file.name}</p>
                                    <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                                </div>
                            </div>
                            <div className='flex items-center gap-2 flex-shrink-0'>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDownloadFile(file)}>
                                    <Download className="h-4 w-4" />
                                    <span className="sr-only">Download file</span>
                                </Button>
                                <Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => handleRemoveFile(file.id)}>
                                    <Trash2 className="h-4 w-4" />
                                    <span className="sr-only">Remove file</span>
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
              </div>
            )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col sm:flex-row items-stretch gap-2 justify-start bg-muted/30 py-4 px-6">
        <Button onClick={handleCopyText} disabled={!text}>
            <Copy className="mr-2 h-4 w-4" />
            Copy Text
        </Button>
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            Upload File
        </Button>
        <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            multiple
        />
        <Button variant="outline" onClick={handleClearClipboard} disabled={!text && images.length === 0 && files.length === 0}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clear All
        </Button>
      </CardFooter>
    </Card>
  );
}
