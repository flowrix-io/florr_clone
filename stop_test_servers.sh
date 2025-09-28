#!/bin/bash

# Script to stop all test servers for cross-server testing

echo "Stopping florr.io test servers..."
echo ""

# Function to stop a server
stop_server() {
    local port=$1
    local name=$2
    local pidfile="server_${port}.pid"
    
    if [ -f "$pidfile" ]; then
        local pid=$(cat "$pidfile")
        
        if kill -0 $pid 2>/dev/null; then
            echo "⏹️  Stopping $name (PID: $pid)..."
            kill $pid
            
            # Wait for graceful shutdown
            local count=0
            while kill -0 $pid 2>/dev/null && [ $count -lt 10 ]; do
                sleep 1
                ((count++))
            done
            
            # Force kill if still running
            if kill -0 $pid 2>/dev/null; then
                echo "   Force killing $name..."
                kill -9 $pid
            fi
            
            echo "✅ $name stopped"
        else
            echo "⚠️  $name was not running (stale PID file)"
        fi
        
        # Clean up PID file
        rm -f "$pidfile"
    else
        echo "⚠️  No PID file found for $name"
    fi
}

# Stop all servers
stop_server 3000 "Server1 (Main)"
stop_server 3001 "Server2"
stop_server 3002 "Server3"

echo ""
echo "🧹 Cleaning up log files..."
rm -f server_*.log
rm -f server_*.pid

echo ""
echo "✅ All test servers stopped and cleaned up!"
echo ""
echo "💡 To start servers again, run: ./start_test_servers.sh"
