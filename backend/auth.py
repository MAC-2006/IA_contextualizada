from passlib.context import CryptContext
from jose import jwt
import datetime, os

SECRET    = os.getenv("JWT_SECRET", "mude-isso-em-producao")
ALGORITHM = "HS256"
pwd_ctx   = CryptContext(schemes=["bcrypt"])

def hash_password(pw):       return pwd_ctx.hash(pw)
def verify_password(pw, h):  return pwd_ctx.verify(pw, h)

def create_token(user_id: str) -> str:
    # utcnow() está deprecado no Python 3.12+ — usar timezone-aware
    exp = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)
    return jwt.encode({"sub": user_id, "exp": exp}, SECRET, algorithm=ALGORITHM)

def decode_token(token: str) -> str:
    return jwt.decode(token, SECRET, algorithms=[ALGORITHM])["sub"]