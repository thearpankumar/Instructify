import json
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import WebSocket

from ..models.classroom import Classroom, User


class RoomManager:
    def __init__(self):
        # Store active rooms: class_id -> Classroom
        self.rooms: Dict[str, Classroom] = {}
        # Store WebSocket connections: class_id -> List[WebSocket]
        self.connections: Dict[str, List[WebSocket]] = {}
        # Store user info per connection: websocket -> user_info
        self.user_connections: Dict[WebSocket, Dict] = {}

    async def create_room(self, class_id: str, teacher_name: str) -> Classroom:
        """Create a new classroom"""
        classroom = Classroom(
            class_id=class_id,
            teacher_name=teacher_name,
            created_at=datetime.now(),
            is_active=True,
        )
        self.rooms[class_id] = classroom
        self.connections[class_id] = []
        return classroom

    def get_room(self, class_id: str) -> Optional[Classroom]:
        """Get classroom by ID"""
        return self.rooms.get(class_id)

    async def add_user_to_room(
        self, class_id: str, websocket: WebSocket, user_type: str, user_name: str
    ):
        """Add user to a classroom"""
        if class_id not in self.connections:
            self.connections[class_id] = []

        # Add WebSocket connection
        self.connections[class_id].append(websocket)

        # Store user info
        self.user_connections[websocket] = {
            "class_id": class_id,
            "user_type": user_type,
            "user_name": user_name,
        }

        # Add user to classroom
        if class_id in self.rooms:
            user = User(name=user_name, user_type=user_type, joined_at=datetime.now())
            self.rooms[class_id].users.append(user)

            # Notify other users
            await self.broadcast_to_room(
                class_id,
                {
                    "type": "user_joined",
                    "user_name": user_name,
                    "user_type": user_type,
                    "user_count": len(self.rooms[class_id].users),
                },
                exclude=websocket,
            )

    async def remove_user_from_room(self, class_id: str, websocket: WebSocket):
        """Remove user from classroom"""
        if websocket in self.user_connections:
            user_info = self.user_connections[websocket]
            user_name = user_info["user_name"]
            user_type = user_info["user_type"]

            # Remove from connections
            if class_id in self.connections:
                self.connections[class_id].remove(websocket)

            # Remove user from classroom
            if class_id in self.rooms:
                self.rooms[class_id].users = [
                    user
                    for user in self.rooms[class_id].users
                    if user.name != user_name
                ]

                # Notify other users
                await self.broadcast_to_room(
                    class_id,
                    {
                        "type": "user_left",
                        "user_name": user_name,
                        "user_type": user_type,
                        "user_count": len(self.rooms[class_id].users),
                    },
                )

            # Clean up
            del self.user_connections[websocket]

    async def broadcast_to_room(
        self, class_id: str, message: dict, exclude: Optional[WebSocket] = None
    ):
        """Broadcast message to all users in a room"""
        if class_id not in self.connections:
            return

        message_str = json.dumps(message)
        disconnected = []

        for connection in self.connections[class_id]:
            if exclude and connection == exclude:
                continue

            try:
                await connection.send_text(message_str)
            except Exception:
                disconnected.append(connection)

        # Clean up disconnected connections
        for conn in disconnected:
            await self.remove_user_from_room(class_id, conn)

    async def broadcast_to_students(self, class_id: str, message: dict):
        """Send message only to students in the room"""
        if class_id not in self.connections:
            print(f"❌ No connections found for class {class_id}")
            return

        message_str = json.dumps(message)
        disconnected = []
        student_count = 0

        for connection in self.connections[class_id]:
            user_info = self.user_connections.get(connection, {})
            if user_info.get("user_type") == "student":
                student_count += 1
                try:
                    await connection.send_text(message_str)
                    print(f"✅ Sent whiteboard update to student: {user_info.get('user_name', 'Unknown')}")
                except Exception as e:
                    print(f"❌ Failed to send to student: {e}")
                    disconnected.append(connection)

        print(f"📊 Broadcast to {student_count} students in class {class_id}")

        # Clean up disconnected connections
        for conn in disconnected:
            await self.remove_user_from_room(class_id, conn)

    async def send_to_teachers(self, class_id: str, message: dict):
        """Send message only to teachers in the room"""
        if class_id not in self.connections:
            return

        message_str = json.dumps(message)

        teachers_found = 0

        for connection in self.connections[class_id]:
            if connection in self.user_connections:
                user_info = self.user_connections[connection]
                if user_info["user_type"] == "teacher":
                    teachers_found += 1
                    try:
                        await connection.send_text(message_str)
                        print(f"✅ Sent message to teacher: {user_info['user_name']}")
                    except Exception as e:
                        print(f"❌ Failed to send to teacher {user_info['user_name']}: {e}")
        
        print(f"📤 Sent message to {teachers_found} teachers")
        if teachers_found == 0:
            print(f"⚠️  No teachers found in class {class_id}")

    def get_room_users(self, class_id: str) -> List[Dict]:
        """Get list of users in a room"""
        if class_id not in self.rooms:
            return []
        return [user.dict() for user in self.rooms[class_id].users]

    async def handle_webrtc_signaling(
        self, class_id: str, sender: WebSocket, message: dict
    ):
        """Handle WebRTC signaling messages (offer, answer, ICE candidates)"""
        sender_info = self.user_connections.get(sender)
        if not sender_info:
            print("❌ No sender info found for WebRTC signaling")
            return

        print(f"📡 Backend WebRTC signaling: {message.get('signal_type')} from {sender_info['user_type']} ({sender_info['user_name']})")

        # Add sender information to the message
        message["sender_id"] = id(sender)
        message["sender_type"] = sender_info["user_type"]
        message["sender_name"] = sender_info["user_name"]
        message["type"] = "webrtc_signal"  # Ensure correct message type

        signal_type = message.get("signal_type")
        
        # Forward signaling message to appropriate recipients
        if signal_type == "student_ready" and sender_info["user_type"] == "student":
            print(f"📤 Student {sender_info['user_name']} ready - notifying teacher")
            # Student ready signal goes to teacher
            await self.send_to_teachers(class_id, message)
        elif signal_type == "offer" and sender_info["user_type"] == "teacher":
            # Teacher sending individual offer to specific student
            if "recipient_id" in message:
                print(f"📤 Teacher sending offer to specific student {message['recipient_id']}")
                await self.send_to_specific_user(class_id, message["recipient_id"], message)
            else:
                print(f"📤 Teacher broadcasting offer to all students")
                await self.broadcast_to_students(class_id, message, exclude=sender)
        elif signal_type == "answer" and sender_info["user_type"] == "student":
            # Student sending answer back to teacher - route to specific teacher
            print(f"📤 Student {sender_info['user_name']} sending answer to teacher")
            await self.send_to_teachers(class_id, message)
        elif signal_type == "ice_candidate":
            # Forward to specific recipient if specified, otherwise broadcast appropriately
            if "recipient_id" in message:
                print(f"📤 Forwarding ICE candidate to specific recipient {message['recipient_id']}")
                await self.send_to_specific_user(class_id, message["recipient_id"], message)
            else:
                # ICE candidates from teacher go to all students, from students go to teacher
                if sender_info["user_type"] == "teacher":
                    print(f"📤 Broadcasting teacher ICE candidate to students")
                    await self.broadcast_to_students(class_id, message, exclude=sender)
                else:
                    print(f"📤 Sending student ICE candidate to teachers")
                    await self.send_to_teachers(class_id, message)

    async def broadcast_to_students(
        self, class_id: str, message: dict, exclude: Optional[WebSocket] = None
    ):
        """Broadcast message only to students in the room"""
        if class_id not in self.connections:
            print(f"❌ No connections found for class {class_id}")
            return

        message_str = json.dumps(message)
        disconnected = []
        student_count = 0

        for connection in self.connections[class_id]:
            if exclude and connection == exclude:
                continue

            # Check if this connection belongs to a student
            user_info = self.user_connections.get(connection)
            if user_info and user_info["user_type"] == "student":
                student_count += 1
                try:
                    await connection.send_text(message_str)
                    print(f"✅ Sent WebRTC signal to student: {user_info['user_name']}")
                except Exception as e:
                    print(f"❌ Failed to send to student {user_info['user_name']}: {e}")
                    disconnected.append(connection)

        print(f"📤 Sent WebRTC signal to {student_count} students")

        # Clean up disconnected connections
        for conn in disconnected:
            if conn in self.connections[class_id]:
                self.connections[class_id].remove(conn)

    async def send_to_specific_user(
        self, class_id: str, recipient_id: int, message: dict
    ):
        """Send message to a specific user by connection ID"""
        if class_id not in self.connections:
            return

        message_str = json.dumps(message)
        
        for connection in self.connections[class_id]:
            if id(connection) == recipient_id:
                try:
                    await connection.send_text(message_str)
                except Exception:
                    # Remove disconnected connection
                    if connection in self.connections[class_id]:
                        self.connections[class_id].remove(connection)
                break
