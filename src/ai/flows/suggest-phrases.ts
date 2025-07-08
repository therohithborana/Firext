// src/ai/flows/suggest-phrases.ts
'use server';

/**
 * @fileOverview A flow for suggesting phrases based on the clipboard content.
 *
 * - suggestPhrases - A function that suggests phrases based on the clipboard content.
 * - SuggestPhrasesInput - The input type for the suggestPhrases function.
 * - SuggestPhrasesOutput - The return type for the suggestPhrases function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SuggestPhrasesInputSchema = z.object({
  clipboardContent: z
    .string()
    .describe('The current content of the clipboard.'),
});
export type SuggestPhrasesInput = z.infer<typeof SuggestPhrasesInputSchema>;

const SuggestPhrasesOutputSchema = z.object({
  suggestions: z.array(z.string()).describe('An array of suggested phrases.'),
});
export type SuggestPhrasesOutput = z.infer<typeof SuggestPhrasesOutputSchema>;

export async function suggestPhrases(input: SuggestPhrasesInput): Promise<SuggestPhrasesOutput> {
  return suggestPhrasesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'suggestPhrasesPrompt',
  input: {schema: SuggestPhrasesInputSchema},
  output: {schema: SuggestPhrasesOutputSchema},
  prompt: `You are an AI assistant that suggests phrases based on the current clipboard content.

  Suggest three phrases that could complete or correct the following text:

  {{clipboardContent}}

  Return the suggestions as a JSON array of strings.
  `,
});

const suggestPhrasesFlow = ai.defineFlow(
  {
    name: 'suggestPhrasesFlow',
    inputSchema: SuggestPhrasesInputSchema,
    outputSchema: SuggestPhrasesOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
