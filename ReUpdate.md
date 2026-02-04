# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Event Check-in Management System - A real-time event management platform for handling guest check-ins at scale. Supports up to 500 tables, 5,000 seats, and 10,000 guests with sub-second synchronization across devices.

**Tech Stack:**
- Backend: Python 3.9+ with FastAPI, Socket.IO for real-time communication
- Frontend: React 18 with Vite, Chakra UI, React-Konva for canvas-based layout builder
- Storage: Custom JSON file-based database with file locking for concurrency control
- Auth: JWT-based authentication with role-based access control (Admin/Staff)

## Common Development Commands

### Backend

```bash
cd backend

# Start development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# Or use the provided script
bash start.sh

# Run tests
pytest tests/ -v
# Or use the script with coverage
bash run_tests.sh

# Run specific test file
pytest tests/test_guests.py -v

# Verify dependencies
python check_connection.py

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Linux/macOS
venv\Scripts\activate     # On Windows

# Install dependencies
pip install -r requirements.txt
```

Backend runs at: `http://localhost:8000`
API documentation: `http://localhost:8000/docs` (Swagger UI)

### Frontend

```bash
cd frontend

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint

# Install dependencies
npm install
```

Frontend runs at: `http://localhost:5173`

Default credentials for development:
- Email: `admin@example.com`
- Password: `admin123`

## System Architecture

### Custom JSON Storage Engine: "Memory-First, Disk-Later"

The system uses a hierarchical JSON file storage approach instead of a traditional database. This is implemented in [backend/app/storage/json_db.py](backend/app/storage/json_db.py).

**Key Design Principles:**
1. **In-Memory Cache**: All reads are served from an in-memory cache for maximum performance
2. **Pessimistic File Locking**: Uses `filelock` library to ensure atomic writes and prevent race conditions
3. **Thread-Safe**: Protected by ThreadLock for concurrent access
4. **Atomic Writes**: Uses temp file + replace pattern (Windows-safe)

**Data Structure:**
```
data/
├── users.json                    # User credentials and role assignments
└── events/
    ├── EV{EVENT_ID}/
    │   ├── event.json           # Event metadata (name, date, status)
    │   ├── guests.json          # Guest list with check-in timestamps
    │   ├── tables.json          # Table/seat configuration
    │   └── layout_config.json   # Layout builder visual settings
    └── ...
```

**Why This Approach:**
- Zero external database dependencies
- Full transactional control via file locking
- Easy backup, version control, and inspection
- Perfect for small to mid-size deployments
- Linear scalability up to 5,000 concurrent users

### Real-Time Communication (Socket.IO)

Socket.IO provides instant updates across all connected clients. The socket server is integrated into the FastAPI app via ASGIApp wrapper in [backend/app/main.py](backend/app/main.py:57-61).

**Socket Event Types:**
- `guest_updated` - Guest check-in/checkout status changed
- `table_updated` - Table configuration modified
- `guest_added` - New guest added to event
- `layout_updated` - Layout configuration changed

**Event Flow (Check-in Example):**
1. Client sends `POST /api/events/{id}/checkin`
2. Backend acquires file lock on `guests.json`
3. Updates guest record in memory (`checked_in=True`, `checked_in_at=timestamp`)
4. Writes to disk atomically
5. Releases lock
6. Broadcasts `guest_updated` event via Socket.IO to room `event_{id}`
7. All connected clients receive update and refresh UI

### API Structure

API routes are organized by domain in [backend/app/api/](backend/app/api/):
- `auth.py` - Authentication (login, user management, password changes)
- `events.py` - Event CRUD, duplication, staff assignment
- `guests.py` - Guest CRUD, CSV import/export, check-in/checkout
- `layouts.py` - Layout builder (tables, seats, assignments)
- `reports.py` - Attendance reports, analytics, exports

All routes use FastAPI dependency injection for authentication:
- `get_current_active_user` - Validates JWT token, returns current user
- `get_current_admin_user` - Validates JWT + checks admin role

### Authentication & Authorization

JWT tokens are issued at login and validated on each request. Implemented in [backend/app/core/security.py](backend/app/core/security.py).

**Roles:**
- `super_admin` - Full system access
- `admin` - Event creation, guest management, layout builder
- `staff` - Check-in/checkout interface only, limited to assigned events

Staff users have an `assigned_events` list that restricts which events they can access.

## Frontend Architecture

### State Management
- **Zustand** ([frontend/src/store/](frontend/src/store/)) - Global state for auth and events
- **TanStack Query** (React Query) - Server state management and caching
- **React Hook Form** - Form state and validation

### Key Components
- `AdminDashboard.jsx` - Admin portal entry point
- `StaffDashboard.jsx` - Staff check-in interface
- `LayoutBuilder.jsx` - Drag-and-drop canvas for table layouts (uses React-Konva)
- `StaffCheckIn.jsx` - Real-time interactive check-in canvas

### API Client
[frontend/src/services/api.js](frontend/src/services/api.js) exports organized API functions:
- `authAPI` - Login, user management
- `eventsAPI` - Event operations
- `guestsAPI` - Guest operations, CSV import/export
- `layoutAPI` - Layout and table management
- `reportsAPI` - Reports and exports

