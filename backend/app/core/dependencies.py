"""
FastAPI dependencies for authentication and authorization.

Role-Based Access Control (RBAC) Implementation:
- get_current_user: Validates JWT token, extracts user info
- get_current_active_user: Ensures user account is active
- get_current_admin_user: Requires admin or super_admin role
- get_current_super_admin_user: Requires super_admin role only

Security Features:
- Bearer token authentication (HTTP Authorization header)
- Token expiration validation
- Role-based authorization
- Inactive user blocking

OWASP Compliance:
- A01:2021 – Broken Access Control: Strict role verification
- A07:2021 – Identification and Authentication Failures: Multi-layer auth checks

Updated: 2025-01-XX
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.models import User, UserRole, TokenData
from app.core.security import decode_access_token
from app.services.auth_service import AuthService

# HTTP Bearer token security
security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> User:
    """
    Dependency to get the current authenticated user.
    
    Args:
        credentials: HTTP Bearer token
        
    Returns:
        Current user
        
    Raises:
        HTTPException: If token is invalid or user not found
    """
    token = credentials.credentials
    token_data = decode_access_token(token)
    
    if token_data is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user = AuthService.get_current_user(token_data)
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    Dependency to get the current active user.
    
    Args:
        current_user: Current user from token
        
    Returns:
        Current active user
        
    Raises:
        HTTPException: If user is inactive
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    return current_user


async def get_current_admin_user(
    current_user: User = Depends(get_current_active_user)
) -> User:
    """
    Dependency to ensure current user is an admin or super admin.
    
    Args:
        current_user: Current active user
        
    Returns:
        Current admin user
        
    Raises:
        HTTPException: If user is not admin
    """
    if current_user.role not in [UserRole.ADMIN, UserRole.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )
    return current_user


async def get_current_super_admin_user(
    current_user: User = Depends(get_current_active_user)
) -> User:
    """
    Dependency to ensure current user is a super admin.
    
    Args:
        current_user: Current active user
        
    Returns:
        Current super admin user
        
    Raises:
        HTTPException: If user is not super admin
    """
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin access required"
        )
    return current_user
