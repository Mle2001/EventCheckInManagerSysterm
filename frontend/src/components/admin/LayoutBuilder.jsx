import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Stage, Layer, Circle, Rect, Group, Text as KonvaText, Image as KonvaImage } from 'react-konva'
import Konva from 'konva'
import React from 'react'
import {
  Box,
  Button,
  Flex,
  Heading,
  VStack,
  HStack,
  Select,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  FormControl,
  FormLabel,
  IconButton,
  Tooltip,
  Card,
  CardBody,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Input,
  Text,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  DrawerBody,
  useBreakpointValue,
  Spinner,
} from '@chakra-ui/react'
import {
  FiPlus,
  FiSave,
  FiTrash2,
  FiArrowLeft,
  FiGrid,
  FiCircle,
  FiSquare,
  FiImage,
  FiRotateCw,
  FiTool,
  FiCopy,
  FiDownload,
} from 'react-icons/fi'
import toast from 'react-hot-toast'
import { layoutAPI, guestsAPI, getErrorMessage } from '../../services/api'
import { useSocket } from '../../hooks/useSocket'
import CanvasControls from '../shared/CanvasControls'

// Canvas dimensions - responsive based on device
// Desktop: 2000x1500 | Tablet: 1200x900 | Mobile: 800x600
const getCanvasDimensions = (isMobile, isTablet) => {
  if (isMobile) return { width: 800, height: 600 }
  if (isTablet) return { width: 1200, height: 900 }
  return { width: 2000, height: 1500 }
}

const GRID_SIZE = 20

// Background Image Component with error handling
const BackgroundImage = ({ src, width, height }) => {
  const [image, setImage] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!src) {
      setImage(null)
      setError(false)
      return
    }
    const img = new window.Image()
    img.src = src
    img.onload = () => {
      setImage(img)
      setError(false)
    }
    img.onerror = () => {
      setError(true)
      setImage(null)
    }
  }, [src])

  if (error) return null
  if (!image) return null

  return (
    <Group listening={false}>
      {/* Solid background to ensure visibility */}
      <Rect width={width} height={height} fill="white" />
      <KonvaImage
        image={image}
        width={width}
        height={height}
        opacity={0.8}
      />
    </Group>
  )
}

// Grid Component with viewport culling for performance
// Only renders grid lines that are potentially visible
const GridLayer = React.memo(({ width, height, gridSize, showGrid, scale, stagePos }) => {
  if (!showGrid) return null

  // Calculate visible viewport bounds
  const visibleArea = useMemo(() => {
    const padding = 100 // Extra padding to avoid pop-in
    return {
      minX: Math.max(0, -stagePos.x / scale - padding),
      maxX: Math.min(width, (-stagePos.x + window.innerWidth) / scale + padding),
      minY: Math.max(0, -stagePos.y / scale - padding),
      maxY: Math.min(height, (-stagePos.y + window.innerHeight) / scale + padding),
    }
  }, [width, height, scale, stagePos])

  // Only generate grid lines within visible viewport
  const verticalLines = useMemo(() => {
    const lines = []
    const startX = Math.floor(visibleArea.minX / gridSize) * gridSize
    const endX = Math.ceil(visibleArea.maxX / gridSize) * gridSize

    for (let x = startX; x <= endX; x += gridSize) {
      lines.push(
        <Rect
          key={`v-${x}`}
          x={x}
          y={0}
          width={1}
          height={height}
          fill="#e2e8f0"
          listening={false}
        />
      )
    }
    return lines
  }, [visibleArea, gridSize, height])

  const horizontalLines = useMemo(() => {
    const lines = []
    const startY = Math.floor(visibleArea.minY / gridSize) * gridSize
    const endY = Math.ceil(visibleArea.maxY / gridSize) * gridSize

    for (let y = startY; y <= endY; y += gridSize) {
      lines.push(
        <Rect
          key={`h-${y}`}
          x={0}
          y={y}
          width={width}
          height={1}
          fill="#e2e8f0"
          listening={false}
        />
      )
    }
    return lines
  }, [visibleArea, gridSize, width])

  return (
    <>
      {verticalLines}
      {horizontalLines}
    </>
  )
})

