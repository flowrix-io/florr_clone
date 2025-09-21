"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalingServer = void 0;
class SignalingServer {
    constructor() {
        this.connections = new Map();
        this.dataChannels = new Map();
        this.onMessageCallback = null;
        // Generate a unique connection code
        this.connectionCode = Math.random().toString(36).substr(2, 6).toUpperCase();
        this.setupHostPeer();
    }
    setupHostPeer() {
        // Create a BroadcastChannel for local discovery
        const channel = new BroadcastChannel(`game-${this.connectionCode}`);
        channel.onmessage = async (event) => {
            const message = event.data;
            if (message.type === 'join-request') {
                const peerConnection = new RTCPeerConnection({
                    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
                });
                this.setupPeerConnection(peerConnection, message.sender);
                // Create and send offer
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                channel.postMessage({
                    type: 'offer',
                    sender: 'host',
                    receiver: message.sender,
                    data: offer
                });
            }
            else if (message.type === 'answer' && message.receiver === 'host') {
                const peerConnection = this.connections.get(message.sender);
                if (peerConnection) {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.data));
                }
            }
            else if (message.type === 'ice-candidate' && message.receiver === 'host') {
                const peerConnection = this.connections.get(message.sender);
                if (peerConnection) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(message.data));
                }
            }
        };
        // Post the connection code to the worker
        self.postMessage({
            type: 'connection-code',
            data: { code: this.connectionCode }
        });
    }
    setupPeerConnection(peerConnection, peerId) {
        this.connections.set(peerId, peerConnection);
        // Create data channel
        const dataChannel = peerConnection.createDataChannel('gameData');
        this.setupDataChannel(dataChannel, peerId);
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const channel = new BroadcastChannel(`game-${this.connectionCode}`);
                channel.postMessage({
                    type: 'ice-candidate',
                    sender: 'host',
                    receiver: peerId,
                    data: event.candidate
                });
            }
        };
        peerConnection.ondatachannel = (event) => {
            this.setupDataChannel(event.channel, peerId);
        };
    }
    setupDataChannel(dataChannel, peerId) {
        this.dataChannels.set(peerId, dataChannel);
        dataChannel.onmessage = (event) => {
            if (this.onMessageCallback) {
                this.onMessageCallback(JSON.parse(event.data));
            }
        };
        dataChannel.onopen = () => {
            console.log(`Data channel opened with peer ${peerId}`);
            self.postMessage({
                type: 'peer-connected',
                data: { peerId }
            });
        };
        dataChannel.onclose = () => {
            console.log(`Data channel closed with peer ${peerId}`);
            this.connections.delete(peerId);
            this.dataChannels.delete(peerId);
            self.postMessage({
                type: 'peer-disconnected',
                data: { peerId }
            });
        };
    }
    isConnected(peerId) {
        const channel = this.dataChannels.get(peerId);
        return channel?.readyState === 'open';
    }
    sendToPeer(peerId, message) {
        const channel = this.dataChannels.get(peerId);
        if (channel?.readyState === 'open') {
            channel.send(JSON.stringify(message));
            return true;
        }
        return false;
    }
    broadcast(message) {
        const messageStr = JSON.stringify(message);
        this.dataChannels.forEach(channel => {
            if (channel.readyState === 'open') {
                channel.send(messageStr);
            }
        });
    }
    onMessage(callback) {
        this.onMessageCallback = callback;
    }
    getConnectionCode() {
        return this.connectionCode;
    }
    cleanup() {
        this.connections.forEach(conn => conn.close());
        this.connections.clear();
        this.dataChannels.clear();
        const channel = new BroadcastChannel(`game-${this.connectionCode}`);
        channel.close();
    }
}
exports.SignalingServer = SignalingServer;
