from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import uuid
from typing import Dict, List, Optional
import asyncio

from .websockets.room_manager import RoomManager
from .websockets.chat_handler import ChatHandler
from .models.classroom import Classroom, ClassroomCreate

app = FastAPI(title="Instructify API", description="EdTech Platform with AI-powered features")

# CORS middleware for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize managers
room_manager = RoomManager()
chat_handler = ChatHandler(room_manager)

@app.get("/")
async def root():
    return {"message": "Instructify API is running"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

# Classroom management endpoints
@app.post("/api/classroom/create")
async def create_classroom(classroom_data: ClassroomCreate):
    """Create a new classroom and return classroom ID"""
    class_id = str(uuid.uuid4())[:8]  # Short ID for easy sharing
    classroom = await room_manager.create_room(class_id, classroom_data.teacher_name)
    return {"class_id": class_id, "teacher_name": classroom_data.teacher_name}

@app.get("/api/classroom/{class_id}")
async def get_classroom(class_id: str):
    """Get classroom information"""
    classroom = room_manager.get_room(class_id)
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")
    return classroom.dict()

@app.websocket("/ws/classroom/{class_id}")
async def websocket_endpoint(websocket: WebSocket, class_id: str):
    """Main WebSocket endpoint for classroom communication"""
    await websocket.accept()
    
    try:
        # Wait for initial message to determine user type (teacher/student)
        data = await websocket.receive_text()
        message = json.loads(data)
        
        user_type = message.get("user_type")  # "teacher" or "student"
        user_name = message.get("user_name", "Anonymous")
        
        # Add user to room
        await room_manager.add_user_to_room(class_id, websocket, user_type, user_name)
        
        # Send confirmation
        await websocket.send_text(json.dumps({
            "type": "connection_confirmed",
            "user_type": user_type,
            "class_id": class_id
        }))
        
        # Handle incoming messages
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            await chat_handler.handle_message(class_id, websocket, message)
            
    except WebSocketDisconnect:
        await room_manager.remove_user_from_room(class_id, websocket)
    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)