// Table Component
const TableShape = React.memo(({ table, isSelected, onSelect, onDragStart, onDragEnd, guestMap, onSeatClick, onSeatDragEnd }) => {
  const tableGuests = useMemo(() => (table.seats || [])
    .filter(seat => seat.guest_id)
    .map(seat => guestMap?.[seat.guest_id])
    .filter(Boolean), [table.seats, guestMap])

  const checkedInCount = tableGuests.filter(g => g?.checked_in).length

  return (
    <Group
      x={table.position.x}
      y={table.position.y}
      rotation={table.rotation}
      draggable
      onDragStart={(e) => {
        e.cancelBubble = true
        onDragStart?.(table.id)
      }}
      onDragEnd={(e) => {
        // Only handle if the dragged object is the Group containing the Table
        if (e.target instanceof Konva.Group) {
          const node = e.target;
          const newPos = {
            x: Math.round(node.x() / GRID_SIZE) * GRID_SIZE,
            y: Math.round(node.y() / GRID_SIZE) * GRID_SIZE,
          };
          
          // Lock position to Grid immediately
          node.position(newPos);
          onDragEnd(table.id, newPos);
        }
      }}
      onClick={() => onSelect(table.id)}
      onTap={() => onSelect(table.id)}
    >
      {/* Table shape */}
      {table.shape === 'round' ? (
        <Circle
          radius={table.width / 2}
          fill={isSelected ? '#4299e1' : '#90cdf4'}
          stroke={isSelected ? '#2c5282' : '#2b6cb0'}
          strokeWidth={3}
        />
      ) : (
        <Rect
          width={table.width}
          height={table.height}
          offsetX={table.width / 2}
          offsetY={table.height / 2}
          fill={isSelected ? '#4299e1' : '#90cdf4'}
          stroke={isSelected ? '#2c5282' : '#2b6cb0'}
          strokeWidth={3}
          cornerRadius={8}
        />
      )}

      {/* Table label */}
      <KonvaText
        text={`T${table.id.slice(-4)}`}
        fontSize={14}
        fontStyle="bold"
        fill="#ffffff"
        align="center"
        verticalAlign="middle"
        width={table.shape === 'round' ? table.width : table.width}
        offsetX={table.shape === 'round' ? table.width / 2 : table.width / 2}
        offsetY={10}
      />

      {/* Occupancy indicator */}
      {(table.seats || []).length > 0 && (
        <KonvaText
          text={`${checkedInCount}/${(table.seats || []).length}`}
          fontSize={12}
          fill="#ffffff"
          align="center"
          width={table.shape === 'round' ? table.width : table.width}
          offsetX={table.shape === 'round' ? table.width / 2 : table.width / 2}
          offsetY={-5}
        />
      )}

      {/* Seats */}
      {(table.seats || []).map((seat) => {
        const guest = guestMap?.[seat.guest_id]
        const seatColor = guest?.checked_in ? '#48bb78' : seat.guest_id ? '#ed8936' : '#718096'
        
        return (
          <Group
            key={seat.id}
            x={seat.position.x}
            y={seat.position.y}
            draggable
            onClick={(e) => {
              e.cancelBubble = true; // Prevent table selection
              onSeatClick(table, seat);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              onSeatClick(table, seat);
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              onDragStart?.(table.id)
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              onSeatDragEnd(table.id, seat.id, {
                x: e.target.x(),
                y: e.target.y()
              });
            }}
            onMouseEnter={e => {
              const container = e.target.getStage().container();
              container.style.cursor = 'move';
            }}
            onMouseLeave={e => {
              const container = e.target.getStage().container();
              container.style.cursor = 'default';
            }}
          >
            {/* Hit Area - Larger transparent circle for easier clicking/dragging */}
            <Circle
              radius={30}
              fill="transparent"
            />
            {/* Visible Seat */}
            <Circle
              radius={14}
              fill={seatColor}
              stroke="#ffffff"
              strokeWidth={2}
            />
          </Group>
        )
      })}
    </Group>
  )
})



