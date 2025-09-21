export interface SignalingMessage {
    type: 'offer' | 'answer' | 'ice-candidate' | 'game-message';
    sender: string;
    receiver?: string;
    data: any;
}

export class SignalingServer {
    private connections: Map<string, RTCPeerConnection> = new Map();
    private dataChannels: Map<string, RTCDataChannel> = new Map();
    private onMessageCallback: ((message: any) => void) | null = null;
    private connectionCode: string;

    constructor() {
        // Generate a unique connection code
        this.connectionCode = Math.random().toString(36).substr(2, 6).toUpperCase();
        this.setupHostPeer();
    }

    private setupHostPeer() {
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
            } else if (message.type === 'answer' && message.receiver === 'host') {
                const peerConnection = this.connections.get(message.sender);
                if (peerConnection) {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.data));
                }
            } else if (message.type === 'ice-candidate' && message.receiver === 'host') {
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

    private setupPeerConnection(peerConnection: RTCPeerConnection, peerId: string) {
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

    private setupDataChannel(dataChannel: RTCDataChannel, peerId: string) {
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

    public isConnected(peerId: string): boolean {
        const channel = this.dataChannels.get(peerId);
        return channel?.readyState === 'open';
    }

    public sendToPeer(peerId: string, message: any): boolean {
        const channel = this.dataChannels.get(peerId);
        if (channel?.readyState === 'open') {
            channel.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    public broadcast(message: any) {
        const messageStr = JSON.stringify(message);
        this.dataChannels.forEach(channel => {
            if (channel.readyState === 'open') {
                channel.send(messageStr);
            }
        });
    }

    public onMessage(callback: (message: any) => void) {
        this.onMessageCallback = callback;
    }

    public getConnectionCode(): string {
        return this.connectionCode;
    }

    public cleanup() {
        this.connections.forEach(conn => conn.close());
        this.connections.clear();
        this.dataChannels.clear();
        const channel = new BroadcastChannel(`game-${this.connectionCode}`);
        channel.close();
    }
} 