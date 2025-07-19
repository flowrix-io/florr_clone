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
    petals: Petal[];
}

export interface Petal {
    id: string;
    name: string;
    asset: string;
    damage: number;
    radius: number;
    orbitRadius: number;
    rotationSpeed: number;
    angle: number;
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
    type: 'playerUpdate' | 'mobUpdate' | 'gameState' | 'playerJoin' | 'playerLeave' | 'damage' | 'mousePosition' | 'canvasDimensions';
    data: any;
}

export interface Input {
    mouseX: number;
    mouseY: number;
    keys: Set<string>;
} 