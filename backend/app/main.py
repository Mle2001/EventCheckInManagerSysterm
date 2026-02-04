"""
Main FastAPI application entry point with comprehensive security.

Security Features Implemented:
- HTTPS enforcement (production)
- Password hashing (bcrypt)
- Role-based access control (RBAC)
- XSS protection (Content Security Policy)
- CSRF protection (SameSite cookies)
- Clickjacking protection (X-Frame-Options)
- MIME sniffing protection (X-Content-Type-Options)
- Rate limiting (100 req/min general, 10 req/min auth)
- Input sanitization (SQL injection, XSS, path traversal)
- Security headers (HSTS, Referrer-Policy, Permissions-Policy)

Updated: 2025-01-XX
Security Standard: OWASP Top 10 2021
"""
from socketio import ASGIApp
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.socket.manager import sio
from app.socket import events as socket_events
from app.api import auth, events, guests, layouts, reports
from app.middleware.security import (
    SecurityHeadersMiddleware,
    RateLimitMiddleware,
    InputSanitizationMiddleware
)

# Create FastAPI app
app = FastAPI(
    title="Event Check-in Management System",
    version="1.0.0",
    docs_url="/docs" if settings.DEBUG else None,  # Disable docs in production
    redoc_url="/redoc" if settings.DEBUG else None
)

# Security Middlewares (order matters!)
# 1. Rate limiting - First line of defense against abuse
app.add_middleware(RateLimitMiddleware)

# 2. Input sanitization - Block malicious inputs early
app.add_middleware(InputSanitizationMiddleware)

# 3. Security headers - Add protective HTTP headers
# Enable HSTS only in production with valid SSL
app.add_middleware(
    SecurityHeadersMiddleware,
    enable_hsts=not settings.DEBUG  # Only enable HSTS in production
)

# 4. CORS - Must be last to ensure headers are added
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]
)

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(events.router, prefix="/api/events", tags=["events"])
app.include_router(guests.router, prefix="/api/events", tags=["guests"])
app.include_router(layouts.router, prefix="/api/events", tags=["layouts"])
app.include_router(reports.router, prefix="/api/events", tags=["reports"])

# Health check
@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/api/health")
async def health_api():
    return {"status": "healthy"}


@app.get("/")
async def root():
    return {
        "message": "Welcome to Event Check-in Manager API",
        "docs": "/docs",
        "health": "/health"
    }

# Register Socket.IO event handlers (AFTER app is ready)
socket_events.register_handlers(sio)

# Mount FastAPI under Socket.IO
socket_app = ASGIApp(
    sio,
    other_asgi_app=app,
    socketio_path="socket.io"
)

# Export for uvicorn
__all__ = ['socket_app']
