#!/bin/bash

# Teleporter Testing Script
# This script helps test the new teleporter system with 1-second delays

echo "🌀 Teleporter System Testing Guide"
echo "=================================="
echo ""

# Check if servers are running
echo "📋 Pre-Test Checklist:"
echo ""

# Function to check if a port is in use
check_port() {
    local port=$1
    local name=$2
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "✅ $name (Port $port) - Running"
        return 0
    else
        echo "❌ $name (Port $port) - Not Running"
        return 1
    fi
}

# Check server status
servers_running=0
if check_port 3000 "Server1"; then ((servers_running++)); fi
if check_port 3001 "Server2"; then ((servers_running++)); fi  
if check_port 3002 "Server3"; then ((servers_running++)); fi

echo ""

if [ $servers_running -eq 0 ]; then
    echo "🚨 No servers are running! Starting servers..."
    echo "Running: ./start_test_servers.sh"
    ./start_test_servers.sh
    echo ""
    echo "⏳ Waiting 5 seconds for servers to fully start..."
    sleep 5
elif [ $servers_running -lt 3 ]; then
    echo "⚠️  Only $servers_running/3 servers running. For full cross-server testing, run:"
    echo "   ./start_test_servers.sh"
    echo ""
fi

echo "🎮 Testing Instructions:"
echo "======================="
echo ""
echo "1. 📱 Open your browser to: https://localhost:3000"
echo "2. 🔑 Login/create an account"
echo "3. 🏃 Find teleporters in the game world (blue rectangles)"
echo ""

echo "🧪 Test Cases to Verify:"
echo "========================"
echo ""
echo "A. SAME-SERVER TELEPORTER (Green border in list):"
echo "   • Walk into teleporter"
echo "   • 📋 Countdown UI should appear: 'TELEPORTER CHARGING'"
echo "   • ⏱️  Wait full 1.0 seconds"
echo "   • ✨ Should teleport with flash effect"
echo "   • 🔄 2-second cooldown before next use"
echo ""

echo "B. CROSS-SERVER TELEPORTER (Blue border, gold diamond):"
echo "   • Walk into cross-server teleporter"  
echo "   • 📋 UI shows: 'Destination: Server XXXX'"
echo "   • ⏱️  Wait full 1.0 seconds"
echo "   • 🔄 Should show: 'Transferring to ServerX...'"
echo "   • 🌐 Browser reconnects to new server"
echo "   • ✅ Player appears at destination with all progress"
echo ""

echo "C. EARLY EXIT (Should NOT teleport):"
echo "   • Walk into teleporter"
echo "   • 📋 Countdown starts"
echo "   • 🚪 Leave before 1 second is up"
echo "   • ❌ Countdown disappears, no teleportation"
echo ""

echo "D. RAPID MOVEMENT (Should not cause issues):"
echo "   • Walk quickly through teleporter"  
echo "   • 📋 UI may flicker but should not teleport"
echo "   • Only staying inside for 1+ seconds should trigger"
echo ""

echo "🔍 Debug Information:"
echo "===================="
echo ""
echo "Server Logs:"
echo "• tail -f server_3000.log  # Main server"
echo "• tail -f server_3001.log  # Server 2"  
echo "• tail -f server_3002.log  # Server 3"
echo ""
echo "Browser Console:"
echo "• Press F12 → Console tab"
echo "• Look for: '[CLIENT] Entered teleporter...' messages"
echo "• Look for: '[CLIENT] Player teleported...' messages"
echo ""

echo "📊 Expected Behavior:"
echo "===================="
echo ""
echo "✅ CORRECT:"
echo "• Teleporters are passable (no wall collision)"
echo "• 1-second delay before teleportation"
echo "• Visual countdown with progress bar"  
echo "• Clear indication of same-server vs cross-server"
echo "• Cooldown prevents spam"
echo "• Cross-server transfers preserve all player data"
echo ""
echo "❌ PROBLEMS TO REPORT:"
echo "• Instant teleportation (no delay)"
echo "• Teleporters act like walls"
echo "• UI doesn't appear or update"
echo "• Cross-server transfers fail"
echo "• Player data lost during transfer"
echo "• No cooldown between teleports"
echo ""

echo "🛠️  Troubleshooting:"
echo "==================="
echo ""
echo "Issue: No teleporters visible"
echo "Fix: Check if map contains teleporter elements"
echo ""
echo "Issue: UI doesn't appear" 
echo "Fix: Check browser console for JavaScript errors"
echo ""
echo "Issue: Cross-server transfer fails"
echo "Fix: Ensure target server is running and accessible"
echo ""
echo "Issue: Instant teleportation"
echo "Fix: Check server logs for timing implementation"
echo ""

echo "🎯 Success Criteria:"
echo "==================="
echo ""
echo "The teleporter system is working correctly if:"
echo "✅ Players must stay in teleporter for 1 full second"
echo "✅ Countdown UI appears with progress bar"
echo "✅ Cross-server teleporters show target server info"
echo "✅ Teleportation has visual effects"
echo "✅ 2-second cooldown prevents rapid use"
echo "✅ Cross-server transfers preserve all data"
echo "✅ Early exit cancels teleportation"
echo ""

echo "🚀 Ready to test! Good luck!"
echo ""
echo "Remember: Stay in teleporter for the FULL 1 second!"