export default function LayoutBuilder() {
  const { eventId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const stageRef = useRef()
  const [selectedTableId, setSelectedTableId] = useState(null)
  const [showGrid, setShowGrid] = useState(true)
  const [scale, setScale] = useState(0.5)
  const isDraggingRef = useRef(false)
  
  // New table configuration
  const [newTable, setNewTable] = useState({
    shape: 'round',
    width: 120,
    height: 120,
    numSeats: 8,
  })

  const { isOpen: isAssignOpen, onOpen: onAssignOpen, onClose: onAssignClose } = useDisclosure()
  const { isOpen: isToolsOpen, onOpen: onToolsOpen, onClose: onToolsClose } = useDisclosure()
  const isMobile = useBreakpointValue({ base: true, lg: false })
  const isTablet = useBreakpointValue({ base: false, md: true, lg: false })

  // Get responsive canvas dimensions
  const canvasDimensions = useMemo(() =>
    getCanvasDimensions(isMobile, isTablet),
    [isMobile, isTablet]
  )
  const CANVAS_WIDTH = canvasDimensions.width
  const CANVAS_HEIGHT = canvasDimensions.height

  const [selectedSeat, setSelectedSeat] = useState(null)
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })

  const handleResetView = () => {
    setScale(0.5)
    setStagePos({ x: 0, y: 0 })
    if (stageRef.current) {
      stageRef.current.position({ x: 0, y: 0 })
      stageRef.current.batchDraw()
    }
  }
  const [selectedGuestId, setSelectedGuestId] = useState('')
  const socket = useSocket(eventId)

  // Fetch layout
  const { data: layoutData, isLoading } = useQuery({
    queryKey: ['layout', eventId],
    queryFn: async () => {
      const response = await layoutAPI.get(eventId)
      return response.data
    },
  })

  // Fetch guests for seat assignment
  const { data: guests = [] } = useQuery({
    queryKey: ['guests', eventId],
    queryFn: async () => {
      const response = await guestsAPI.list(eventId, {})
      return response.data
    },
  })

  // Optimize guest lookup
  const guestMap = useMemo(() => {
    return (guests || []).reduce((acc, guest) => {
      acc[guest.id] = guest
      return acc
    }, {})
  }, [guests])

  const [tables, setTables] = useState([])
  const [floorPlanUrl, setFloorPlanUrl] = useState(null)

  useEffect(() => {
    if (isDraggingRef.current) return // Don't sync from server while dragging

    if (layoutData?.tables) {
      setTables(layoutData.tables)
    }
    if (layoutData?.floor_plan_url) {
      setFloorPlanUrl(layoutData.floor_plan_url)
    }
  }, [layoutData])

  // Real-time updates
  useEffect(() => {
    if (!socket) return

    socket.on('layout_changed', () => {
      if (!isDraggingRef.current) {
        queryClient.invalidateQueries(['layout', eventId])
      }
    })

    socket.on('seat_assigned', () => {
      if (!isDraggingRef.current) {
        queryClient.invalidateQueries(['layout', eventId])
        queryClient.invalidateQueries(['guests', eventId])
      }
    })

    socket.on('seat_unassigned', () => {
      if (!isDraggingRef.current) {
        queryClient.invalidateQueries(['layout', eventId])
        queryClient.invalidateQueries(['guests', eventId])
      }
    })

    socket.on('guest_updated', () => {
      queryClient.invalidateQueries(['guests', eventId])
    })

    socket.on('guest_deleted', () => {
      queryClient.invalidateQueries(['guests', eventId])
      queryClient.invalidateQueries(['layout', eventId]) // In case they were seated
    })

    return () => {
      socket.off('layout_changed')
      socket.off('seat_assigned')
      socket.off('seat_unassigned')
      socket.off('guest_updated')
      socket.off('guest_deleted')
    }
  }, [socket, queryClient, eventId])

  // Handle floor plan upload
  const handleFloorPlanUpload = (event) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setFloorPlanUrl(e.target.result)
      }
      reader.readAsDataURL(file)
    }
  }

  // Save layout mutation
  const saveLayoutMutation = useMutation({
    mutationFn: (layoutData) => layoutAPI.update(eventId, layoutData),
    onSuccess: () => {
      queryClient.invalidateQueries(['layout', eventId])
      // toast.success('Layout saved successfully') // Optional: suppress for autosave?
    },
  })

  // Debounced auto-save
  const saveTimeoutRef = useRef(null)
  
  const triggerAutoSave = useCallback((updatedTables) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      saveLayoutMutation.mutate({
        tables: updatedTables,
        floor_plan_url: floorPlanUrl,
        config: {
          grid_size: GRID_SIZE,
          snap_to_grid: true,
          canvas_width: CANVAS_WIDTH,
          canvas_height: CANVAS_HEIGHT,
          show_grid: showGrid,
        },
      })
    }, 1000)
  }, [saveLayoutMutation, floorPlanUrl, showGrid])

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true
  }, [])

  const handleTableDragEnd = useCallback((tableId, newPosition) => {
    isDraggingRef.current = false
    setTables(prev => {
      const newTables = prev.map(t => 
        t.id === tableId ? { ...t, position: newPosition } : t
      )
      triggerAutoSave(newTables)
      return newTables
    })
  }, [triggerAutoSave])

  const handleSeatDragEnd = useCallback((tableId, seatId, newPosition) => {
    setTables(prev => {
      const newTables = prev.map(t => {
        if (t.id !== tableId) return t
        return {
          ...t,
          seats: t.seats.map(s => 
            s.id === seatId ? { ...s, position: newPosition } : s
          )
        }
      })
      triggerAutoSave(newTables)
      return newTables
    })
  }, [triggerAutoSave])

  // Handle rotation change
  const handleRotationChange = (value) => {
    if (selectedTableId) {
      setTables(prev => {
        const newTables = prev.map(t => 
          t.id === selectedTableId ? { ...t, rotation: value } : t
        )
        triggerAutoSave(newTables)
        return newTables
      })
    }
  }

  // Add table mutation
  const addTableMutation = useMutation({
    mutationFn: (tableData) => layoutAPI.addTable(eventId, tableData),
    onSuccess: (response) => {
      setTables(prev => [...prev, response.data])
      toast.success('Table added')
    },
    onError: (error) => {
      console.error('Failed to add table:', error)
      toast.error('Failed to add table. Please try again.')
    }
  })

  // Delete table
  const deleteTableMutation = useMutation({
    mutationFn: (tableId) => layoutAPI.deleteTable(eventId, tableId),
    onSuccess: () => {
      setTables(prev => prev.filter(t => t.id !== selectedTableId))
      setSelectedTableId(null)
      queryClient.invalidateQueries(['guests', eventId])
      queryClient.invalidateQueries(['layout', eventId])
      toast.success('Table deleted')
    },
  })

  // Assign seat mutation
  const assignSeatMutation = useMutation({
    mutationFn: (data) => layoutAPI.assignSeat(eventId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['layout', eventId])
      queryClient.invalidateQueries(['guests', eventId])
      onAssignClose()
      setSelectedSeat(null)
      setSelectedGuestId('')
      toast.success('Guest assigned to seat')
    },
    onError: (error) => {
      toast.error(error.response?.data?.detail || 'Failed to assign seat')
    }
  })

  // Unassign seat mutation
  const unassignSeatMutation = useMutation({
    mutationFn: (data) => layoutAPI.unassignSeat(eventId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['layout', eventId])
      queryClient.invalidateQueries(['guests', eventId])
      onAssignClose()
      setSelectedSeat(null)
      setSelectedGuestId('')
      toast.success('Guest unassigned from seat')
    },
    onError: (error) => {
      toast.error(error.response?.data?.detail || 'Failed to unassign seat')
    }
  })

  const handleAddTable = () => {
    const stage = stageRef.current;
    if (!stage) return;

    // Get current mouse position OR center of screen
    const pointerPos = stage.getPointerPosition() || {
      x: stage.container().offsetWidth / 2,
      y: stage.container().offsetHeight / 2
    };

    // CRITICAL: Convert Viewport coordinates to Canvas coordinates
    // Formula: x_rel = (x_pointer - x_stage) / scale
    const mousePointTo = {
      x: (pointerPos.x - stage.x()) / stage.scaleX(),
      y: (pointerPos.y - stage.y()) / stage.scaleY(),
    };

    const x = Math.round(mousePointTo.x / GRID_SIZE) * GRID_SIZE;
    const y = Math.round(mousePointTo.y / GRID_SIZE) * GRID_SIZE;

    const tableData = {
      shape: newTable.shape,
      position: { x, y },
      width: newTable.width,
      height: newTable.height,
      num_seats: newTable.numSeats,
      rotation: 0,
    }
    addTableMutation.mutate(tableData)
  }

  const handleSaveLayout = () => {
    saveLayoutMutation.mutate({
      tables: tables,
      floor_plan_url: floorPlanUrl,
      config: {
        grid_size: GRID_SIZE,
        snap_to_grid: true,
        canvas_width: CANVAS_WIDTH,
        canvas_height: CANVAS_HEIGHT,
        show_grid: showGrid,
      },
    })
  }

  const handleDeleteTable = () => {
    if (selectedTableId) {
      deleteTableMutation.mutate(selectedTableId)
    }
  }

  const handleDuplicateTable = () => {
    if (!selectedTable) return

    const offset = GRID_SIZE
    const newPos = {
      x: selectedTable.position.x + offset,
      y: selectedTable.position.y + offset
    }

    const tableData = {
      shape: selectedTable.shape,
      position: newPos,
      width: selectedTable.width,
      height: selectedTable.height,
      num_seats: selectedTable.seats.length,
      rotation: selectedTable.rotation,
    }

    addTableMutation.mutate(tableData)
  }

  const handleSeatClick = (table, seat) => {
    setSelectedSeat({ table, seat })
    // If seat has a guest, pre-select them (optional, but good UX)
    setSelectedGuestId(seat.guest_id || '')
    onAssignOpen()
  }

  const handleAssignSeat = () => {
    if (!selectedSeat || !selectedGuestId) return

    assignSeatMutation.mutate({
      table_id: selectedSeat.table.id,
      seat_id: selectedSeat.seat.id,
      guest_id: selectedGuestId
    })
  }

  const handleUnassignSeat = () => {
    if (!selectedSeat) return

    unassignSeatMutation.mutate({
      table_id: selectedSeat.table.id,
      seat_id: selectedSeat.seat.id,
      guest_id: selectedSeat.seat.guest_id
    })
  }

  const handleExportLayout = () => {
    if (!stageRef.current) return

    // Deselect table before export to avoid selection artifacts
    setSelectedTableId(null)
    
    // Use setTimeout to allow state update to reflect (deselection)
    setTimeout(() => {
      try {
        const dataURL = stageRef.current.toDataURL({
          pixelRatio: 2, // Higher resolution
          mimeType: 'image/png',
        })
        
        const link = document.createElement('a')
        link.download = `layout-${eventId}-${new Date().toISOString().split('T')[0]}.png`
        link.href = dataURL
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        toast.success('Layout exported successfully')
      } catch (error) {
        console.error('Export failed:', error)
        toast.error('Failed to export layout')
      }
    }, 100)
  }

  const selectedTable = tables.find(t => t.id === selectedTableId)

  if (isLoading) {
    return <Box>Loading...</Box>
  }

  const sidebarContent = (
    <VStack spacing={6} align="stretch">
      <Box>
        <Heading size="sm" mb={4}>Add Table</Heading>
        
        <VStack spacing={3}>
          <FormControl>
            <FormLabel fontSize="sm">Shape</FormLabel>
            <HStack>
              <Button
                leftIcon={<FiCircle />}
                size="sm"
                flex={1}
                colorScheme={newTable.shape === 'round' ? 'brand' : 'gray'}
                onClick={() => setNewTable(prev => ({ ...prev, shape: 'round' }))}
              >
                Round
              </Button>
              <Button
                leftIcon={<FiSquare />}
                size="sm"
                flex={1}
                colorScheme={newTable.shape === 'rectangular' ? 'brand' : 'gray'}
                onClick={() => setNewTable(prev => ({ ...prev, shape: 'rectangular' }))}
              >
                Rectangular
              </Button>
            </HStack>
          </FormControl>

          <FormControl>
            <FormLabel fontSize="sm">
              {newTable.shape === 'round' ? 'Diameter' : 'Width'}
            </FormLabel>
            <NumberInput
              value={newTable.width}
              onChange={(_, val) => setNewTable(prev => ({ ...prev, width: val }))}
              min={60}
              max={300}
              step={10}
            >
              <NumberInputField />
              <NumberInputStepper>
                <NumberIncrementStepper />
                <NumberDecrementStepper />
              </NumberInputStepper>
            </NumberInput>
          </FormControl>

          {newTable.shape === 'rectangular' && (
            <FormControl>
              <FormLabel fontSize="sm">Height</FormLabel>
              <NumberInput
                value={newTable.height}
                onChange={(_, val) => setNewTable(prev => ({ ...prev, height: val }))}
                min={60}
                max={300}
                step={10}
              >
                <NumberInputField />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
            </FormControl>
          )}

          <FormControl>
            <FormLabel fontSize="sm">Number of Seats</FormLabel>
            <NumberInput
              value={newTable.numSeats}
              onChange={(_, val) => setNewTable(prev => ({ ...prev, numSeats: val }))}
              min={2}
              max={20}
            >
              <NumberInputField />
              <NumberInputStepper>
                <NumberIncrementStepper />
                <NumberDecrementStepper />
              </NumberInputStepper>
            </NumberInput>
          </FormControl>

          <Button
            leftIcon={<FiPlus />}
            colorScheme="brand"
            size="sm"
            onClick={handleAddTable}
            isLoading={addTableMutation.isPending}
          >
            Add Table
          </Button>
        </VStack>
      </Box>

      {selectedTable && (
        <Box pt={4} borderTop="1px" borderColor="gray.200">
          <Heading size="sm" mb={4}>Selected Table</Heading>
          <VStack spacing={3}>
            <Text fontSize="sm">
              Shape: <strong>{selectedTable.shape}</strong>
            </Text>
            <Text fontSize="sm">
              Seats: <strong>{selectedTable.seats.length}</strong>
            </Text>
            <Text fontSize="sm">
              Assigned: <strong>
                {selectedTable.seats.filter(s => s.guest_id).length}
              </strong>
            </Text>
            
            <FormControl>
              <FormLabel fontSize="sm" display="flex" alignItems="center">
                <Box as={FiRotateCw} mr={2} /> Rotation: {Math.round(selectedTable.rotation || 0)}°
              </FormLabel>
              <Slider
                aria-label="rotation-slider"
                value={selectedTable.rotation || 0}
                min={0}
                max={360}
                onChange={handleRotationChange}
              >
                <SliderTrack>
                  <SliderFilledTrack />
                </SliderTrack>
                <SliderThumb />
              </Slider>
            </FormControl>

            <Button
              leftIcon={<FiCopy />}
              size="sm"
              w="full"
              onClick={handleDuplicateTable}
              isLoading={addTableMutation.isPending}
            >
              Duplicate Table
            </Button>

            <Button
              leftIcon={<FiTrash2 />}
              colorScheme="red"
              size="sm"
              w="full"
              onClick={handleDeleteTable}
              isLoading={deleteTableMutation.isPending}
            >
              Delete Table
            </Button>
          </VStack>
        </Box>
      )}

      <Box pt={4} borderTop="1px" borderColor="gray.200">
        <Heading size="sm" mb={3}>Floor Plan</Heading>
        <VStack spacing={3}>
          <FormControl>
            <FormLabel
              htmlFor="floor-plan-upload"
              m={0}
              p={2}
              border="1px dashed"
              borderColor="gray.300"
              borderRadius="md"
              cursor="pointer"
              _hover={{ bg: 'gray.50' }}
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              <HStack>
                <FiImage />
                <Text fontSize="sm">Upload Background</Text>
              </HStack>
            </FormLabel>
            <Input
              id="floor-plan-upload"
              type="file"
              accept="image/*"
              display="none"
              onChange={handleFloorPlanUpload}
            />
          </FormControl>
          {floorPlanUrl && (
            <Button
              size="sm"
              variant="outline"
              colorScheme="red"
              width="full"
              onClick={() => setFloorPlanUrl(null)}
            >
              Remove Background
            </Button>
          )}
        </VStack>
      </Box>

      <Box pt={4} borderTop="1px" borderColor="gray.200">
        <Heading size="sm" mb={3}>Legend</Heading>
        <VStack spacing={2} align="stretch" fontSize="sm">
          <HStack>
            <Box w="16px" h="16px" borderRadius="full" bg="#718096" />
            <Text>Empty Seat</Text>
          </HStack>
          <HStack>
            <Box w="16px" h="16px" borderRadius="full" bg="#ed8936" />
            <Text>Assigned</Text>
          </HStack>
          <HStack>
            <Box w="16px" h="16px" borderRadius="full" bg="#48bb78" />
            <Text>Checked In</Text>
          </HStack>
        </VStack>
      </Box>
    </VStack>
  )

  return (
    <Box>
      <Button
        leftIcon={<FiArrowLeft />}
        variant="ghost"
        mb={4}
        onClick={() => navigate(`/admin/events/${eventId}`)}
      >
        Back to Event
      </Button>

      <Flex justify="space-between" align="center" mb={6}>
        <HStack>
          {isMobile && (
            <IconButton
              icon={<FiTool />}
              onClick={onToolsOpen}
              aria-label="Open Tools"
              variant="outline"
              mr={2}
            />
          )}
          <Heading size="lg">Layout Builder</Heading>
        </HStack>
        <HStack>
          <Button
            leftIcon={<FiGrid />}
            variant={showGrid ? 'solid' : 'outline'}
            onClick={() => setShowGrid(!showGrid)}
          >
            Grid
          </Button>
          <Button
            leftIcon={<FiDownload />}
            variant="outline"
            onClick={handleExportLayout}
          >
            Export
          </Button>
          <Button
            leftIcon={<FiSave />}
            colorScheme="brand"
            onClick={handleSaveLayout}
            isLoading={saveLayoutMutation.isPending}
          >
            Save Layout
          </Button>
        </HStack>
      </Flex>

      <Flex gap={6}>
        {/* Sidebar - Desktop */}
        {!isMobile && (
          <Card minW="300px" maxW="300px" h="fit-content">
            <CardBody>
              {sidebarContent}
            </CardBody>
          </Card>
        )}

        {/* Sidebar - Mobile Drawer */}
        <Drawer isOpen={isToolsOpen} placement="left" onClose={onToolsClose} size="xs">
          <DrawerOverlay />
          <DrawerContent>
            <DrawerCloseButton />
            <DrawerBody pt={8}>
              {sidebarContent}
            </DrawerBody>
          </DrawerContent>
        </Drawer>

        {/* Canvas */}
        <Card flex={1} overflow="hidden">
          <CardBody p={0} position="relative">
            <Box
              w="100%"
              h={{ base: '400px', md: '500px', lg: '600px' }}
              overflow="hidden"
              bg="gray.50"
              position="relative"
            >
              {/* Save Status Indicator */}
              {(saveLayoutMutation.isPending || addTableMutation.isPending || deleteTableMutation.isPending) && (
                <Box
                  position="absolute"
                  top={4}
                  right={4}
                  bg="white"
                  px={3}
                  py={1}
                  borderRadius="md"
                  boxShadow="md"
                  zIndex={10}
                >
                  <HStack spacing={2}>
                    <Spinner size="xs" color="brand.500" />
                    <Text fontSize="xs" fontWeight="bold" color="gray.600">
                      Saving...
                    </Text>
                  </HStack>
                </Box>
              )}
              <Stage
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                scaleX={scale}
                scaleY={scale}
                x={stagePos.x}
                y={stagePos.y}
                ref={stageRef}
                draggable
                onDragEnd={(e) => {
                  setStagePos({ x: e.target.x(), y: e.target.y() })
                }}
              >
                <Layer>
                  {/* Background Image - Hide on mobile */}
                  {!isMobile && (
                    <BackgroundImage src={floorPlanUrl} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
                  )}

                  {/* Grid - with viewport culling for performance */}
                  <GridLayer
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    gridSize={GRID_SIZE}
                    showGrid={showGrid}
                    scale={scale}
                    stagePos={stagePos}
                  />

                  {/* Tables */}
                  {tables.map((table) => (
                    <TableShape
                      key={table.id}
                      table={table}
                      isSelected={table.id === selectedTableId}
                      onSelect={setSelectedTableId}
                      onDragStart={handleDragStart}
                      onDragEnd={handleTableDragEnd}
                      guestMap={guestMap}
                      onSeatClick={handleSeatClick}
                      onSeatDragEnd={handleSeatDragEnd}
                    />
                  ))}
                </Layer>
              </Stage>

              {/* Floating Navigation Controls */}
              <CanvasControls
                scale={scale}
                setScale={setScale}
                onReset={handleResetView}
              />
            </Box>
          </CardBody>
        </Card>
      </Flex>

      {/* Seat Assignment Modal */}
      <Modal isOpen={isAssignOpen} onClose={onAssignClose} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Assign Guest to Seat</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text mb={4}>Select a guest to assign to this seat:</Text>
            <Select 
              placeholder="Select guest"
              value={selectedGuestId}
              onChange={(e) => setSelectedGuestId(e.target.value)}
            >
              {guests
                .filter(g => !g.table_id || g.id === selectedGuestId) // Show unassigned guests + currently assigned guest
                .map(guest => (
                  <option key={guest.id} value={guest.id}>
                    {guest.full_name} - {guest.phone}
                  </option>
                ))}
            </Select>
          </ModalBody>
          <ModalFooter>
            {selectedSeat?.seat?.guest_id && (
              <Button 
                colorScheme="red" 
                variant="outline" 
                mr="auto"
                onClick={handleUnassignSeat}
                isLoading={unassignSeatMutation.isPending}
              >
                Unassign
              </Button>
            )}
            <Button variant="ghost" mr={3} onClick={onAssignClose}>
              Cancel
            </Button>
            <Button 
              colorScheme="brand" 
              onClick={handleAssignSeat}
              isLoading={assignSeatMutation.isPending}
              isDisabled={!selectedGuestId}
            >
              Assign
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}
