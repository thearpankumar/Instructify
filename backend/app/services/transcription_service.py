import json
import os
from datetime import datetime
from typing import Dict, List, Optional

from .gemini_client import GeminiClient


class TranscriptionService:
    """Service for handling voice transcription and note generation"""
    
    def __init__(self):
        self.gemini_client = GeminiClient()
        self.transcripts = {}  # Store transcripts by class_id
        self.MAX_TOKENS = 2000  # Conservative limit for free tier
        
    def add_transcript_chunk(self, class_id: str, text: str, timestamp: str = None) -> None:
        """Add a chunk of transcribed text to the class transcript"""
        if not timestamp:
            timestamp = datetime.now().isoformat()
            
        if class_id not in self.transcripts:
            self.transcripts[class_id] = []
            
        self.transcripts[class_id].append({
            "text": text,
            "timestamp": timestamp
        })
    
    def get_transcript(self, class_id: str) -> List[Dict]:
        """Get the full transcript for a class"""
        return self.transcripts.get(class_id, [])
    
    def _optimize_transcript_for_tokens(self, full_text: str) -> str:
        """Optimize transcript text to fit within token limits"""
        # Rough estimation: 1 token ≈ 4 characters
        max_chars = self.MAX_TOKENS * 3  # Conservative estimate
        
        if len(full_text) <= max_chars:
            return full_text
        
        # Take the most recent content (end of lecture is often summary)
        # and some from the beginning (introduction/key topics)
        beginning_chars = max_chars // 3
        ending_chars = max_chars - beginning_chars
        
        beginning = full_text[:beginning_chars]
        ending = full_text[-ending_chars:]
        
        return f"{beginning}...[CONTENT TRUNCATED FOR EFFICIENCY]...{ending}"
    
    async def generate_notes(self, class_id: str) -> Optional[str]:
        """Generate smart notes from the class transcript using AI"""
        transcript_chunks = self.get_transcript(class_id)
        
        if not transcript_chunks:
            return None
            
        # Combine all transcript text
        full_text = " ".join([chunk["text"] for chunk in transcript_chunks])
        
        # Optimize for token efficiency
        optimized_text = self._optimize_transcript_for_tokens(full_text)
        
        # Ultra-efficient prompt for note generation
        prompt = f"""Create study notes from this lecture:

{optimized_text}

Format:
• Main Topics: [key subjects covered]
• Key Points: [important concepts with brief explanations]  
• Summary: [2-3 sentence overview]

Keep under 300 words, focus on exam-relevant content."""

        try:
            response = self.gemini_client.model.generate_content(prompt)
            return response.text.strip()
        except Exception as e:
            print(f"Error generating notes: {e}")
            # Fallback: Create basic notes from transcript structure
            return self._create_fallback_notes(transcript_chunks)
    
    def _create_fallback_notes(self, transcript_chunks: List[Dict]) -> str:
        """Create basic notes when AI fails (no API calls)"""
        if not transcript_chunks:
            return "No content available for notes."
        
        # Extract key sentences (simple heuristic)
        all_text = " ".join([chunk["text"] for chunk in transcript_chunks])
        sentences = [s.strip() for s in all_text.split('.') if len(s.strip()) > 20]
        
        # Take first few and last few sentences as key points
        key_sentences = sentences[:3] + sentences[-2:] if len(sentences) > 5 else sentences
        
        notes = f"""LECTURE NOTES
Generated: {datetime.now().strftime("%Y-%m-%d %H:%M")}

KEY POINTS:
"""
        for i, sentence in enumerate(key_sentences, 1):
            notes += f"• {sentence.strip()}.\n"
        
        notes += f"\nTotal Duration: {len(transcript_chunks)} segments recorded"
        
        return notes
    
    def clear_transcript(self, class_id: str) -> None:
        """Clear transcript for a class"""
        if class_id in self.transcripts:
            del self.transcripts[class_id]
    
    def export_notes(self, class_id: str, notes: str) -> str:
        """Export notes as downloadable content"""
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        
        header = f"""INSTRUCTIFY CLASS NOTES
======================
Class ID: {class_id}
Generated: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
======================

"""
        
        return header + notes
