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

    async def send_to_teachers(self, class_id: str, message: dict):
        """Send message only to teachers in the room"""
        if class_id not in self.connections:
            return

        message_str = json.dumps(message)

        for connection in self.connections[class_id]:
            if connection in self.user_connections:
                user_info = self.user_connections[connection]
                if user_info["user_type"] == "teacher":
                    try:
                        await connection.send_text(message_str)
                    except Exception:
                        pass

    def get_room_users(self, class_id: str) -> List[Dict]:
        """Get list of users in a room"""
        if class_id not in self.rooms:
            return []
        return [user.dict() for user in self.rooms[class_id].users]
