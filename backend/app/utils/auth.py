import uuid


class SimpleAuth:
    """Simple authentication helper for prototype"""

    @staticmethod
    def generate_session_id() -> str:
        """Generate a simple session ID"""
        return str(uuid.uuid4())

    @staticmethod
    def validate_user_type(user_type: str) -> bool:
        """Validate user type"""
        return user_type in ["teacher", "student"]

    @staticmethod
    def generate_class_id() -> str:
        """Generate a short, shareable class ID"""
        return str(uuid.uuid4())[:8].upper()
