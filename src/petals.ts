export interface PetalStats {
    name: string;
    damage: number;
    health: number;
    size: number;
    speed: number; // Rotation speed multiplier
    description: string;
    color: string;
    image: string; // 32x32 SVG image
}

export interface PetalConfig {
    [petalType: string]: {
        [rarity: string]: PetalStats;
    };
}

export const PETAL_CONFIG: PetalConfig = {
    basic: {
        common: {
            name: "Basic Petal",
            damage: 5,
            health: 10,
            size: 2.0,
            speed: 1.0,
            description: "A simple petal that provides basic protection",
            color: "#90EE90",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        uncommon: {
            name: "Enhanced Basic Petal",
            damage: 8,
            health: 15,
            size: 2.0,
            speed: 1.0,
            description: "An improved basic petal with better stats",
            color: "#32CD32",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        rare: {
            name: "Superior Basic Petal",
            damage: 12,
            health: 22,
            size: 2.0,
            speed: 1.0,
            description: "A superior basic petal with enhanced capabilities",
            color: "#228B22",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        epic: {
            name: "Elite Basic Petal",
            damage: 18,
            health: 32,
            size: 2.0,
            speed: 1.0,
            description: "An elite basic petal with impressive power",
            color: "#006400",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        legendary: {
            name: "Legendary Basic Petal",
            damage: 26,
            health: 45,
            size: 2.0,
            speed: 1.0,
            description: "A legendary basic petal of immense strength",
            color: "#8B4513",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        },
        mythic: {
            name: "Mythic Basic Petal",
            damage: 40,
            health: 65,
            size: 2.0,
            speed: 1.0,
            description: "A mythic basic petal with otherworldly power",
            color: "#4B0082",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="16" fill="white"/>
</svg>`
        }
    },
    rose: {
        common: {
            name: "Rose Petal",
            damage: 8,
            health: 8,
            size: 0.9,
            speed: 1.0,
            description: "A thorny petal that deals extra damage",
            color: "#FF69B4",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        uncommon: {
            name: "Blood Rose Petal",
            damage: 12,
            health: 12,
            size: 1.0,
            speed: 1.0,
            description: "A crimson petal with sharp thorns",
            color: "#DC143C",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        rare: {
            name: "Royal Rose Petal",
            damage: 18,
            health: 18,
            size: 1.1,
            speed: 1.0,
            description: "A majestic rose petal fit for royalty",
            color: "#8B0000",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        epic: {
            name: "Divine Rose Petal",
            damage: 26,
            health: 26,
            size: 1.2,
            speed: 1.0,
            description: "A divine rose petal blessed with power",
            color: "#B22222",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        legendary: {
            name: "Eternal Rose Petal",
            damage: 38,
            health: 38,
            size: 1.3,
            speed: 1.0,
            description: "An eternal rose petal that never wilts",
            color: "#FF1493",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        },
        mythic: {
            name: "Celestial Rose Petal",
            damage: 55,
            health: 55,
            size: 1.4,
            speed: 1.0,
            description: "A celestial rose petal from the heavens",
            color: "#FF6347",
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
        }
    },
    stinger: {
        common: {
            name: "Stinger",
            damage: 12,
            health: 5,
            size: 0.8,
            speed: 1.0,
            description: "A fast, sharp petal that prioritizes offense",
            color: "#FFD700",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon points="16,0 32,32 0,32" fill="black" />
</svg>
`
        },
        uncommon: {
            name: "Venomous Stinger",
            damage: 18,
            health: 7,
            size: 0.85,
            speed: 1.0,
            description: "A poisonous stinger with deadly precision",
            color: "#FFA500",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon points="16,0 32,32 0,32" fill="black" />
</svg>
`
        },
        rare: {
            name: "Barbed Stinger",
            damage: 26,
            health: 10,
            size: 0.9,
            speed: 1.0,
            description: "A barbed stinger that tears through enemies",
            color: "#FF8C00",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon points="16,0 32,32 0,32" fill="black" />
</svg>
`
        },
        epic: {
            name: "Razor Stinger",
            damage: 38,
            health: 14,
            size: 0.95,
            speed: 1.0,
            description: "A razor-sharp stinger of incredible lethality",
            color: "#FF7F50",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon points="16,0 32,32 0,32" fill="black" />
</svg>
`
        },
        legendary: {
            name: "Infernal Stinger",
            damage: 55,
            health: 20,
            size: 1.0,
            speed: 1.0,
            description: "An infernal stinger wreathed in flames",
            color: "#FF4500",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon points="16,0 32,32 0,32" fill="black" />
</svg>
`
        },
        mythic: {
            name: "Void Stinger",
            damage: 80,
            health: 28,
            size: 1.1,
            speed: 1.0,
            description: "A void stinger that pierces reality itself",
            color: "#800080",
            image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon points="16,0 32,32 0,32" fill="black" />
</svg>
`
        }
    }
};

export function getPetalStats(petalType: string, rarity: string): PetalStats | null {
    return PETAL_CONFIG[petalType]?.[rarity] || null;
}

export function getAllPetalTypes(): string[] {
    return Object.keys(PETAL_CONFIG);
}

export function getPetalRarities(petalType: string): string[] {
    return Object.keys(PETAL_CONFIG[petalType] || {});
}
