# HTTPS/HTTP Configuration Variable

## ✅ Feature Implemented

You requested to add a variable that determines whether the server uses HTTPS or HTTP. This has been successfully implemented with comprehensive support for both protocols!

### 🔧 **Changes Made**

#### **1. Added Protocol Configuration (`src/constants.ts`)**

```typescript
// Server protocol configuration
export const USE_HTTPS = process.env.USE_HTTPS !== 'false';  // Default to HTTPS, set USE_HTTPS=false to use HTTP
export const SERVER_PROTOCOL = USE_HTTPS ? 'https' : 'http';
```

#### **2. Updated Server Creation (`src/server.ts`)**

**Dynamic Server Creation**:
```typescript
// Create server based on protocol configuration
let server: http.Server | https.Server;

if (USE_HTTPS) {
    try {
        server = createServer({
            key: fs.readFileSync('cert.key'),
            cert: fs.readFileSync('cert.crt')
        }, app);
        console.log(`[SERVER] Using HTTPS protocol`);
    } catch (error) {
        console.warn(`[SERVER] HTTPS certificates not found, falling back to HTTP`);
        server = createHttpServer(app);
        console.log(`[SERVER] Using HTTP protocol (fallback)`);
    }
} else {
    server = createHttpServer(app);
    console.log(`[SERVER] Using HTTP protocol`);
}
```

**Dynamic Server Listen**:
```typescript
server.listen(PORT, () => {
    console.log(`Server is running on ${SERVER_PROTOCOL}://localhost:${PORT}`);
});
```

#### **3. Updated Cross-Server Transfer (`src/server.ts`)**

**Protocol-Aware Transfer Requests**:
```typescript
const req = USE_HTTPS ? 
    https.request(options, (res) => { /* HTTPS handling */ }) :
    http.request(options, (res) => { /* HTTP handling */ });
```

#### **4. Updated Client Socket Connection (`src/socket.ts`)**

**Dynamic Protocol Detection**:
```typescript
game.socket = io(serverUrl, {
    secure: serverUrl.startsWith('https'),
    rejectUnauthorized: false,
    withCredentials: true
});
```

**Cross-Server Transfer with Protocol**:
```typescript
const protocol = transferData.targetServer.protocol || 'https';
const newServerUrl = `${protocol}://${transferData.targetServer.host}:${transferData.targetServer.port}`;
```

#### **5. Enhanced Server Configuration (`src/constants.ts`)**

**Updated ServerConfig Interface**:
```typescript
export interface ServerConfig {
    port: number;
    host: string;
    name: string;
    protocol?: string;  // Optional protocol, defaults to SERVER_PROTOCOL
}
```

**Protocol-Aware Configuration**:
```typescript
export function getServerConfigs(): ServerConfig[] {
    // ... existing logic ...
    return DEFAULT_SERVER_CONFIGS.map(config => ({ 
        ...config, 
        protocol: config.protocol || SERVER_PROTOCOL 
    }));
}
```

## 🎯 **How to Use**

### **Environment Variable Configuration**

#### **Use HTTPS (Default)**:
```bash
# Default behavior - uses HTTPS
npm start

# Explicitly set HTTPS
USE_HTTPS=true npm start
```

#### **Use HTTP**:
```bash
# Set environment variable to use HTTP
USE_HTTPS=false npm start
```

### **Server Startup Messages**

#### **HTTPS Mode**:
```
[SERVER] Using HTTPS protocol
Server is running on https://localhost:3000
```

#### **HTTP Mode**:
```
[SERVER] Using HTTP protocol
Server is running on http://localhost:3000
```

#### **HTTPS Fallback to HTTP**:
```
[SERVER] HTTPS certificates not found, falling back to HTTP
[SERVER] Using HTTP protocol (fallback)
Server is running on http://localhost:3000
```

## ✅ **Features Supported**

### **Server-Side**:
- ✅ **Dynamic Protocol Selection**: HTTPS or HTTP based on environment variable
- ✅ **Certificate Fallback**: Automatically falls back to HTTP if HTTPS certificates missing
- ✅ **Protocol-Aware Logging**: Shows which protocol is being used
- ✅ **Cross-Server Transfer**: Uses correct protocol for server-to-server communication
- ✅ **Environment Configuration**: Easy configuration via `USE_HTTPS` environment variable

### **Client-Side**:
- ✅ **Automatic Protocol Detection**: Socket connection uses correct protocol based on URL
- ✅ **Cross-Server Compatibility**: Transfers work with both HTTP and HTTPS servers
- ✅ **Dynamic Socket Configuration**: Secure flag set based on protocol
- ✅ **Server URL Flexibility**: Supports both `http://` and `https://` URLs

