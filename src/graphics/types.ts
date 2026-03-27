export interface FloatingText {
    x: number;
    y: number;
    text: string;
    color: string;
    fontSize: number;
    alpha: number;
    yOffset: number;
    lifetime: number;
}

export interface ExplosionEffect {
    x: number;
    y: number;
    radius: number;
    maxRadius: number;
    alpha: number;
    lifetime: number;
    startTime: number;
    particles: ExplosionParticle[];
}

export interface ExplosionParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: string;
}

export interface LightningEffect {
    x: number;
    y: number;
    targets: { x: number; y: number; enemyId: string }[];
    damage: number;
    lifetime: number;
    startTime: number;
    alpha: number;
}

export interface PetalBreakEffect {
    x: number;
    y: number;
    petalType: string;
    alpha: number;
    scale: number;
    lifetime: number;
    startTime: number;
}

export interface PetalParticleEffect {
    x: number;
    y: number;
    rarity: string;
    particles: PetalParticle[];
    lifetime: number;
    startTime: number;
}

export interface PetalParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: string;
    baseColor: string; // White base color
}

export interface FallingStar {
    x: number;
    y: number;
    vy: number;
    rotation: number;
    rotationSpeed: number;
    size: number;
    alpha: number;
    lifetime: number;
    maxLife: number;
}

export interface FlowerRenderAttributes {
    radius: number;
    color: string;        // Base fill color (hex string like '#FFE763')
    faceFlags: number;    // Bitmask of FaceFlags
    equipFlags: number;   // Bitmask of EquipmentFlags
    eyeX: number;         // Eye offset X (in units relative to radius=25 space)
    eyeY: number;         // Eye offset Y
    mouth: number;         // Mouth curve control point Y (14.5 = smile, lower = sad)
    cutterAngle?: number;  // Rotation angle for cutter equipment
}
