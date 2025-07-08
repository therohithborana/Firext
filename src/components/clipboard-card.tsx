"use client";

import { useState, useEffect, useTransition } from 'react';
import { database } from '@/lib/firebase';
import { ref, onValue, set } from 'firebase/database';
import { suggestPhrases } from '@/ai/flows/suggest-phrases';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Copy, ClipboardPaste, Sparkles, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

const CLIPBOARD_PATH = 'clipboard/text';

export function ClipboardCard() {
  const [sharedText, setSharedText] = useState('');
  const [inputText, setInputText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSyncing, startSyncTransition] = useTransition();
  const [isSuggesting, startSuggestTransition] = useTransition();
  const { toast } = useToast();

  useEffect(() => {
    const clipboardRef = ref(database, CLIPBOARD_PATH);
    const unsubscribe = onValue(clipboardRef, (snapshot) => {
      const data = snapshot.val();
      const text = data ?? '';
      setSharedText(text);
      if (document.activeElement?.id !== 'input-textarea') {
        setInputText(text);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleCopy = async () => {
    if (!sharedText) return;
    try {
      await navigator.clipboard.writeText(sharedText);
      toast({
        title: 'Copied to clipboard!',
        description: 'The text has been copied successfully.',
      });
    } catch (err) {
      console.error('Failed to copy text: ', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to copy text to clipboard.',
      });
    }
  };

  const handleSync = () => {
    startSyncTransition(async () => {
      try {
        await set(ref(database, CLIPBOARD_PATH), inputText);
        toast({
          title: 'Synced!',
          description: 'Your text has been synced across devices.',
        });
      } catch (err) {
        console.error('Failed to sync text: ', err);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to sync text.',
        });
      }
    });
  };

  const handleSuggest = () => {
    if (!sharedText) {
        toast({
            variant: 'default',
            title: 'Nothing to suggest',
            description: 'The shared clipboard is empty.',
        });
        return;
    }
    startSuggestTransition(async () => {
      try {
        setSuggestions([]);
        const result = await suggestPhrases({ clipboardContent: sharedText });
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
    setSuggestions([]);
  };

  return (
    <Card className="w-full max-w-2xl shadow-2xl animate-in fade-in zoom-in-95">
      <CardHeader>
        <div className="flex items-center justify-between">
            <div className='flex items-center gap-3'>
                <div className="p-3 rounded-lg bg-primary/10">
                    <ClipboardPaste className="w-6 h-6 text-primary" />
                </div>
                <div>
                    <CardTitle className="text-2xl font-bold font-headline">Crossclip</CardTitle>
                    <CardDescription>Your real-time cross-device clipboard.</CardDescription>
                </div>
            </div>
            <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700">Live</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
            <label htmlFor="shared-textarea" className="text-sm font-medium text-muted-foreground">Shared Content</label>
            <div className="relative">
                <Textarea
                  id="shared-textarea"
                  readOnly
                  value={sharedText}
                  placeholder="Waiting for content from another device..."
                  className="pr-12 text-base bg-muted/50"
                  rows={6}
                />
                <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                    onClick={handleCopy}
                    aria-label="Copy to clipboard"
                    disabled={!sharedText}
                >
                    <Copy className="w-5 h-5" />
                </Button>
            </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <label htmlFor="input-textarea" className="text-sm font-medium text-muted-foreground">Your Input</label>
          <Textarea
            id="input-textarea"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type or paste text here to sync..."
            rows={6}
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
        <Button onClick={handleSuggest} variant="ghost" disabled={isSuggesting || isSyncing}>
          {isSuggesting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Suggest with AI
        </Button>
        <Button onClick={handleSync} disabled={isSyncing || isSuggesting}>
          {isSyncing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ClipboardPaste className="mr-2 h-4 w-4" />
          )}
          Sync to Devices
        </Button>
      </CardFooter>
    </Card>
  );
}