### Socket Integration
[frontend/src/services/socket.js](frontend/src/services/socket.js) manages the Socket.IO connection. Components use it to listen for real-time events.

## Mobile Optimization (IMPORTANT)

The canvas-based layout builder and check-in views have been optimized for mobile devices. Key optimizations implemented:

### Responsive Canvas Dimensions
Canvas dimensions adapt to device size:
- **Mobile** (< 768px): 800x600px
- **Tablet** (768-992px): 1200x900px
- **Desktop** (> 992px): 2000x1500px

Implemented in both [frontend/src/components/admin/LayoutBuilder.jsx](frontend/src/components/admin/LayoutBuilder.jsx:67-74) and [frontend/src/components/staff/CheckInView.jsx](frontend/src/components/staff/CheckInView.jsx:39-46):

```javascript
const getCanvasDimensions = (isMobile, isTablet) => {
  if (isMobile) return { width: 800, height: 600 }
  if (isTablet) return { width: 1200, height: 900 }
  return { width: 2000, height: 1500 }
}
```

### Viewport Culling for Grid Lines
Grid rendering in LayoutBuilder now uses viewport culling to only render visible grid lines. This reduces rendering from 175+ grid line elements to only ~20-40 visible ones.

**Performance Impact:**
- Desktop: Minimal impact (already fast)
- Mobile: 60-70% reduction in rendering overhead

Implementation: [frontend/src/components/admin/LayoutBuilder.jsx](frontend/src/components/admin/LayoutBuilder.jsx:102-165)

### Component Memoization
- `GridLayer` - Memoized with viewport culling
- `TableShape` - Memoized to prevent re-renders
- `TableDisplay` - Memoized in CheckInView to prevent unnecessary re-renders on guest updates
- `SeatShape` - Memoized to prevent re-renders

### Shadow Rendering Optimization
Shadow effects (blur, opacity) are expensive on mobile GPUs and have been disabled on mobile devices:

```javascript
shadowBlur={!isMobile && guest ? 5 : 0}
```

This improves rendering performance by ~30% on mobile devices while maintaining visual quality on desktop.

### Responsive Container Heights
Container heights now use Chakra UI responsive values:
- Mobile: 400-500px
- Tablet: 500-600px
- Desktop: 600px or auto

This prevents scrolling issues and viewport overflow on small screens.

### Mobile-Specific Considerations

When working with canvas components:
1. **Always test on mobile devices** - Chrome DevTools mobile emulation is good but not perfect
2. **Avoid adding expensive effects** - Shadows, gradients, and complex fills hurt mobile performance
3. **Use memoization** - Wrap components with `React.memo()` to prevent unnecessary re-renders
4. **Monitor render count** - Use React DevTools Profiler to check render performance
5. **Background images** - Hidden on mobile in LayoutBuilder to save bandwidth (line 1007-1009)

### Performance Targets
- **Desktop**: 60 FPS rendering with 500 tables
- **Tablet**: 45-60 FPS with 300 tables
- **Mobile**: 30-45 FPS with 200 tables
- **Touch latency**: < 100ms from touch to visual feedback

## Important Implementation Details

### Concurrency Control

Guest check-ins use the "Memory-First, Disk-Later" pattern to prevent race conditions:

```python
# In json_db.py
def update_guest(self, event_id: str, guest_id: str, update_data: Dict):
    guests = self.get_all_guests(event_id)  # Read from cache
    guest = next((g for g in guests if g["id"] == guest_id), None)
    guest.update(update_data)
    guest["updated_at"] = datetime.utcnow().isoformat()
    self._write_json(file, guests)  # Atomic write with file lock
    return guest
```

The `_write_json` method:
1. Acquires FileLock
2. Writes to temp file
3. Atomically replaces original file
4. Releases lock
5. Updates in-memory cache

### Check-in/Checkout Flow

Check-in and checkout do NOT overwrite each other's timestamps. Both timestamps are preserved:
- `checked_in` (bool) - Current status
- `checked_in_at` (datetime) - When guest arrived
- `checked_out_at` (datetime) - When guest left

This allows full lifecycle tracking and reporting.

### Layout Builder Canvas

React-Konva is used for the drag-and-drop layout builder. Tables are positioned using relative coordinates (percentages) for responsive layouts.

**Table Types:**
- `round` - Circular tables with seats arranged in a circle
- `rectangular` - Rectangular tables with seats along edges

Seats are auto-generated based on `num_seats` and positioned relative to table center.

### CSV Import/Export

Guest CSV format (required columns):
```csv
full_name,phone,email,company,notes
John Doe,+1234567890,john@example.com,Acme Inc,VIP
```

Phone numbers are used as unique identifiers - duplicates are rejected during import.

## Configuration

### Backend Configuration
[backend/app/config.py](backend/app/config.py) - Uses pydantic-settings for environment variables

