import json
from typing import Any, Dict, Optional

import httpx


class OllamaClient:
    """Client for interacting with Ollama local LLM server"""

    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url
        self.model_name = "Instructify"

    async def is_available(self) -> bool:
        """Check if Ollama server is available"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.base_url}/api/tags")
                return response.status_code == 200
        except Exception:
            return False

    async def generate_text(self, prompt: str, context: str = "") -> Optional[str]:
        """Generate text using Gemma 270M model"""
        try:
            full_prompt = f"{context}\n\n{prompt}" if context else prompt

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": self.model_name,
                        "prompt": full_prompt,
                        "stream": False,
                    },
                )

                if response.status_code == 200:
                    result = response.json()
                    response_text = result.get("response", "")
                    return str(response_text).strip() if response_text else None
                else:
                    print(f"Ollama error: {response.status_code}")
                    return None

        except Exception as e:
            print(f"Ollama client error: {e}")
            return None

    async def generate_notes(self, transcription: str) -> Optional[str]:
        """Generate structured notes from class transcription"""
        prompt = """Please create structured class notes from the transcription.
        Format the response as markdown with these sections:

        ## Summary
        [Brief overview of the class]

        ## Key Topics
        [Main topics covered with bullet points]

        ## Important Definitions
        [Key terms and their definitions]

        ## Action Items
        [Any assignments or tasks mentioned]

        ## Questions for Review
        [3-5 review questions based on the content]

        Transcription:
        """

        return await self.generate_text(prompt, transcription)

    async def classify_doubt(self, message: str, context: str = "") -> Dict[str, Any]:
        """Classify if a message is a genuine doubt that should go to teacher"""
        prompt = f"""Analyze this student message and determine if it's a genuine
        academic doubt that should be forwarded to the teacher.

        Context: {context}

        Student message: "{message}"

        Respond in JSON format with:
        {{
            "is_genuine_doubt": true/false,
            "confidence": 0.0-1.0,
            "reason": "brief explanation",
            "category": "academic_question|personal_ai_query|spam|off_topic"
        }}

        Only classify as "genuine_doubt" if it's:
        - A specific academic question about the subject
        - Request for clarification on course material
        - Question about assignments or course logistics

        Do NOT classify as genuine_doubt if it's:
        - General knowledge questions
        - Personal queries to AI
        - Off-topic discussions
        - Spam or inappropriate content
        """

        try:
            response = await self.generate_text(prompt)
            if response:
                # Try to extract JSON from response
                import re

                json_match = re.search(r"\{.*\}", response, re.DOTALL)
                if json_match:
                    parsed_json = json.loads(json_match.group())
                    if isinstance(parsed_json, dict):
                        return parsed_json
                    return {}

            # Fallback response
            return {
                "is_genuine_doubt": False,
                "confidence": 0.5,
                "reason": "Could not analyze message",
                "category": "unknown",
            }

        except Exception as e:
            print(f"Error classifying doubt: {e}")
            return {
                "is_genuine_doubt": False,
                "confidence": 0.0,
                "reason": "Analysis failed",
                "category": "error",
            }

    async def answer_student_query(
        self, query: str, lecture_context: str = ""
    ) -> Optional[str]:
        """Answer student query using lecture context"""
        prompt = f"""You are an AI teaching assistant. Answer the student's
        question based on the lecture context provided.

        Lecture Context:
        {lecture_context}

        Student Question: {query}

        Provide a helpful, educational response. If the question is outside
        the lecture scope, provide general guidance and suggest asking the
        teacher for more specific help.
        """

        return await self.generate_text(prompt)
