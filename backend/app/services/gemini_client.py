import json
import os
import re
from typing import Any, Dict, Optional

import google.generativeai as genai


class GeminiClient:
    """Client for interacting with Google Gemini 2.5 Flash Lite for AI chat and content filtering"""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("GOOGLE_API_KEY")
        if not self.api_key:
            raise ValueError("GOOGLE_API_KEY environment variable is required")
        
        genai.configure(api_key=self.api_key)
        self.model = genai.GenerativeModel("gemini-2.0-flash-exp")
        
        # Harmful keywords for first-layer filtering
        self.harmful_keywords = {
            'violence': ['bomb', 'kill', 'murder', 'shoot', 'attack', 'destroy', 'harm', 'hurt', 'violence', 'weapon', 'gun', 'knife', 'explosive'],
            'threats': ['threat', 'threaten', 'intimidate', 'scare', 'terrorize', 'menace'],
            'inappropriate': ['hate', 'racism', 'sexism', 'harassment', 'bully', 'abuse'],
            'illegal': ['drugs', 'steal', 'robbery', 'crime', 'illegal', 'cheat'],
            'sexual': ['sex', 'sexual', 'nude', 'porn', 'inappropriate touching']
        }

    async def _keyword_filter(self, content: str) -> Dict[str, Any]:
        """First layer: Quick keyword-based filtering"""
        content_lower = content.lower()
        
        for category, keywords in self.harmful_keywords.items():
            for keyword in keywords:
                if keyword in content_lower:
                    return {
                        "is_safe": False,
                        "confidence": 0.9,
                        "reason": f"Contains harmful keyword: '{keyword}' (category: {category})",
                        "category": category,
                        "filter_type": "keyword"
                    }
        
        return {
            "is_safe": True,
            "confidence": 0.8,
            "reason": "No harmful keywords detected",
            "category": "safe",
            "filter_type": "keyword"
        }

    async def filter_content(self, content: str) -> Dict[str, Any]:
        """Dual-layer content filtering: keywords + AI analysis"""
        
        # Layer 1: Quick keyword filtering
        keyword_result = await self._keyword_filter(content)
        if not keyword_result["is_safe"]:
            print(f"🚫 BLOCKED by keyword filter: {content}")
            return keyword_result

        # Layer 2: AI-powered content analysis
        try:
            prompt = f"""Analyze this message for harmful, inappropriate, unsafe, or educational inappropriateness.

Message: "{content}"

You are a content filter for an educational platform. Be VERY STRICT about safety.

Mark as UNSAFE if the message contains:
- ANY violence, threats, or harmful intentions (even subtle ones)
- Weapons, bombs, explosives, or violence references
- Inappropriate sexual content or references
- Hate speech, harassment, or bullying
- Illegal activities or instructions
- Personal attacks or mean behavior
- Spam, nonsense, or disruptive content
- Off-topic non-educational content in a classroom setting

Mark as SAFE ONLY if it's:
- Legitimate educational questions or discussions
- Appropriate classroom communication
- Polite requests or conversations
- Academic content related queries

Respond in JSON format:
{{
    "is_safe": true/false,
    "confidence": 0.0-1.0,
    "reason": "brief explanation",
    "category": "safe|violence|threats|inappropriate|sexual|hate_speech|illegal|spam|off_topic"
}}

Be extra cautious - err on the side of blocking questionable content."""

            response = self.model.generate_content(prompt)
            response_text = response.text.strip()
            
            # Extract JSON from response
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                try:
                    result = json.loads(json_match.group())
                    result["filter_type"] = "ai"
                    
                    if not result.get("is_safe", False):
                        print(f"🚫 BLOCKED by AI filter: {content} - {result.get('reason')}")
                    
                    return result
                except json.JSONDecodeError:
                    pass
            
            # Fallback - assume unsafe if can't parse
            return {
                "is_safe": False,
                "confidence": 0.5,
                "reason": "AI analysis failed - blocked for safety",
                "category": "unknown",
                "filter_type": "ai_error"
            }
            
        except Exception as e:
            print(f"Error in AI content filtering: {e}")
            # Fail closed - block content if AI analysis fails
            return {
                "is_safe": False,
                "confidence": 0.0,
                "reason": "Content filtering failed - blocked for safety",
                "category": "error",
                "filter_type": "ai_error"
            }

    async def classify_doubt(self, message: str, context: str = "") -> Dict[str, Any]:
        """Classify if a message is a genuine academic doubt for the teacher"""
        try:
            prompt = f"""Analyze this student message to determine if it's a genuine academic doubt that should be forwarded to the teacher.

Context from recent class discussion:
{context if context else "No recent context available"}

Student message: "{message}"

A message should be classified as a GENUINE DOUBT if it's:
- A specific academic question about the current subject/lesson
- Request for clarification on course material being taught
- Question about assignments, homework, or course logistics
- Confusion about concepts being discussed in class

Do NOT classify as genuine doubt if it's:
- General knowledge questions unrelated to current lesson
- Personal queries meant for the AI assistant
- Off-topic discussions or casual conversation
- Spam, inappropriate, or disruptive content
- Questions already answered in the current context

Respond in JSON format:
{{
    "is_genuine_doubt": true/false,
    "confidence": 0.0-1.0,
    "reason": "brief explanation",
    "category": "academic_question|personal_ai_query|off_topic|spam|inappropriate"
}}"""

            response = self.model.generate_content(prompt)
            response_text = response.text.strip()
            
            # Extract JSON from response
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                try:
                    return json.loads(json_match.group())
                except json.JSONDecodeError:
                    pass
            
            # Fallback
            return {
                "is_genuine_doubt": False,
                "confidence": 0.5,
                "reason": "Could not analyze message",
                "category": "unknown"
            }
            
        except Exception as e:
            print(f"Error classifying doubt: {e}")
            return {
                "is_genuine_doubt": False,
                "confidence": 0.0,
                "reason": "Classification failed",
                "category": "error"
            }

    async def answer_student_query(self, query: str, lecture_context: str = "") -> Optional[str]:
        """Answer student query with safety filtering and educational focus"""
        
        # First, filter the query for harmful content
        filter_result = await self.filter_content(query)
        
        if not filter_result.get("is_safe", False):
            print(f"🚫 Blocked harmful AI query: {query} - {filter_result.get('reason')}")
            return "I cannot respond to that message. Please keep our conversation educational and appropriate. If you have academic questions, I'm here to help with those."
        
        try:
            # Content is safe, proceed with educational response
            prompt = f"""You are an AI teaching assistant for an educational platform. Answer the student's question helpfully and educationally.

Current class context:
{lecture_context if lecture_context else "No specific lecture context available"}

Student question: {query}

Guidelines:
- Provide clear, educational responses appropriate for a classroom setting
- If the question relates to the lecture context, reference it in your answer
- If the question is outside the current lesson scope, provide general educational guidance and suggest asking the teacher for more specific help
- Keep responses concise but informative (2-4 sentences)
- Maintain an encouraging, supportive tone
- If you cannot answer the question appropriately, redirect to the teacher

IMPORTANT: Only provide educational responses. Do not engage with inappropriate requests."""

            response = self.model.generate_content(prompt)
            response_text = response.text.strip()
            
            # Filter the AI's response as well
            response_filter = await self.filter_content(response_text)
            if not response_filter.get("is_safe", False):
                print(f"🚫 Blocked AI response: {response_text} - {response_filter.get('reason')}")
                return "I cannot provide that information. Please ask an educational question and I'll be happy to help."
            
            return response_text
            
        except Exception as e:
            print(f"Error generating AI response: {e}")
            return "I'm experiencing technical difficulties. Please try asking your question again or reach out to your teacher directly."

    async def is_available(self) -> bool:
        """Check if Gemini API is available"""
        try:
            # Simple test to verify API connectivity
            test_response = self.model.generate_content("Test connectivity. Respond with 'OK'.")
            return "OK" in test_response.text.upper()
        except Exception:
            return False