import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from './promptTemplates';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

async function analyzeWithClaude(contextPrompt) {
  try {
    console.log('Sending to Claude for analysis...');
    
    const userPrompt = USER_PROMPT_TEMPLATE.replace('{context}', contextPrompt);
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: userPrompt
      }]
    });
    
    console.log('✅ Received response from Claude');
    
    // Extract JSON from response
    const responseText = response.content[0].text;
    
    // Try to parse directly first
    try {
      const parsed = JSON.parse(responseText);
      return parsed;
    } catch (e) {
      // If direct parse fails, try to extract from markdown code blocks
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                        responseText.match(/```\n([\s\S]*?)\n```/) ||
                        responseText.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const jsonString = jsonMatch[1] || jsonMatch[0];
        return JSON.parse(jsonString);
      }
      
      throw new Error('Could not parse JSON from Claude response');
    }
  } catch (error) {
    console.error('Error analyzing with Claude:', error.message);
    throw error;
  }
}

export { analyzeWithClaude };