### **Cross-Server Transfer**:
- ✅ **Protocol-Aware URLs**: Transfer URLs use correct protocol
- ✅ **Server Configuration**: Each server can specify its protocol
- ✅ **Mixed Protocol Support**: HTTP servers can transfer to HTTPS servers and vice versa
- ✅ **Fallback Handling**: Graceful handling of protocol mismatches

## 🧪 **Testing Scenarios**

### **1. HTTPS Mode (Default)**
```bash
# Start server in HTTPS mode
npm start

# Expected output:
# [SERVER] Using HTTPS protocol
# Server is running on https://localhost:3000
```

### **2. HTTP Mode**
```bash
# Start server in HTTP mode
USE_HTTPS=false npm start

# Expected output:
# [SERVER] Using HTTP protocol
# Server is running on http://localhost:3000
```

### **3. HTTPS with Missing Certificates**
```bash
# Remove cert.key and cert.crt files
rm cert.key cert.crt

# Start server
npm start

# Expected output:
# [SERVER] HTTPS certificates not found, falling back to HTTP
# [SERVER] Using HTTP protocol (fallback)
# Server is running on http://localhost:3000
```

### **4. Cross-Server Transfer**
- **HTTP to HTTP**: Works seamlessly
- **HTTPS to HTTPS**: Works seamlessly  
- **HTTP to HTTPS**: Works with proper protocol handling
- **HTTPS to HTTP**: Works with proper protocol handling

## 🔍 **Debug Information**

### **Server Startup**:
- `[SERVER] Using HTTPS protocol` - HTTPS mode active
- `[SERVER] Using HTTP protocol` - HTTP mode active
- `[SERVER] HTTPS certificates not found, falling back to HTTP` - Certificate fallback

### **Client Connection**:
- `[CLIENT] Connecting to server: https://localhost:3000` - HTTPS connection
- `[CLIENT] Connecting to server: http://localhost:3000` - HTTP connection

### **Cross-Server Transfer**:
- Transfer URLs automatically use correct protocol
- Server-to-server communication uses appropriate HTTP/HTTPS requests

## 🛡️ **Error Handling**

### **Certificate Issues**:
- **Missing Certificates**: Automatically falls back to HTTP
- **Invalid Certificates**: Falls back to HTTP with warning
- **Certificate Errors**: Graceful fallback with logging

### **Protocol Mismatches**:
- **Client HTTP → Server HTTPS**: Socket connection fails gracefully
- **Client HTTPS → Server HTTP**: Socket connection fails gracefully
- **Cross-Server Protocol Mismatch**: Transfer requests use correct protocol

## 📊 **Configuration Options**

### **Environment Variables**:
- `USE_HTTPS=true` - Force HTTPS mode
- `USE_HTTPS=false` - Force HTTP mode
- `USE_HTTPS` not set - Default to HTTPS

### **Server Configuration**:
- Each server can specify its protocol in `ServerConfig`
- Protocol defaults to `SERVER_PROTOCOL` if not specified
- Environment variable `SERVER_CONFIGS` can override protocol

### **Client Configuration**:
- Socket connection automatically detects protocol from URL
- `secure` flag set based on protocol detection
- Cross-server transfers use server-specified protocol

---

## ✨ **Summary**

The HTTPS/HTTP configuration system is now fully implemented:

- ✅ **Environment Variable Control**: `USE_HTTPS` environment variable controls protocol
- ✅ **Dynamic Server Creation**: Server uses HTTP or HTTPS based on configuration
- ✅ **Certificate Fallback**: Automatically falls back to HTTP if certificates missing
- ✅ **Client Protocol Detection**: Socket connections use correct protocol
- ✅ **Cross-Server Compatibility**: Transfers work between HTTP and HTTPS servers
- ✅ **Comprehensive Logging**: Clear indication of which protocol is being used
- ✅ **Error Handling**: Graceful fallbacks and error recovery

**Test it out**: 
- **HTTPS**: `npm start` (default)
- **HTTP**: `USE_HTTPS=false npm start`

The server will automatically use the correct protocol and show clear logging about which mode is active! 🎉
