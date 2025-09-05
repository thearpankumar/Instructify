import json
import uuid
from datetime import datetime
from typing import Dict, List

from fastapi import WebSocket

from ..models.chat import ChatMessage
from ..services.gemini_client import GeminiClient


class ChatHandler:
    def __init__(self, room_manager=None):
        self.messages: Dict[str, List[ChatMessage]] = {}  # class_id -> messages
        self.room_manager = room_manager
        
        # GeminiClient for AI chat responses and content filtering
        try:
            self.gemini_client = GeminiClient()
        except ValueError as e:
            print(f"Warning: GeminiClient initialization failed: {e}")
            print("Content filtering and AI responses will be disabled.")
            self.gemini_client = None

    async def handle_message(
        self, class_id: str, websocket: WebSocket, message_data: dict
    ):
        """Handle incoming chat messages"""
        message_type = message_data.get("type")

        if message_type == "chat_message":
            await self.handle_chat_message(class_id, websocket, message_data)
        elif message_type == "ai_query":
            await self.handle_ai_query(class_id, websocket, message_data)
        elif message_type == "webrtc_signal":
            await self.handle_webrtc_signal(class_id, websocket, message_data)

    async def handle_chat_message(
        self, class_id: str, websocket: WebSocket, message_data: dict
    ):
        """Handle regular chat messages with AI doubt classification"""
        if not self.room_manager:
            return

        sender_info = self.room_manager.user_connections.get(websocket, {})
        sender_name = sender_info.get("user_name", "Anonymous")
        sender_type = sender_info.get("user_type", "student")
        message_text = message_data.get("message", "")

        # First, filter all messages for harmful content
        if self.gemini_client:
            try:
                content_filter = await self.gemini_client.filter_content(message_text)
                if not content_filter.get("is_safe", False):
                    # Block harmful message - don't broadcast it
                    print(f"🚫 Blocked harmful chat message from {sender_name}: {message_text}")
                    print(f"Filter reason: {content_filter.get('reason')} (Filter type: {content_filter.get('filter_type')})")
                    
                    # Send warning to sender only
                    await websocket.send_text(json.dumps({
                        "type": "message_blocked",
                        "reason": "Your message was blocked for inappropriate content. Please keep our classroom discussions educational and respectful.",
                        "timestamp": datetime.now().isoformat(),
                    }))
                    return  # Don't process or broadcast the message
            except Exception as e:
                print(f"Content filtering error: {e}")
                # On error, allow message but log the issue
        else:
            print("Warning: No content filtering available - GeminiClient not initialized")
        
        # For students, check if this is a genuine doubt for the teacher
        is_doubt = False
        if sender_type == "student":
            try:
                # Get context and classify the message
                context = self._get_recent_context(class_id)
                if self.gemini_client:
                    classification = await self.gemini_client.classify_doubt(
                        message_text, context
                    )
                else:
                    # Fallback - no classification available
                    classification = {
                        "is_genuine_doubt": False,
                        "confidence": 0.0,
                        "reason": "Classification unavailable",
                        "category": "unknown"
                    }
                is_doubt = classification.get("is_genuine_doubt", False)

                # If it's a genuine doubt, flag it for teacher attention
                if is_doubt:
                    # Send special notification to teachers
                    await self.room_manager.send_to_teachers(
                        class_id,
                        {
                            "type": "doubt_notification",
                            "student_name": sender_name,
                            "message": message_text,
                            "confidence": classification.get("confidence", 0.5),
                            "reason": classification.get(
                                "reason", "Classified as academic question"
                            ),
                            "timestamp": datetime.now().isoformat(),
                        },
                    )

            except Exception as e:
                print(f"Doubt classification error: {e}")
                # If classification fails, treat as regular message

        # Create chat message
        chat_message = ChatMessage(
            id=str(uuid.uuid4()),
            class_id=class_id,
            sender_name=sender_name,
            sender_type=sender_type,
            message=message_text,
            timestamp=datetime.now(),
            is_doubt=is_doubt,
        )

        # Store message
        if class_id not in self.messages:
            self.messages[class_id] = []
        self.messages[class_id].append(chat_message)

        # Broadcast to all users in room
        await self.room_manager.broadcast_to_room(
            class_id,
            {
                "type": "chat_message",
                "id": chat_message.id,
                "sender_name": chat_message.sender_name,
                "sender_type": chat_message.sender_type,
                "message": chat_message.message,
                "timestamp": chat_message.timestamp.isoformat(),
                "is_doubt": is_doubt,
            },
        )

    async def handle_ai_query(
        self, class_id: str, websocket: WebSocket, message_data: dict
    ):
        """Handle AI assistant queries"""
        query = message_data.get("query", "")

        if not query:
            return

        try:
            # Get lecture context from recent messages
            lecture_context = self._get_recent_context(class_id)

            # Generate AI response using Gemini
            if self.gemini_client:
                ai_response = await self.gemini_client.answer_student_query(
                    query, lecture_context
                )
            else:
                ai_response = "I'm currently unavailable. Please try again later or ask your teacher directly."

            if ai_response:
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "ai_response",
                            "query": query,
                            "response": ai_response,
                            "timestamp": datetime.now().isoformat(),
                        }
                    )
                )
            else:
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "ai_response",
                            "query": query,
                            "response": (
                                "Sorry, I'm having trouble processing your "
                                "question right now. Please try again or "
                                "ask your teacher directly."
                            ),
                            "timestamp": datetime.now().isoformat(),
                        }
                    )
                )
        except Exception as e:
            print(f"AI query error: {e}")
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "ai_response",
                        "query": query,
                        "response": (
                            "I'm experiencing technical difficulties. "
                            "Please try again later."
                        ),
                        "timestamp": datetime.now().isoformat(),
                    }
                )
            )

    def _get_recent_context(self, class_id: str, limit: int = 10) -> str:
        """Get recent chat messages as context for AI"""
        if class_id not in self.messages:
            return ""

        recent_messages = self.messages[class_id][-limit:]
        context_parts = []

        for msg in recent_messages:
            if msg.sender_type == "teacher":
                context_parts.append(f"Teacher ({msg.sender_name}): {msg.message}")

        return "\n".join(context_parts)

    async def handle_webrtc_signal(
        self, class_id: str, websocket: WebSocket, message_data: dict
    ):
        """Handle WebRTC signaling messages"""
        if not self.room_manager:
            return

        print(f"🔧 Backend handling WebRTC signal: {message_data.get('signal_type')}")
        print(f"📋 Full message data: {message_data}")
        
        # Use the new WebRTC signaling handler
        await self.room_manager.handle_webrtc_signaling(class_id, websocket, message_data)

    def get_chat_history(self, class_id: str) -> List[dict]:
        """Get chat history for a classroom"""
        if class_id not in self.messages:
            return []

        return [
            {
                "id": msg.id,
                "sender_name": msg.sender_name,
                "sender_type": msg.sender_type,
                "message": msg.message,
                "timestamp": msg.timestamp.isoformat(),
            }
            for msg in self.messages[class_id]
        ]
