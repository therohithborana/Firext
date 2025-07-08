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
  
  // Connection Flow State
  const [connectionStep, setConnectionStep] = useState<'initial' | 'creating' | 'joining'>('initial');
  // 'creating' state variables
  const [shareableLink, setShareableLink] = useState('');
  const [pastedAnswer, setPastedAnswer] = useState('');
  // 'joining' state variables
  const [pastedOffer, setPastedOffer] = useState('');
  const [generatedAnswer, setGeneratedAnswer] = useState('');


  useEffect(() => {
    // This effect runs when the component mounts to check for an offer in the URL
    const searchParams = new URLSearchParams(window.location.search);
    const offerParam = searchParams.get('offer');

    if (offerParam && !peerRef.current?.connected) {
      try {
        const decodedOffer = atob(offerParam);
        
        // Set up the sheet for joining
        setConnectionStep('joining');
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
        const url = new URL(window.location.origin);
        url.searchParams.set('offer', encodedOffer); // Use origin to keep it clean
        setShareableLink(url.toString());
      } else {
        setGeneratedAnswer(signalString);
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

  const resetConnectionState = (keepSheetOpen = false) => {
    peerRef.current = null;
    setShareableLink('');
    setPastedOffer('');
    setPastedAnswer('');
    setGeneratedAnswer('');
    setConnectionStep('initial');
    if (!keepSheetOpen) {
      setIsSheetOpen(false);
    }
  }

  const handleStartCreating = () => {
    setConnectionStep('creating');
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
  
  const handleSignalWithAnswer = () => {
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
    // The 'close' event on the peer will handle resetting state and showing the toast.
    setConnectionStatus('Disconnected');
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

  // Reset connection flow when sheet is closed manually
  useEffect(() => {
    if (!isSheetOpen) {
      resetConnectionState();
    }
  }, [isSheetOpen]);

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
              <Button onClick={handleDisconnect} variant="destructive" className="gap-2">
                <WifiOff />
                Disconnect
              </Button>
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
                    {connectionStep === 'initial' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                          <Button variant="outline" onClick={() => setConnectionStep('joining')}>Join Connection</Button>
                          <Button onClick={handleStartCreating}>Start a New Connection</Button>
                      </div>
                    )}

                    {connectionStep === 'creating' && (
                       <div className='space-y-6 pt-4'>
                          <div className="space-y-3">
                            <Label className='font-bold text-base'>Step 1: Share Link</Label>
                            <p className="text-sm text-muted-foreground">Copy this link and open it on your other device. It contains the connection offer.</p>
                            <div className="flex gap-2">
                              <Input id="share-link" readOnly value={shareableLink} className="text-xs" onFocus={(e) => e.target.select()}/>
                              <Button variant="outline" size="icon" onClick={() => handleCopyToClipboard(shareableLink, 'Link')}><Copy className="w-4 h-4"/></Button>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <Label className='font-bold text-base'>Step 2: Paste Answer</Label>
                            <p className="text-sm text-muted-foreground">Once the other device generates an answer, paste it here to complete the connection.</p>
                            <Textarea id="answer-input" value={pastedAnswer} onChange={(e) => setPastedAnswer(e.target.value)} placeholder="Paste answer data here..." rows={4} className="text-xs"/>
                            <Button onClick={handleSignalWithAnswer} disabled={!pastedAnswer}>Complete Connection</Button>
                          </div>
                        </div>
                    )}
                    
                    {connectionStep === 'joining' && (
                        <div className='space-y-6 pt-4'>
                           <div className="space-y-3">
                            <Label className='font-bold text-base'>Step 1: Provide Offer</Label>
                            <p className="text-sm text-muted-foreground">Paste the offer from the first device. If you opened a link, this should be pre-filled.</p>
                            <Textarea id="paste-offer-input" value={pastedOffer} onChange={(e) => setPastedOffer(e.target.value)} placeholder="Offer data from first device..." rows={4} className="text-xs"/>
                            <Button onClick={handleAcceptOffer} disabled={!pastedOffer || !!generatedAnswer}>Generate Answer</Button>
                          </div>

                          {generatedAnswer && (
                            <div className="space-y-3 animate-in fade-in">
                                <Label className='font-bold text-base'>Step 2: Copy Answer</Label>
                                <p className="text-sm text-muted-foreground">Copy this generated answer and paste it back into the first device.</p>
                               <div className="flex gap-2">
                                  <Textarea id="answer-string" readOnly value={generatedAnswer} rows={4} className="text-xs" onFocus={(e) => e.target.select()}/>
                                  <Button variant="outline" size="icon" onClick={() => handleCopyToClipboard(generatedAnswer, 'Answer')}><Copy className="w-4 h-4"/></Button>
                               </div>
                             </div>
                           )}
                        </div>
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
