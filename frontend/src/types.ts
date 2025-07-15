export interface Vector2 {
    x: number;
    y: number;
}

export interface Player {
    id: string;
    position: Vector2;
    health: number;
    maxHealth: number;
    radius: number;
    color: string;
    orbitingCircles: OrbitingCircle[];
}

export interface OrbitingCircle {
    angle: number;
    radius: number;
    orbitRadius: number;
    color: string;
}

export interface Mob {
    id: string;
    position: Vector2;
    velocity: Vector2;
    health: number;
    maxHealth: number;
    radius: number;
    type: MobType;
    target?: string; // player id
}

export enum MobType {
    BIRD = 'bird',
    BEE = 'bee',
    CAT = 'cat',
    MOUSE = 'mouse',
    UNKNOWN = 'unknown'
}

export interface GameState {
    players: { [id: string]: Player };
    mobs: { [id: string]: Mob };
    worldBounds: {
        width: number;
        height: number;
    };
}

export interface GameMessage {
    type: 'playerUpdate' | 'mobUpdate' | 'gameState' | 'playerJoin' | 'playerLeave' | 'damage' | 'mousePosition';
    data: any;
}

export interface Input {
    mouseX: number;
    mouseY: number;
    keys: Set<string>;
} 