#!/bin/bash

# Cross-Server Testing Script for florr.io clone
# This script starts multiple server instances for testing cross-server teleportation

echo "Starting florr.io cross-server test environment..."
echo "This will start 3 server instances on ports 3000, 3001, and 3002"
echo ""

# Build the server first
echo "Building server..."
npm run build:server

if [ $? -ne 0 ]; then
    echo "❌ Server build failed!"
    exit 1
fi

echo "✅ Server built successfully!"
echo ""

# Function to start a server in the background
start_server() {
    local port=$1
    local name=$2
    
    echo "🚀 Starting $name on port $port..."
    
    # Start server in background and save PID
    PORT=$port node dist/server.js > "server_${port}.log" 2>&1 &
    local pid=$!
    
    # Store PID for cleanup
    echo $pid > "server_${port}.pid"
    
    # Wait a moment and check if server started successfully
    sleep 2
    if kill -0 $pid 2>/dev/null; then
        echo "✅ $name started successfully (PID: $pid)"
        echo "   Log file: server_${port}.log"
        echo "   Access at: https://localhost:${port}"
    else
        echo "❌ Failed to start $name"
        return 1
    fi
}

# Start the servers
start_server 3000 "Server1 (Main)"
start_server 3001 "Server2"
start_server 3002 "Server3"

echo ""
echo "🎮 All servers are running!"
echo ""
echo "📋 Server Status:"
echo "   • Server1 (Main): https://localhost:3000"
echo "   • Server2:        https://localhost:3001" 
echo "   • Server3:        https://localhost:3002"
echo ""
echo "🔗 Cross-server teleporters are configured to transfer players between these servers"
echo ""
echo "📝 To test:"
echo "   1. Open https://localhost:3000 in your browser"
echo "   2. Create/login to your account"
echo "   3. Find teleporters in the game world"
echo "   4. Step into teleporters to transfer between servers"
echo ""
echo "📊 Monitor server logs:"
echo "   • tail -f server_3000.log"
echo "   • tail -f server_3001.log"  
echo "   • tail -f server_3002.log"
echo ""
echo "⏹️  To stop all servers, run: ./stop_test_servers.sh"
echo ""
echo "✨ Happy testing! The servers will continue running in the background."
