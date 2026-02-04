import { useState, useEffect, useRef, useMemo, memo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Stage, Layer, Circle, Rect, Group, Text as KonvaText } from 'react-konva'
import CanvasControls from '../shared/CanvasControls'
import {
  Box,
  Button,
  Flex,
  Heading,
  Input,
  InputGroup,
  InputLeftElement,
  VStack,
  HStack,
  Card,
  CardBody,
  Text,
  Badge,
  Avatar,
  Divider,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Stat,
  StatLabel,
  StatNumber,
  SimpleGrid,
  useBreakpointValue,
} from '@chakra-ui/react'
import { FiSearch, FiArrowLeft, FiCheck, FiX, FiLogOut } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { layoutAPI, guestsAPI, reportsAPI } from '../../services/api'
import { useSocket } from '../../hooks/useSocket'

// Canvas dimensions - responsive based on device
const getCanvasDimensions = (isMobile, isTablet) => {
  if (isMobile) return { width: 800, height: 600 }
  if (isTablet) return { width: 1200, height: 900 }
  return { width: 2000, height: 1500 }
}

// Seat Component with click handler - optimized for mobile
const SeatShape = memo(({ seat, table, guest, onClick, isMobile }) => {
  const getColor = () => {
    if (!guest) return '#cbd5e0' // Gray - unassigned
    if (guest.checked_in) return '#48bb78' // Green - checked in
    return '#3182ce' // Blue - assigned but not checked in
  }

  return (
    <Group
      x={seat.position.x}
      y={seat.position.y}
      onClick={() => onClick && onClick(seat, table, guest)}
      onTap={() => onClick && onClick(seat, table, guest)}
    >
      {/* Hit Area - Larger transparent circle for easier interaction */}
      <Circle
        radius={30}
        fill="transparent"
      />
      {/* Visible Seat - shadow disabled on mobile for performance */}
      <Circle
        radius={14}
        fill={getColor()}
        stroke="#ffffff"
        strokeWidth={2}
        shadowBlur={!isMobile && guest ? 5 : 0}
        shadowColor="black"
        shadowOpacity={0.3}
      />
    </Group>
  )
})

// Table Component for display - memoized for performance
const TableDisplay = memo(({ table, guests, onSeatClick, isMobile }) => {
  return (
    <Group
      x={table.position.x}
      y={table.position.y}
      rotation={table.rotation}
    >
      {/* Table shape */}
      {table.shape === 'round' ? (
        <Circle
          radius={table.width / 2}
          fill="#bee3f8"
          stroke="#2b6cb0"
          strokeWidth={2}
        />
      ) : (
        <Rect
          width={table.width}
          height={table.height}
          offsetX={table.width / 2}
          offsetY={table.height / 2}
          fill="#bee3f8"
          stroke="#2b6cb0"
          strokeWidth={2}
          cornerRadius={8}
        />
      )}

      {/* Table label */}
      <KonvaText
        text={`T${table.id.slice(-4)}`}
        fontSize={16}
        fontStyle="bold"
        fill="#2c5282"
        align="center"
        verticalAlign="middle"
        width={table.width}
        offsetX={table.width / 2}
        offsetY={8}
      />

      {/* Seats */}
      {table.seats.map((seat) => {
        const guest = guests?.find(g => g.id === seat.guest_id)
        return (
          <SeatShape
            key={seat.id}
            seat={seat}
            table={table}
            guest={guest}
            onClick={onSeatClick}
            isMobile={isMobile}
          />
        )
      })}
    </Group>
  )
})

