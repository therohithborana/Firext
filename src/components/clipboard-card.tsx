"use client";

import { useState, useTransition } from 'react';
import { suggestPhrases } from '@/ai/flows/suggest-phrases';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Copy, ClipboardPaste, Sparkles, Loader2 } from 'lucide-react';

export function ClipboardCard() {
  const [inputText, setInputText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSuggesting, startSuggestTransition] = useTransition();
  const { toast } = useToast();

  const handleCopy = async () => {
    if (!inputText) return;
    try {
      await navigator.clipboard.writeText(inputText);
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
                    <CardTitle className="text-2xl font-bold font-headline">Smart Clipboard</CardTitle>
                    <CardDescription>An intelligent clipboard with AI-powered suggestions.</CardDescription>
                </div>
            </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="clipboard-textarea" className="text-sm font-medium text-muted-foreground">Your Clipboard</label>
          <Textarea
            id="clipboard-textarea"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
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
        <Button onClick={handleSuggest} variant="ghost" disabled={isSuggesting || !inputText}>
          {isSuggesting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Suggest with AI
        </Button>
        <Button onClick={handleCopy} disabled={!inputText || isSuggesting}>
          <Copy className="mr-2 h-4 w-4" />
          Copy to Clipboard
        </Button>
      </CardFooter>
    </Card>
  );
}
