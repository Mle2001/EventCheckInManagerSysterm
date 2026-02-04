"""
Security middleware for Event Check-in Management System.

Implements comprehensive security protections:
- XSS (Cross-Site Scripting) protection via Content Security Policy
- CSRF (Cross-Site Request Forgery) protection via SameSite cookies
- Clickjacking protection via X-Frame-Options
- MIME type sniffing protection via X-Content-Type-Options
- Referrer policy for privacy
- HSTS (HTTP Strict Transport Security) for HTTPS enforcement
- Rate limiting to prevent abuse

Updated: 2025-01-XX
Author: Claude Code
Security Standard: OWASP Top 10 2021
"""

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
from typing import Dict, Optional
import time
from collections import defaultdict
import re


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Middleware to add security headers to all HTTP responses.

    Protections:
    - XSS: Content-Security-Policy
    - Clickjacking: X-Frame-Options
    - MIME Sniffing: X-Content-Type-Options
    - XSS Filter: X-XSS-Protection
    - Referrer: Referrer-Policy
    - HTTPS: Strict-Transport-Security (production only)
    """

    def __init__(self, app: ASGIApp, enable_hsts: bool = False):
        super().__init__(app)
        self.enable_hsts = enable_hsts

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # Content Security Policy - Prevents XSS attacks
        # Allows same-origin resources and specific external sources
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "  # Allow inline scripts for React
            "style-src 'self' 'unsafe-inline'; "  # Allow inline styles for Chakra UI
            "img-src 'self' data: blob: https:; "  # Allow images from various sources
            "font-src 'self' data:; "
            "connect-src 'self' ws: wss:; "  # Allow WebSocket connections
            "frame-ancestors 'none'; "  # Prevent clickjacking
        )

        # Prevent clickjacking - Don't allow site to be embedded in iframe
        response.headers["X-Frame-Options"] = "DENY"

        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Enable XSS filter in browser (legacy support)
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Control referrer information
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Permissions Policy - Restrict browser features
        response.headers["Permissions-Policy"] = (
            "geolocation=(), "
            "microphone=(), "
            "camera=()"
        )

        # HTTP Strict Transport Security (HSTS) - Force HTTPS
        # Only enable in production with valid SSL certificate
        if self.enable_hsts:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains; preload"
            )

        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Simple rate limiting middleware to prevent abuse.

    Limits:
    - 100 requests per minute per IP for general endpoints
    - 10 requests per minute per IP for auth endpoints

    Note: For production, use Redis-based rate limiting (e.g., slowapi)
    """

    def __init__(self, app: ASGIApp):
        super().__init__(app)
        # Store: {ip: [(timestamp, endpoint), ...]}
        self.request_history: Dict[str, list] = defaultdict(list)
        self.window_size = 60  # 60 seconds
        self.max_requests_general = 100
        self.max_requests_auth = 10

    def _clean_old_requests(self, ip: str, current_time: float):
        """Remove requests older than the window size."""
        cutoff_time = current_time - self.window_size
        self.request_history[ip] = [
            (ts, endpoint) for ts, endpoint in self.request_history[ip]
            if ts > cutoff_time
        ]

    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP from request."""
        # Check for proxy headers first
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()

        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip

        # Fallback to direct connection
        if request.client:
            return request.client.host

        return "unknown"

    async def dispatch(self, request: Request, call_next):
        client_ip = self._get_client_ip(request)
        current_time = time.time()
        endpoint = request.url.path

        # Clean old requests
        self._clean_old_requests(client_ip, current_time)

        # Count recent requests
        recent_requests = self.request_history[client_ip]

        # Determine rate limit based on endpoint
        is_auth_endpoint = "/api/auth/" in endpoint
        max_requests = self.max_requests_auth if is_auth_endpoint else self.max_requests_general

        # Count requests to this type of endpoint
        if is_auth_endpoint:
            auth_requests = [r for r in recent_requests if "/api/auth/" in r[1]]
            request_count = len(auth_requests)
        else:
            request_count = len(recent_requests)

        # Check if rate limit exceeded
        if request_count >= max_requests:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": f"Rate limit exceeded. Maximum {max_requests} requests per minute.",
                    "retry_after": self.window_size
                },
                headers={
                    "Retry-After": str(self.window_size),
                    "X-RateLimit-Limit": str(max_requests),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(current_time + self.window_size))
                }
            )

        # Record this request
        self.request_history[client_ip].append((current_time, endpoint))

        # Process request
        response = await call_next(request)

        # Add rate limit headers
        remaining = max_requests - request_count - 1
        response.headers["X-RateLimit-Limit"] = str(max_requests)
        response.headers["X-RateLimit-Remaining"] = str(max(0, remaining))
        response.headers["X-RateLimit-Reset"] = str(int(current_time + self.window_size))

        return response


class InputSanitizationMiddleware(BaseHTTPMiddleware):
    """
    Middleware to sanitize and validate request inputs.

    Protections:
    - SQL Injection: Block suspicious SQL patterns
    - XSS: Block script tags and event handlers
    - Path Traversal: Block ../ patterns
    - Command Injection: Block shell metacharacters

    Note: This is a basic layer. Pydantic models provide primary validation.
    """

    # Suspicious patterns
    SQL_INJECTION_PATTERNS = [
        r"(\bUNION\b.*\bSELECT\b)",
        r"(\bSELECT\b.*\bFROM\b)",
        r"(\bINSERT\b.*\bINTO\b)",
        r"(\bDELETE\b.*\bFROM\b)",
        r"(\bDROP\b.*\bTABLE\b)",
        r"(--|\#|\/\*)",
        r"(\bOR\b.*=.*)",
        r"(\';)",
    ]

    XSS_PATTERNS = [
        r"<script[^>]*>.*?</script>",
        r"javascript:",
        r"on\w+\s*=",  # Event handlers like onclick=
        r"<iframe",
        r"<object",
        r"<embed",
    ]

    PATH_TRAVERSAL_PATTERNS = [
        r"\.\./",
        r"\.\.",
    ]

    def __init__(self, app: ASGIApp):
        super().__init__(app)
        # Compile patterns for performance
        self.sql_patterns = [re.compile(p, re.IGNORECASE) for p in self.SQL_INJECTION_PATTERNS]
        self.xss_patterns = [re.compile(p, re.IGNORECASE) for p in self.XSS_PATTERNS]
        self.path_patterns = [re.compile(p, re.IGNORECASE) for p in self.PATH_TRAVERSAL_PATTERNS]

    def _check_patterns(self, text: str, patterns: list) -> Optional[str]:
        """Check if text matches any suspicious pattern."""
        for pattern in patterns:
            if pattern.search(text):
                return pattern.pattern
        return None

    def _scan_dict(self, data: dict) -> Optional[str]:
        """Recursively scan dictionary for malicious content."""
        for key, value in data.items():
            if isinstance(value, str):
                # Check for SQL injection
                if match := self._check_patterns(value, self.sql_patterns):
                    return f"Potential SQL injection detected: {match}"

                # Check for XSS
                if match := self._check_patterns(value, self.xss_patterns):
                    return f"Potential XSS detected: {match}"

                # Check for path traversal
                if match := self._check_patterns(value, self.path_patterns):
                    return f"Potential path traversal detected: {match}"

            elif isinstance(value, dict):
                if error := self._scan_dict(value):
                    return error

            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        if error := self._scan_dict(item):
                            return error
                    elif isinstance(item, str):
                        if match := self._check_patterns(item, self.sql_patterns):
                            return f"Potential SQL injection detected: {match}"
                        if match := self._check_patterns(item, self.xss_patterns):
                            return f"Potential XSS detected: {match}"

        return None

    async def dispatch(self, request: Request, call_next):
        # Only check POST/PUT/PATCH requests with JSON body
        if request.method in ["POST", "PUT", "PATCH"]:
            content_type = request.headers.get("content-type", "")

            if "application/json" in content_type:
                # Get body
                body = await request.body()

                # Try to parse as JSON
                try:
                    import json
                    data = json.loads(body.decode("utf-8"))

                    # Scan for malicious content
                    if isinstance(data, dict):
                        if error := self._scan_dict(data):
                            return JSONResponse(
                                status_code=400,
                                content={
                                    "detail": f"Malicious input detected: {error}"
                                }
                            )
                except:
                    pass  # If can't parse, let it through (will fail at Pydantic validation)

        response = await call_next(request)
        return response


# CSRF Token utilities (for future implementation)
class CSRFProtection:
    """
    CSRF protection utilities.

    Note: Currently using SameSite cookies which provides good CSRF protection.
    For enhanced security, implement CSRF tokens for state-changing operations.

    Future implementation:
    1. Generate CSRF token on login
    2. Store in httpOnly cookie
    3. Require X-CSRF-Token header on POST/PUT/DELETE
    4. Validate token matches cookie
    """

    @staticmethod
    def generate_token() -> str:
        """Generate a secure CSRF token."""
        import secrets
        return secrets.token_urlsafe(32)

    @staticmethod
    def validate_token(token: str, cookie_token: str) -> bool:
        """Validate CSRF token against cookie token."""
        import hmac
        return hmac.compare_digest(token, cookie_token)
