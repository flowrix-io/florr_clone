import { GameMessage, GameState, Player } from './types';

export class NetworkManager {
    private ws: WebSocket | null = null;
    private playerId: string;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 1000;
    private messageQueue: GameMessage[] = [];

    constructor(playerId: string) {
        this.playerId = playerId;
    }

    public async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // Use localhost for development, can be configured for production
                this.ws = new WebSocket('ws://localhost:8080');
                console.log('Created WebSocket');

                this.ws.onopen = () => {
                    console.log('Connected to server');
                    this.reconnectAttempts = 0;
                    this.updateConnectionStatus('Connected');
                    
                    // Send player join message
                    this.sendMessage({
                        type: 'playerJoin',
                        data: { playerId: this.playerId }
                    });
                    console.log('Sent player join message');

                    // Send queued messages
                    this.flushMessageQueue();
                    console.log('Flushed message queue');
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    try {
                        const message: GameMessage = JSON.parse(event.data);
                        this.handleMessage(message);
                    } catch (error) {
                        console.error('Error parsing message:', error);
                    }
                };

                this.ws.onclose = () => {
                    console.log('Disconnected from server');
                    this.updateConnectionStatus('Disconnected');
                    this.attemptReconnect();
                };

                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.updateConnectionStatus('Error');
                    reject(error);
                };

            } catch (error) {
                console.error('Failed to connect:', error);
                this.updateConnectionStatus('Failed to connect');
                reject(error);
            }
        });
    }

    private handleMessage(message: GameMessage): void {
        switch (message.type) {
            case 'gameState':
                this.onGameStateUpdate(message.data);
                break;
            case 'playerJoin':
                this.onPlayerJoin(message.data);
                break;
            case 'playerLeave':
                this.onPlayerLeave(message.data);
                break;
            case 'playerUpdate':
                this.onPlayerUpdate(message.data);
                break;
            case 'mobUpdate':
                this.onMobUpdate(message.data);
                break;
            case 'damage':
                this.onDamage(message.data);
                break;
            default:
                console.warn('Unknown message type:', message.type);
        }
    }

    private onGameStateUpdate(gameState: GameState): void {
        // Notify the game about state update
        if (window.game) {
            window.game.updateGameState(gameState);
        }
    }

    private onPlayerJoin(playerData: Player): void {
        if (window.game) {
            window.game.addPlayer(playerData);
        }
    }

    private onPlayerLeave(data: { playerId: string }): void {
        if (window.game) {
            window.game.removePlayer(data.playerId);
        }
    }

    private onPlayerUpdate(playerData: Player): void {
        if (window.game) {
            window.game.updateGameState({ 
                players: { [playerData.id]: playerData } 
            });
        }
    }

    private onMobUpdate(mobData: any): void {
        if (window.game) {
            window.game.updateGameState({ 
                mobs: mobData 
            });
        }
    }

    private onDamage(data: any): void {
        // Handle damage events
        console.log('Damage event:', data);
    }

    public sendMessage(message: GameMessage): void {
        console.log('Sending message:', message);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            // Queue message if not connected
            this.messageQueue.push(message);
        }
    }

    public sendPlayerUpdate(playerData: Player): void {
        this.sendMessage({
            type: 'playerUpdate',
            data: playerData
        });
    }

    public sendDamage(mobId: string, damage: number): void {
        this.sendMessage({
            type: 'damage',
            data: { mobId, damage, playerId: this.playerId }
        });
    }

    public sendMousePosition(mouseX: number, mouseY: number): void {
        console.log('Sending mouse position:', mouseX, mouseY);
        this.sendMessage({
            type: 'mousePosition',
            data: { playerId: this.playerId, mouseX, mouseY }
        });
    }

    private flushMessageQueue(): void {
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            if (message) {
                this.sendMessage(message);
            }
        }
    }

    private attemptReconnect(): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.updateConnectionStatus(`Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.connect().catch(error => {
                    console.error('Reconnection failed:', error);
                });
            }, this.reconnectDelay * this.reconnectAttempts);
        } else {
            this.updateConnectionStatus('Connection failed');
        }
    }

    private updateConnectionStatus(status: string): void {
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            statusElement.textContent = status;
        }
    }

    public disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Extend Window interface to include game reference
declare global {
    interface Window {
        game: any;
    }
} 