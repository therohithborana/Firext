"use client";

import { useState, useTransition, useRef, useEffect } from 'react';
import Peer from 'simple-peer';
import type { Instance as PeerInstance } from 'simple-peer';
import { suggestPhrases } from '@/ai/flows/suggest-phrases';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Copy, ClipboardPaste, Sparkles, Loader2, Wifi, WifiOff } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';
import { Label } from './ui/label';
import { Input } from './ui/input';

type ConnectionStatus = 'Disconnected' | 'Connecting...' | 'Connected' | 'Error';

export function ClipboardCard() {
  const [inputText, setInputText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSuggesting, startSuggestTransition] = useTransition();
  const { toast } = useToast();

  const peerRef = useRef<PeerInstance | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Disconnected');
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('create');

  // Connection data states
  const [shareableLink, setShareableLink] = useState('');
  const [answer, setAnswer] = useState('');
  const [pastedOffer, setPastedOffer] = useState('');
  const [pastedAnswer, setPastedAnswer] = useState('');

  useEffect(() => {
    // This effect runs when the component mounts to check for an offer in the URL
    const searchParams = new URLSearchParams(window.location.search);
    const offerParam = searchParams.get('offer');

    if (offerParam && !peerRef.current?.connected) {
      try {
        const decodedOffer = atob(offerParam);
        
        // Pre-fill the join connection form
        setActiveTab('join');
        setPastedOffer(decodedOffer);
        setIsSheetOpen(true); // Open the connection panel

        // Clean URL to prevent re-triggering on refresh
        const url = new URL(window.location.href);
        url.searchParams.delete('offer');
        window.history.replaceState({}, '', url.toString());

        toast({ title: "Offer link detected!", description: "The connection offer has been pasted for you. Please review and generate an answer." });
      } catch(e) {
        console.error("Failed to process offer from URL", e);
        toast({ variant: 'destructive', title: 'Invalid Offer Link', description: 'The link seems to be malformed.' });
      }
    }
  }, []); // Run only once on mount.

  useEffect(() => {
    // Cleanup peer connection on component unmount
    return () => {
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

  const setupPeer = (initiator: boolean) => {
    if (peerRef.current) {
      peerRef.current.destroy();
    }
    
    // Using trickle: false simplifies signaling by creating a single large data chunk.
    const newPeer = new Peer({ initiator, trickle: false });
    peerRef.current = newPeer;
    setConnectionStatus('Connecting...');

    newPeer.on('signal', (data) => {
      const signalString = JSON.stringify(data);
      if (initiator) {
        const encodedOffer = btoa(signalString);
        const url = new URL(window.location.href);
        url.searchParams.set('offer', encodedOffer);
        setShareableLink(url.toString());
      } else {
        setAnswer(signalString);
      }
    });

    newPeer.on('connect', () => {
      setConnectionStatus('Connected');
      toast({ title: 'Connection established!', description: 'Clipboard is now synced.' });
      setIsSheetOpen(false);
    });

    newPeer.on('data', (data) => {
      const receivedText = data.toString();
      setInputText(receivedText);
    });

    newPeer.on('close', () => {
      setConnectionStatus('Disconnected');
      resetConnectionState();
      toast({ variant: 'destructive', title: 'Connection closed.' });
    });

    newPeer.on('error', (err) => {
      console.error('WebRTC Peer Error:', err);
      setConnectionStatus('Error');
      resetConnectionState();
      toast({ variant: 'destructive', title: 'Connection Error', description: 'Something went wrong.' });
    });
  };

  const resetConnectionState = () => {
    peerRef.current = null;
    setShareableLink('');
    setAnswer('');
    setPastedOffer('');
    setPastedAnswer('');
    setActiveTab('create');
  }

  const handleCreateConnectionLink = () => {
    setupPeer(true);
  };

  const handleAcceptOffer = () => {
    if (!pastedOffer) {
      toast({ variant: 'destructive', title: 'Invalid Offer', description: 'Please paste the offer data from the other device.' });
      return;
    }
    setupPeer(false);
    try {
      peerRef.current?.signal(JSON.parse(pastedOffer));
    } catch(e) {
       toast({ variant: 'destructive', title: 'Invalid Offer', description: 'The pasted offer data is malformed.' });
    }
  };
  
  const handleCompleteConnection = () => {
     if (!pastedAnswer) {
      toast({ variant: 'destructive', title: 'Invalid Answer', description: 'Please paste the answer data from the other device.' });
      return;
    }
    try {
      peerRef.current?.signal(JSON.parse(pastedAnswer));
    } catch(e) {
      toast({ variant: 'destructive', title: 'Invalid Answer', description: 'The pasted answer data is malformed.' });
    }
  };

  const handleDisconnect = () => {
    peerRef.current?.destroy();
  };

  const handleCopyToClipboard = async (text: string, type: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast({ title: `Copied ${type} to clipboard!` });
  };

  const handleSuggest = () => {
    if (!inputText) {
        toast({
            variant: 'default',
            title: 'Nothing to suggest',
            description: 'The clipboard is empty.',
        });
        return;
    }
    startSuggestTransition(async () => {
      try {
        setSuggestions([]);
        const result = await suggestPhrases({ clipboardContent: inputText });
        setSuggestions(result.suggestions);
      } catch (err) {
        console.error('Failed to get suggestions: ', err);
        toast({
          variant: 'destructive',
          title: 'AI Error',
          description: 'Could not fetch suggestions.',
        });
      }
    });
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputText(suggestion);
    if (peerRef.current?.connected) {
      peerRef.current.send(suggestion);
    }
    setSuggestions([]);
  };
  
  const getStatusBadgeVariant = () => {
    switch(connectionStatus) {
      case 'Connected': return 'default';
      case 'Connecting...': return 'secondary';
      case 'Disconnected': return 'outline';
      case 'Error': return 'destructive';
      default: return 'outline';
    }
  }

  return (
    <>
      <Card className="w-full max-w-2xl shadow-2xl animate-in fade-in zoom-in-95">
        <CardHeader>
          <div className="flex items-center justify-between">
              <div className='flex items-center gap-3'>
                  <div className="p-3 rounded-lg bg-primary/10">
                      <ClipboardPaste className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                      <CardTitle className="text-2xl font-bold font-headline flex items-center gap-2">
                        Smart Clipboard
                        <Badge variant={getStatusBadgeVariant()} className="text-xs">{connectionStatus}</Badge>
                      </CardTitle>
                      <CardDescription>An intelligent, peer-to-peer clipboard with AI suggestions.</CardDescription>
                  </div>
              </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="clipboard-textarea">Your Clipboard</Label>
            <Textarea
              id="clipboard-textarea"
              value={inputText}
              onChange={handleTextChange}
              placeholder="Type or paste text here to get AI suggestions..."
              rows={8}
            />
          </div>

          {isSuggesting && (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="ml-2 text-muted-foreground">Getting suggestions...</p>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="space-y-2 animate-in fade-in">
              <h4 className="text-sm font-medium text-muted-foreground">AI Suggestions</h4>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s, i) => (
                  <Button key={i} variant="outline" size="sm" onClick={() => handleSuggestionClick(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row gap-2 justify-between bg-muted/30 py-4 px-6">
          <div className="flex gap-2">
             <Button onClick={handleSuggest} variant="ghost" disabled={isSuggesting || !inputText}>
              {isSuggesting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Suggest with AI
            </Button>
            <Button onClick={() => handleCopyToClipboard(inputText, 'Text')} disabled={!inputText || isSuggesting}>
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
          </div>
          
           {peerRef.current?.connected ? (
              <Button onClick={handleDisconnect} variant="destructive">
                <WifiOff />
                Disconnect
              </Button>
            ) : (
              <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetTrigger asChild>
                  <Button>
                    <Wifi />
                    Connect to Peer
                  </Button>
                </SheetTrigger>
                <SheetContent className="w-full sm:max-w-lg">
                  <SheetHeader>
                    <SheetTitle>Peer-to-Peer Connection</SheetTitle>
                    <SheetDescription>
                      Connect to another device directly without a server. This requires sharing a link and a code between devices once.
                      <br/>
                      <span className={cn('font-semibold', {
                          'text-green-500': connectionStatus === 'Connected',
                          'text-red-500': connectionStatus === 'Error' || connectionStatus === 'Disconnected',
                          'text-yellow-500': connectionStatus === 'Connecting...'
                      })}>Status: {connectionStatus}</span>
                    </SheetDescription>
                  </SheetHeader>
                  <div className="py-4">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="create">Create Connection</TabsTrigger>
                        <TabsTrigger value="join">Join Connection</TabsTrigger>
                      </TabsList>
                      <TabsContent value="create" className="space-y-4 pt-4">
                          {!shareableLink ? (
                            <>
                              <p className="text-sm text-muted-foreground">1. Click the button to generate a shareable connection link.</p>
                              <Button onClick={handleCreateConnectionLink} disabled={!!shareableLink}>Create Connection Link</Button>
                            </>
                          ) : (
                            <div className='space-y-4'>
                              <div className="space-y-2">
                                <Label htmlFor="share-link">2. Copy this link and open it on the other device.</Label>
                                <div className="flex gap-2">
                                  <Input id="share-link" readOnly value={shareableLink} className="text-xs"/>
                                  <Button variant="outline" size="icon" onClick={() => handleCopyToClipboard(shareableLink, 'Link')}><Copy className="w-4 h-4"/></Button>
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="answer-input">3. Paste the answer from the other device below.</Label>
                                <Textarea id="answer-input" value={pastedAnswer} onChange={(e) => setPastedAnswer(e.target.value)} placeholder="Paste answer data here..." rows={4} className="text-xs"/>
                                <Button onClick={handleCompleteConnection} disabled={!pastedAnswer}>Complete Connection</Button>
                              </div>
                            </div>
                          )}
                      </TabsContent>
                      <TabsContent value="join" className="space-y-4 pt-4">
                          <Label htmlFor="paste-offer-input">1. Paste the offer from the first device (or open its link).</Label>
                          <Textarea id="paste-offer-input" value={pastedOffer} onChange={(e) => setPastedOffer(e.target.value)} placeholder="Offer data will appear here if you use a link..." rows={4} className="text-xs"/>
                          <Button onClick={handleAcceptOffer} disabled={!pastedOffer || !!answer}>Generate Answer</Button>
                          {answer && (
                            <div className="space-y-2">
                                <Label htmlFor="answer-string">2. Copy this answer and paste it on the first device.</Label>
                              <div className="flex gap-2">
                                  <Textarea id="answer-string" readOnly value={answer} rows={4} className="text-xs"/>
                                  <Button variant="outline" size="icon" onClick={() => handleCopyToClipboard(answer, 'Answer')}><Copy className="w-4 h-4"/></Button>
                              </div>
                            </div>
                          )}
                      </TabsContent>
                    </Tabs>
                  </div>
                </SheetContent>
              </Sheet>
            )}
        </CardFooter>
      </Card>
    </>
  );
}