Key settings:
- `SECRET_KEY` - JWT signing key (change in production!)
- `DATA_DIR` - Path to JSON storage (default: `./data`)
- `FILE_LOCK_TIMEOUT` - File lock timeout in seconds (default: 10)
- `MAX_TABLES_PER_EVENT` - Maximum tables per event (default: 500)
- `MAX_SEATS_PER_EVENT` - Maximum seats per event (default: 5000)
- `CORS_ORIGINS` - Allowed origins for CORS

### Frontend Configuration
Create `.env` file in `frontend/`:
```bash
VITE_API_URL=http://localhost:8000
VITE_SOCKET_URL=http://localhost:8000
VITE_ENV=development
```

## Testing

### Backend Tests
Test files are in [backend/tests/](backend/tests/). Key test suites:
- `test_auth.py` - Authentication flows
- `test_events.py` - Event CRUD operations
- `test_guests.py` - Guest management and CSV operations
- `test_staff_checkin.py` - Real-time check-in scenarios
- `reproduce_stress.py` - Stress test with 5,000 concurrent check-ins

Run tests with: `pytest tests/ -v`

### Important Test Patterns
Tests use `conftest.py` fixtures for test client setup and mock data. The test client automatically handles authentication.

## Common Patterns

### Adding a New API Endpoint

1. Define Pydantic models in [backend/app/models/](backend/app/models/)
2. Add route to appropriate router in [backend/app/api/](backend/app/api/)
3. Use `Depends(get_current_active_user)` for authentication
4. Emit Socket.IO event if real-time update needed
5. Add corresponding function to [frontend/src/services/api.js](frontend/src/services/api.js)

### Emitting Socket Events

```python
from app.socket.manager import sio

# After updating data
await sio.emit('guest_updated', {
    'event_id': event_id,
    'guest': guest_data
}, room=f'event_{id}')
```

### Listening to Socket Events (Frontend)

```javascript
import { socket } from './services/socket'

useEffect(() => {
  socket.on('guest_updated', (data) => {
    // Update UI or refetch data
  })

  return () => {
    socket.off('guest_updated')
  }
}, [])
```

### Adding Mobile-Optimized Canvas Components

When creating new canvas components:

```javascript
import { memo, useMemo } from 'react'
import { useBreakpointValue } from '@chakra-ui/react'

const MyCanvasComponent = memo(({ data, isMobile }) => {
  // Avoid expensive calculations on every render
  const processedData = useMemo(() => {
    return heavyComputation(data)
  }, [data])

  return (
    <Group>
      {/* Disable expensive effects on mobile */}
      <Circle
        shadowBlur={!isMobile ? 5 : 0}
        fill={color}
      />
    </Group>
  )
})
```

## Performance Considerations

- Cache invalidation happens automatically after writes
- File locks timeout after 10 seconds (configurable)
- Socket.IO rooms are used for event-scoped broadcasts (prevents unnecessary updates)
- Frontend uses React Query for automatic cache management and background refetching
- Layout canvas rendering is optimized for 60fps with up to 500 tables on desktop, 30-45fps with 200 tables on mobile
- Grid viewport culling reduces rendering overhead by 60-70% on mobile
- Component memoization prevents unnecessary re-renders
- Shadow effects disabled on mobile to save GPU cycles

## Deployment Notes

The system is designed to run on Windows but is cross-platform compatible. For production:

1. Change `SECRET_KEY` in backend config
2. Set `DEBUG=False`
3. Use production ASGI server (e.g., `gunicorn` with `uvicorn.workers.UvicornWorker`)
4. Build frontend with `npm run build` and serve static files
5. Set up regular backups of the `data/` directory
6. Configure proper CORS origins
7. Use HTTPS/TLS for production traffic
8. Test on actual mobile devices before deployment

## Troubleshooting

### File Lock Issues
If locks persist after crashes, delete `.lock` files in `data/` directory manually.

### Socket Connection Issues
Check that Socket.IO path is correctly set: `socketio_path="socket.io"` in backend and matching client config.

### Cache Inconsistency
Call `db.invalidate_cache()` to clear the cache if data appears stale after manual file edits.

### Mobile Canvas Performance Issues
1. Check if grid culling is working - should only render ~20-40 lines on mobile
2. Verify shadow effects are disabled on mobile (`shadowBlur={!isMobile ? 5 : 0}`)
3. Check component memoization - TableDisplay, SeatShape, TableShape should all be memoized
4. Use Chrome DevTools Performance tab to profile rendering
5. Reduce number of tables/seats if performance is still poor

### Canvas Not Displaying on Mobile
1. Verify responsive dimensions are being applied (check console logs)
2. Check container heights are responsive
3. Ensure viewport meta tag is set in index.html
4. Test on real device, not just emulator

## Additional Documentation

See [documents/](documents/) folder for detailed architecture docs:
- `SYSTEM_DESIGN.md` - System architecture and data flows
- `TECHNICAL_DESIGN.md` - API specifications
- `START_HERE.md` - Quick start guide
- `BACKEND_COMPLETE_SUMMARY.md` - Backend features
- `FRONTEND_100_COMPLETE.md` - Frontend features