export default function CheckInView() {
  const { eventId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const socket = useSocket(eventId)

  // Responsive breakpoints
  const isMobile = useBreakpointValue({ base: true, lg: false })
  const isTablet = useBreakpointValue({ base: false, md: true, lg: false })

  // Get responsive canvas dimensions
  const canvasDimensions = useMemo(() =>
    getCanvasDimensions(isMobile, isTablet),
    [isMobile, isTablet]
  )
  const CANVAS_WIDTH = canvasDimensions.width
  const CANVAS_HEIGHT = canvasDimensions.height

  const [search, setSearch] = useState('')
  const [selectedGuest, setSelectedGuest] = useState(null)
  const [scale, setScale] = useState(isMobile ? 0.5 : 0.4)
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })
  const stageRef = useRef(null)
  const { isOpen, onOpen, onClose } = useDisclosure()

  const handleResetView = () => {
    const defaultScale = isMobile ? 0.5 : 0.4
    setScale(defaultScale)
    setStagePos({ x: 0, y: 0 })
    if (stageRef.current) {
      stageRef.current.position({ x: 0, y: 0 })
      stageRef.current.batchDraw()
    }
  }

  // Fetch layout
  const { data: layoutData } = useQuery({
    queryKey: ['layout', eventId],
    queryFn: async () => {
      const response = await layoutAPI.get(eventId)
      return response.data
    },
  })

  // Fetch guests
  const { data: guests = [], refetch: refetchGuests } = useQuery({
    queryKey: ['guests', eventId, search],
    queryFn: async () => {
      const params = search ? { search } : {}
      const response = await guestsAPI.list(eventId, params)
      return response.data
    },
  })

  // Fetch summary stats
  const { data: summary, refetch: refetchSummary } = useQuery({
    queryKey: ['summary', eventId],
    queryFn: async () => {
      const response = await reportsAPI.attendance(eventId)
      return response.data
    },
    refetchInterval: 30000, // Refresh every 30s
  })

  // Check-in mutation
  const checkInMutation = useMutation({
    mutationFn: (guestId) => guestsAPI.checkIn(eventId, guestId),
    onSuccess: (response) => {
      toast.success(`${response.data.guest.full_name} checked in!`)
      refetchGuests()
      refetchSummary()
      onClose()
    },
  })

  // Check-out mutation
  const checkOutMutation = useMutation({
    mutationFn: (guestId) => guestsAPI.checkOut(eventId, guestId),
    onSuccess: (response) => {
      toast.success(`${response.data.guest.full_name} checked out`)
      refetchGuests()
      refetchSummary()
      onClose()
    },
  })

  // Real-time updates
    useEffect(() => {
      if (!socket) return

      socket.on('guest_checked_in', (data) => {
        console.log('Guest checked in:', data)
        
        // Optimistic update for guests list (immediate UI feedback)
        queryClient.setQueriesData({ queryKey: ['guests', eventId] }, (oldGuests) => {
          if (!oldGuests) return oldGuests
          return oldGuests.map(g => 
            g.id === data.guest.id ? { ...g, ...data.guest } : g
          )
        })

        refetchSummary()
        toast.success(`${data.guest.full_name} checked in (real-time)`, {
          icon: '✅',
        })
      })

      socket.on('guest_checked_out', (data) => {
        console.log('Guest checked out:', data)
        
        // Optimistic update for guests list
        queryClient.setQueriesData({ queryKey: ['guests', eventId] }, (oldGuests) => {
          if (!oldGuests) return oldGuests
          return oldGuests.map(g => 
            g.id === data.guest.id ? { ...g, ...data.guest } : g
          )
        })

        refetchSummary()
      })

    socket.on('seat_unassigned', (data) => {
      console.log('Seat unassigned:', data)
      refetchGuests()
      refetchSummary()
    })

    socket.on('layout_changed', () => {
      queryClient.invalidateQueries(['layout', eventId])
    })

    return () => {
      socket.off('guest_checked_in')
      socket.off('guest_checked_out')
      socket.off('seat_unassigned')
      socket.off('layout_changed')
    }
  }, [socket, refetchGuests, refetchSummary])

  const getTableLabel = (tableId) => {
    if (!layoutData?.tables) return tableId?.slice(-4)
    const table = layoutData.tables.find(t => t.id === tableId)
    // Check for common name properties or fallback to ID
    return table?.label || table?.name || table?.table_number || tableId?.slice(-4)
  }

  const handleSeatClick = (seat, table, guest) => {
    if (guest) {
      setSelectedGuest(guest)
      onOpen()
    }
  }

  const handleGuestClick = (guest) => {
    setSelectedGuest(guest)
    onOpen()
  }

  const handleCheckIn = () => {
    if (selectedGuest && !selectedGuest.checked_in) {
      checkInMutation.mutate(selectedGuest.id)
    }
  }

  const handleCheckOut = () => {
    if (selectedGuest && selectedGuest.checked_in) {
      checkOutMutation.mutate(selectedGuest.id)
    }
  }

  return (
    <Box>
      <Button
        leftIcon={<FiArrowLeft />}
        variant="ghost"
        mb={4}
        onClick={() => navigate('/staff/events')}
      >
        Back to Events
      </Button>

      <Flex justify="space-between" align="center" mb={6}>
        <Heading size="lg">Check-in</Heading>
      </Flex>

      {/* Stats Overview */}
      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={{ base: 2, md: 4 }} mb={6}>
        <Card>
          <CardBody p={{ base: 2, md: 4 }}>
            <Stat size={{ base: "sm", md: "md" }}>
              <StatLabel fontSize={{ base: "xs", md: "sm" }}>Total</StatLabel>
              <StatNumber fontSize={{ base: "lg", md: "2xl" }}>{summary?.total_guests || 0}</StatNumber>
            </Stat>
          </CardBody>
        </Card>
        <Card>
          <CardBody p={{ base: 2, md: 4 }}>
            <Stat size={{ base: "sm", md: "md" }}>
              <StatLabel fontSize={{ base: "xs", md: "sm" }}>Checked In</StatLabel>
              <StatNumber fontSize={{ base: "lg", md: "2xl" }} color="green.500">
                {summary?.checked_in_count || 0}
              </StatNumber>
            </Stat>
          </CardBody>
        </Card>
        <Card>
          <CardBody p={{ base: 2, md: 4 }}>
            <Stat size={{ base: "sm", md: "md" }}>
              <StatLabel fontSize={{ base: "xs", md: "sm" }}>Checked Out</StatLabel>
              <StatNumber fontSize={{ base: "lg", md: "2xl" }} color="orange.500">
                {summary?.checked_out_count || 0}
              </StatNumber>
            </Stat>
          </CardBody>
        </Card>
        <Card>
          <CardBody p={{ base: 2, md: 4 }}>
            <Stat size={{ base: "sm", md: "md" }}>
              <StatLabel fontSize={{ base: "xs", md: "sm" }}>Pending</StatLabel>
              <StatNumber fontSize={{ base: "lg", md: "2xl" }} color="gray.500">
                {summary?.pending_count ?? summary?.not_checked_in_count ?? 0}
              </StatNumber>
            </Stat>
          </CardBody>
        </Card>
      </SimpleGrid>

      <Flex gap={6} direction={{ base: 'column', lg: 'row' }}>
        {/* Guest Search */}
        <Card 
          w={{ base: '100%', lg: '350px' }} 
          maxH="calc(100vh - 300px)" 
          overflow="hidden"
        >
          <CardBody display="flex" flexDirection="column">
            <Heading size="sm" mb={4}>Guest Search</Heading>
            
            <InputGroup mb={4}>
              <InputLeftElement>
                <FiSearch color="gray.300" />
              </InputLeftElement>
              <Input
                placeholder="Search by name or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>

            <VStack
              spacing={2}
              align="stretch"
              overflow="auto"
              flex={1}
              css={{
                '&::-webkit-scrollbar': {
                  width: '8px',
                },
                '&::-webkit-scrollbar-track': {
                  background: '#edf2f7',
                  borderRadius: '4px',
                },
                '&::-webkit-scrollbar-thumb': {
                  background: '#718096',
                  borderRadius: '4px',
                },
                '&::-webkit-scrollbar-thumb:hover': {
                  background: '#4a5568',
                },
              }}
            >
              {guests.length === 0 ? (
                <Text color="gray.500" textAlign="center" py={4}>
                  No guests found
                </Text>
              ) : (
                guests.map((guest) => (
                  <Card
                    key={guest.id}
                    size="sm"
                    cursor="pointer"
                    _hover={{ bg: 'gray.50' }}
                    onClick={() => handleGuestClick(guest)}
                    bg={guest.checked_in ? 'green.50' : 'white'}
                  >
                    <CardBody>
                      <Flex justify="space-between" align="center">
                        <Box flex={1}>
                          <Text fontWeight="medium" fontSize="sm">
                            {guest.full_name}
                          </Text>
                          <Text fontSize="xs" color="gray.600">
                            {guest.phone}
                          </Text>
                          {guest.company && (
                            <Text fontSize="xs" color="gray.500">
                              {guest.company}
                            </Text>
                          )}
                          {guest.table_id && (
                             <Text fontSize="xs" color="blue.500">
                               Table {getTableLabel(guest.table_id)} • Seat {guest.seat_id?.slice(-4)}
                             </Text>
                          )}
                        </Box>
                        <Flex direction="column" align="flex-end">
                          <Badge
                            colorScheme={guest.checked_in ? 'green' : guest.checked_out_at ? 'orange' : 'gray'}
                            display="flex"
                            alignItems="center"
                            mb={guest.checked_in_at || guest.checked_out_at ? 1 : 0}
                          >
                            {guest.checked_in ? (
                              <>
                                <FiCheck style={{ marginRight: '4px' }} />
                                In
                              </>
                            ) : guest.checked_out_at ? (
                              <>
                                <FiLogOut style={{ marginRight: '4px' }} />
                                Out
                              </>
                            ) : (
                              <>
                                <FiX style={{ marginRight: '4px' }} />
                                Pending
                              </>
                            )}
                          </Badge>
                          {guest.checked_in && guest.checked_in_at && (
                            <Text fontSize="xs" color="gray.500">
                              {new Date(guest.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </Text>
                          )}
                          {!guest.checked_in && (
                            <>
                              {guest.checked_in_at && (
                                <Text fontSize="xs" color="gray.500">
                                  In: {new Date(guest.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Text>
                              )}
                              {guest.checked_out_at && (
                                <Text fontSize="xs" color="gray.500">
                                  Out: {new Date(guest.checked_out_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Text>
                              )}
                            </>
                          )}
                        </Flex>
                      </Flex>
                    </CardBody>
                  </Card>
                ))
              )}
            </VStack>

            <Box pt={4} mt={4} borderTop="1px" borderColor="gray.200">
              <Heading size="xs" mb={2}>Legend</Heading>
              <VStack spacing={2} align="stretch" fontSize="xs">
                <HStack>
                  <Box w="16px" h="16px" borderRadius="full" bg="#cbd5e0" />
                  <Text>Empty</Text>
                </HStack>
                <HStack>
                  <Box w="16px" h="16px" borderRadius="full" bg="#3182ce" />
                  <Text>Assigned</Text>
                </HStack>
                <HStack>
                  <Box w="16px" h="16px" borderRadius="full" bg="#48bb78" />
                  <Text>Checked In</Text>
                </HStack>
              </VStack>
            </Box>
          </CardBody>
        </Card>

        {/* Layout View */}
        <Card flex={1} w="100%">
          <CardBody p={2}>
            <Box position="relative" h={{ base: '500px', md: '600px', lg: 'auto' }} maxH={{ base: 'calc(100vh - 200px)', lg: 'calc(100vh - 300px)' }}>
              <Box
                border="2px"
                borderColor="gray.300"
                borderRadius="md"
                overflow="auto"
                bg="white"
                w="100%"
                h="100%"
              >
                {layoutData?.tables && layoutData.tables.length > 0 ? (
                  <>
                    <Stage
                      width={CANVAS_WIDTH * scale}
                      height={CANVAS_HEIGHT * scale}
                      scaleX={scale}
                      scaleY={scale}
                      x={stagePos.x}
                      y={stagePos.y}
                      draggable
                      onDragEnd={(e) => {
                        setStagePos({ x: e.target.x(), y: e.target.y() })
                      }}
                      ref={stageRef}
                    >
                      <Layer>
                        {layoutData.tables.map((table) => (
                          <TableDisplay
                            key={table.id}
                            table={table}
                            guests={guests}
                            onSeatClick={handleSeatClick}
                            isMobile={isMobile}
                          />
                        ))}
                      </Layer>
                    </Stage>
                  </>
                ) : (
                  <Flex
                    justify="center"
                    align="center"
                    h="100%"
                    direction="column"
                  >
                    <Text color="gray.500" mb={2}>
                      No layout configured
                    </Text>
                    <Text fontSize="sm" color="gray.400">
                      Admin needs to design the seating layout
                    </Text>
                  </Flex>
                )}
              </Box>
              {layoutData?.tables && layoutData.tables.length > 0 && (
                <CanvasControls
                  scale={scale}
                  setScale={setScale}
                  onReset={handleResetView}
                />
              )}
            </Box>
          </CardBody>
        </Card>
      </Flex>

      {/* Guest Detail Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="md">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Guest Details</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedGuest && (
              <VStack spacing={4} align="stretch">
                <Flex align="center" gap={4}>
                  <Avatar
                    name={selectedGuest.full_name}
                    size="lg"
                    bg="brand.500"
                  />
                  <Box>
                    <Heading size="md">{selectedGuest.full_name}</Heading>
                    <Text color="gray.600">{selectedGuest.phone}</Text>
                  </Box>
                </Flex>

                <Divider />

                {selectedGuest.company && (
                  <Box>
                    <Text fontSize="sm" color="gray.600">Company</Text>
                    <Text fontWeight="medium">{selectedGuest.company}</Text>
                  </Box>
                )}

                {selectedGuest.email && (
                  <Box>
                    <Text fontSize="sm" color="gray.600">Email</Text>
                    <Text fontWeight="medium">{selectedGuest.email}</Text>
                  </Box>
                )}

                {selectedGuest.table_id && (
                  <Box>
                    <Text fontSize="sm" color="gray.600">Seat Assignment</Text>
                    <Text fontWeight="medium">
                      Table {selectedGuest.table_id.slice(-4)} - Seat {selectedGuest.seat_id?.slice(-4)}
                    </Text>
                  </Box>
                )}

                <Box>
                  <Text fontSize="sm" color="gray.600">Status</Text>
                  <Badge
                    colorScheme={selectedGuest.checked_in ? 'green' : selectedGuest.checked_out_at ? 'orange' : 'gray'}
                    fontSize="md"
                    px={3}
                    py={1}
                    mt={1}
                    display="flex"
                    alignItems="center"
                    width="fit-content"
                  >
                    {selectedGuest.checked_in ? (
                      <>
                        <FiCheck style={{ marginRight: '4px' }} />
                        Checked In
                      </>
                    ) : selectedGuest.checked_out_at ? (
                      <>
                        <FiLogOut style={{ marginRight: '4px' }} />
                        Checked Out
                      </>
                    ) : (
                      <>
                        <FiX style={{ marginRight: '4px' }} />
                        Not Checked In
                      </>
                    )}
                  </Badge>
                </Box>

                {selectedGuest.checked_in_at && (
                  <Box>
                    <Text fontSize="sm" color="gray.600">Checked In At</Text>
                    <Text fontWeight="medium">
                      {new Date(selectedGuest.checked_in_at).toLocaleString()}
                    </Text>
                  </Box>
                )}

                {selectedGuest.checked_out_at && (
                  <Box>
                    <Text fontSize="sm" color="gray.600">Checked Out At</Text>
                    <Text fontWeight="medium">
                      {new Date(selectedGuest.checked_out_at).toLocaleString()}
                    </Text>
                  </Box>
                )}
              </VStack>
            )}
          </ModalBody>

          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose}>
              Close
            </Button>
            {selectedGuest && !selectedGuest.checked_in && (
              <Button
                colorScheme="green"
                leftIcon={<FiCheck />}
                onClick={handleCheckIn}
                isLoading={checkInMutation.isPending}
              >
                Check In
              </Button>
            )}
            {selectedGuest && selectedGuest.checked_in && (
              <Button
                colorScheme="orange"
                leftIcon={<FiX />}
                onClick={handleCheckOut}
                isLoading={checkOutMutation.isPending}
              >
                Check Out
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}
