import json
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

# Load environment variables from .env file
load_dotenv()

from .models.classroom import ClassroomCreate
from .services.transcription_service import TranscriptionService
from .websockets.chat_handler import ChatHandler
from .websockets.room_manager import RoomManager

app = FastAPI(
    title="Instructify API", description="EdTech Platform with AI-powered features"
)

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
transcription_service = TranscriptionService()


# Pydantic models for API requests
class TranscriptChunk(BaseModel):
    text: str
    timestamp: str = None


class NotesRequest(BaseModel):
    class_id: str


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
    await room_manager.create_room(class_id, classroom_data.teacher_name)
    return {"class_id": class_id, "teacher_name": classroom_data.teacher_name}


@app.get("/api/classroom/{class_id}")
async def get_classroom(class_id: str):
    """Get classroom information"""
    classroom = room_manager.get_room(class_id)
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")
    return classroom.dict()


# Transcription endpoints
@app.post("/api/transcription/{class_id}/add")
async def add_transcript_chunk(class_id: str, chunk: TranscriptChunk):
    """Add a chunk of transcribed text to the class"""
    transcription_service.add_transcript_chunk(class_id, chunk.text, chunk.timestamp)
    return {"status": "success", "message": "Transcript chunk added"}


@app.get("/api/transcription/{class_id}")
async def get_transcript(class_id: str):
    """Get the full transcript for a class"""
    transcript = transcription_service.get_transcript(class_id)
    return {"transcript": transcript}


@app.post("/api/notes/generate")
async def generate_notes(request: NotesRequest):
    """Generate smart notes from class transcript"""
    notes = await transcription_service.generate_notes(request.class_id)
    if not notes:
        raise HTTPException(status_code=404, detail="No transcript found or notes generation failed")
    return {"notes": notes}


@app.get("/api/notes/{class_id}/download")
async def download_notes(class_id: str):
    """Download notes as a text file"""
    notes = await transcription_service.generate_notes(class_id)
    if not notes:
        raise HTTPException(status_code=404, detail="No notes available")
    
    formatted_notes = transcription_service.export_notes(class_id, notes)
    return PlainTextResponse(
        formatted_notes,
        headers={"Content-Disposition": f"attachment; filename=class_notes_{class_id}.txt"}
    )


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
        await websocket.send_text(
            json.dumps(
                {
                    "type": "connection_confirmed",
                    "user_type": user_type,
                    "class_id": class_id,
                }
            )
        )

        # Handle incoming messages
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            print(f"📨 Received WebSocket message: {message.get('type')} from {user_name} ({user_type})")

            await chat_handler.handle_message(class_id, websocket, message)

    except WebSocketDisconnect:
        await room_manager.remove_user_from_room(class_id, websocket)
    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.close()


if __name__ == "__main__":
    import uvicorn

    # Binding to 0.0.0.0 is intentional for containerized deployments
    # In production, this should be behind a reverse proxy or firewall
    uvicorn.run(app, host="0.0.0.0", port=8000)  # nosec B104
